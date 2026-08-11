/**
 * Heal the NaN cascade that poisoned corporation financials from turn 269 onward.
 *
 * Incident: a schema split (growthRate → targetGrowthRate + currentGrowthRate)
 * was deployed without executing its data migration. For every legacy sector,
 * `currentGrowthRate` was undefined. `src/lib/turn/gdpGrowth.ts` multiplied
 * undefined × revenue, producing NaN weighted GDP growth per state. Between
 * turn 268 (2026-04-22 05:00 UTC) and turn 269 (06:00 UTC), a code path
 * started reading the null stateMetrics.gdpGrowth into corporation income
 * computation, producing NaN income → NaN liquidCapital → NaN sharePrice
 * → NaN marketCap, persisted every turn into the corporation + history.
 *
 * What this migration does:
 *   1. Back-fills `targetGrowthRate` and `currentGrowthRate` on every sector
 *      missing them (from the legacy `growthRate` value).
 *   2. Restores `liquidCapital` and `sharePrice` on every corporation from
 *      the turn-268 `corporationHistory` snapshot (last known good).
 *   3. Deletes bogus `corporationHistory` rows for turns ≥ 269.
 *   4. Deletes bogus `corporationPortfolioHistory` rows for turns ≥ 269.
 *   5. Nulls stale stateMetrics.gdpGrowth rows so the next turn recomputes
 *      with the healed sector data.
 *   6. Stamps `migrationsRun` so this cannot double-apply.
 *
 * Dry-run by default. Pass `--apply` to write.
 *
 * Run:   npx tsx scripts/migrations/heal-nan-cascade-turn-269.ts [--apply]
 */
import { connectDb, closeDb } from "../utils/db";

const RESTORE_TURN = 268;
const MIGRATION_ID = "heal-nan-cascade-turn-269";

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = await connectDb();

  console.log(`[heal] mode = ${apply ? "APPLY (writing)" : "DRY-RUN (no writes)"}`);
  console.log(`[heal] restoring corps from corporationHistory turn = ${RESTORE_TURN}`);

  // Idempotency guard. migrationsRun uses string _ids (the migration key),
  // not ObjectIds — override the collection type so the filter accepts a
  // string `_id`.
  const migrationsRun = db.collection<{ _id: string }>("migrationsRun");
  const existing = await migrationsRun.findOne({ _id: MIGRATION_ID });
  if (existing) {
    console.log(`[heal] migration already stamped: ${JSON.stringify(existing)}`);
    if (apply) {
      console.log(`[heal] refusing to re-apply; exiting.`);
      await closeDb();
      return;
    }
  }

  // Step 1 — heal sectors missing targetGrowthRate / currentGrowthRate
  const sectorCol = db.collection("corporateSectors");
  const legacySectors = await sectorCol
    .find({
      $or: [{ targetGrowthRate: { $exists: false } }, { currentGrowthRate: { $exists: false } }],
    })
    .toArray();
  console.log(`[heal] sectors missing growth fields: ${legacySectors.length}`);

  let sectorsPatched = 0;
  if (apply && legacySectors.length > 0) {
    const ops = legacySectors.map((s) => {
      const legacy = isFiniteNumber(s.growthRate) ? s.growthRate : 0;
      return {
        updateOne: {
          filter: { _id: s._id },
          update: {
            $set: {
              targetGrowthRate: legacy,
              currentGrowthRate: legacy,
              updatedAt: new Date(),
            },
          },
        },
      };
    });
    const res = await sectorCol.bulkWrite(ops);
    sectorsPatched = res.modifiedCount;
    console.log(`[heal] sectors patched: ${sectorsPatched}`);
  }

  // Step 2 — restore corp financials from turn 268 history
  const corpCol = db.collection("corporations");
  const histCol = db.collection("corporationHistory");
  const allCorps = await corpCol
    .find(
      {},
      {
        projection: {
          _id: 1,
          name: 1,
          liquidCapital: 1,
          sharePrice: 1,
          marketingStrength: 1,
          logisticsStrength: 1,
          creditCompositeSnapshot: 1,
          creditRatingSnapshot: 1,
        },
      }
    )
    .toArray();

  const t268History = await histCol.find({ turn: RESTORE_TURN }).toArray();
  const histByCorp = new Map<string, (typeof t268History)[number]>();
  for (const row of t268History) histByCorp.set(row.corporationId.toString(), row);

  const corpsToHeal: Array<{
    id: string;
    name: string;
    before: { liquidCapital: unknown; sharePrice: unknown };
    restoreTo: { liquidCapital: number; sharePrice: number };
  }> = [];
  const corpsMissingHistory: string[] = [];
  for (const corp of allCorps) {
    const lc = corp.liquidCapital;
    const sp = corp.sharePrice;
    const needsHeal =
      (typeof lc === "number" && !Number.isFinite(lc)) ||
      (typeof sp === "number" && !Number.isFinite(sp));
    if (!needsHeal) continue;

    const h = histByCorp.get(corp._id.toString());
    if (!h) {
      corpsMissingHistory.push(corp._id.toString());
      continue;
    }

    const restoreLc = isFiniteNumber(h.liquidCapital) ? h.liquidCapital : 0;
    const restoreSp = isFiniteNumber(h.sharePrice) ? h.sharePrice : 0;
    corpsToHeal.push({
      id: corp._id.toString(),
      name: corp.name,
      before: { liquidCapital: lc, sharePrice: sp },
      restoreTo: { liquidCapital: restoreLc, sharePrice: restoreSp },
    });
  }

  console.log(`[heal] corps needing heal: ${corpsToHeal.length}`);
  console.log(
    `[heal] corps with NaN but no turn-${RESTORE_TURN} history: ${corpsMissingHistory.length}`
  );
  if (corpsMissingHistory.length) {
    console.log(
      `[heal] -> ${corpsMissingHistory.slice(0, 10).join(", ")}${corpsMissingHistory.length > 10 ? " …" : ""}`
    );
  }

  let corpsPatched = 0;
  if (apply && corpsToHeal.length > 0) {
    const { ObjectId } = await import("mongodb");
    const ops = corpsToHeal.map((c) => ({
      updateOne: {
        filter: { _id: new ObjectId(c.id) },
        update: {
          $set: {
            liquidCapital: c.restoreTo.liquidCapital,
            sharePrice: c.restoreTo.sharePrice,
            updatedAt: new Date(),
          },
        },
      },
    }));
    const res = await corpCol.bulkWrite(ops);
    corpsPatched = res.modifiedCount;
    console.log(`[heal] corps patched: ${corpsPatched}`);
  }

  // Step 3 — delete bogus history rows
  const badHistCount = await histCol.countDocuments({ turn: { $gte: 269 } });
  console.log(`[heal] corporationHistory rows to delete (turn ≥ 269): ${badHistCount}`);
  let histDeleted = 0;
  if (apply && badHistCount > 0) {
    const res = await histCol.deleteMany({ turn: { $gte: 269 } });
    histDeleted = res.deletedCount;
    console.log(`[heal] corporationHistory deleted: ${histDeleted}`);
  }

  // Step 4 — delete bogus portfolio history rows
  const portCol = db.collection("corporationPortfolioHistory");
  const badPortCount = await portCol.countDocuments({ turn: { $gte: 269 } });
  console.log(`[heal] corporationPortfolioHistory rows to delete (turn ≥ 269): ${badPortCount}`);
  let portDeleted = 0;
  if (apply && badPortCount > 0) {
    const res = await portCol.deleteMany({ turn: { $gte: 269 } });
    portDeleted = res.deletedCount;
    console.log(`[heal] corporationPortfolioHistory deleted: ${portDeleted}`);
  }

  // Step 5 — null stale state gdpGrowth so next turn recomputes
  const sm = db.collection("stateMetrics");
  const staleStates = await sm.countDocuments({ "economic.gdpGrowth.value": null });
  console.log(
    `[heal] stateMetrics with null gdpGrowth (will be recomputed next turn): ${staleStates}`
  );

  // Step 6 — stamp migration
  if (apply) {
    await migrationsRun.updateOne(
      { _id: MIGRATION_ID },
      {
        $set: {
          _id: MIGRATION_ID,
          completedAt: new Date(),
          sectorsPatched,
          corpsPatched,
          corpsMissingHistory: corpsMissingHistory.length,
          histDeleted,
          portDeleted,
          notes:
            "NaN-cascade recovery: restored liquidCapital/sharePrice from turn-268 history; back-filled sector growth fields; cleared turn-269+ history; game was paused via isActive=false.",
        },
      },
      { upsert: true }
    );
    console.log(`[heal] migration stamped as ${MIGRATION_ID}`);
  }

  await closeDb();
  console.log(`[heal] done.`);
}

main().catch((e) => {
  console.error("[heal] failed:", e);
  process.exit(1);
});
