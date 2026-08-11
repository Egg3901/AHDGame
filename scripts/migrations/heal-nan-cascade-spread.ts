/**
 * Second-wave heal for the turn-269 NaN cascade — covers the collections that
 * downstream of corporationTurn got poisoned by reading NaN corp income / NaN
 * state metrics / NaN exchange rates:
 *
 *   - exchangeRates     : restore rate + macroTarget from rateHistory turn 268;
 *                         rewrite null entries in turns 269-275 to the good rate
 *   - commodityPrices   : restore per-commodity fields from the most recent
 *                         non-NaN commodityPriceHistory row
 *   - commodityPriceHistory : null NaN in-place (preserve timeline)
 *   - federalBudget     : null NaN (will recompute on next fiscal-year turn)
 *   - stateBudgets      : null NaN corporateProfits (recomputed next turn)
 *   - centralBanks      : chairInfamy NaN → 0
 *   - locLedger         : NaN amount/interest/principal → 0 (ledger entries
 *                         from failed auto-payments in the NaN window)
 *   - tradeHistory      : null NaN rates
 *   - gameHealthSnapshots : null NaN
 *   - investorRankingSnapshots : NaN portfolioValues → 0
 *   - turnLogs          : NaN totalIncomeGenerated → null (forensic only)
 *
 * Run:  npx tsx scripts/migrations/heal-nan-cascade-spread.ts [--apply]
 */
import { connectDb, closeDb } from "../utils/db";

const MIGRATION_ID = "heal-nan-cascade-spread";
const RESTORE_TURN = 268;

function scanNaN(obj: unknown, prefix: string, out: Set<string>, depth: number) {
  if (depth > 6 || !obj || typeof obj !== "object") return;
  const rec = obj as Record<string, unknown>;
  for (const k of Object.keys(rec)) {
    const v = rec[k];
    if (typeof v === "number" && Number.isNaN(v)) {
      out.add(prefix + k);
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      scanNaN(v, prefix + k + ".", out, depth + 1);
    }
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = await connectDb();
  console.log(`[spread-heal] mode=${apply ? "APPLY" : "DRY-RUN"}`);

  const migrationsRun = db.collection<{ _id: string }>("migrationsRun");
  const existing = await migrationsRun.findOne({ _id: MIGRATION_ID });
  if (existing && apply) {
    console.log(`[spread-heal] already stamped: ${JSON.stringify(existing)}`);
    await closeDb();
    return;
  }

  const counts: Record<string, number> = {};

  // 1. exchangeRates
  console.log(`\n=== exchangeRates ===`);
  const rates = await db.collection("exchangeRates").find({}).toArray();
  let rPatched = 0;
  for (const r of rates) {
    const paths = new Set<string>();
    scanNaN(r, "", paths, 0);
    const hasNull = r.rate == null;
    if (!hasNull && paths.size === 0) continue;
    const hist = Array.isArray(r.rateHistory) ? r.rateHistory : [];
    const good = [...hist]
      .reverse()
      .find((h: { rate?: number }) => typeof h.rate === "number" && Number.isFinite(h.rate));
    if (!good) {
      console.log(`  ${r._id}: no good history`);
      continue;
    }
    const cleanHistory = hist.map((h: { turn?: number; rate?: number }) => {
      if (
        typeof h.turn === "number" &&
        h.turn > RESTORE_TURN &&
        (h.rate == null || (typeof h.rate === "number" && Number.isNaN(h.rate)))
      ) {
        return { turn: h.turn, rate: good.rate };
      }
      return h;
    });
    console.log(`  ${r._id}: restoring rate=${good.rate} (from turn ${good.turn})`);
    if (apply) {
      await db.collection("exchangeRates").updateOne(
        { _id: r._id },
        {
          $set: {
            rate: good.rate,
            macroTarget: good.rate,
            rateHistory: cleanHistory,
            updatedAt: new Date(),
          },
        }
      );
    }
    rPatched++;
  }
  counts.exchangeRates = rPatched;

  // 2. commodityPrices (restore from commodityPriceHistory)
  //
  // The collection field is `commodity` (not `commodityType`). An earlier
  // version of this block filtered on `commodityType` — both sides evaluated
  // to `undefined`, so the query matched every history row and the first
  // finite-`globalPrice` hit (a turn-268 copper snapshot on live) was
  // spread into every NaN-contaminated `commodityPrices` row, overwriting
  // their `commodity` field to `"copper"` and creating 20 duplicate rows.
  // The filter now uses `commodity` and the write-site asserts the good
  // history row matches the row being patched, so a mis-targeted row can
  // never silently overwrite a different commodity.
  console.log(`\n=== commodityPrices ===`);
  const cps = await db.collection("commodityPrices").find({}).toArray();
  let cpPatched = 0;
  for (const cp of cps) {
    const paths = new Set<string>();
    scanNaN(cp, "", paths, 0);
    if (paths.size === 0) continue;
    const histAll = await db
      .collection("commodityPriceHistory")
      .find({ commodity: cp.commodity })
      .sort({ turn: -1 })
      .limit(30)
      .toArray();
    const good = histAll.find(
      (h) => typeof h.globalPrice === "number" && Number.isFinite(h.globalPrice)
    );
    if (!good) {
      console.log(`  ${cp.commodity}: no good history — nulling`);
      if (apply) {
        const setOps: Record<string, null> = {};
        for (const p of paths) setOps[p] = null;
        await db.collection("commodityPrices").updateOne({ _id: cp._id }, { $set: setOps });
      }
      cpPatched++;
      continue;
    }
    // Defense-in-depth: refuse to write if the history row's commodity
    // doesn't match the row being patched. Protects against a future
    // regression of the `commodityType`/`commodity` field-name confusion.
    if (good.commodity !== cp.commodity) {
      console.log(
        `  ${cp.commodity}: SKIP — best history row has commodity="${good.commodity}" (mismatch)`
      );
      continue;
    }
    const good2 = good as Record<string, unknown>;
    const { _id: _drop, turn: _t, createdAt: _c, commodity: _cm, ...rest } = good2;
    void _drop;
    void _t;
    void _c;
    void _cm;
    const setOps: Record<string, unknown> = { ...rest, lastUpdated: new Date() };
    if (apply) {
      await db.collection("commodityPrices").updateOne({ _id: cp._id }, { $set: setOps });
    }
    cpPatched++;
  }
  console.log(`  commodityPrices patched: ${cpPatched}`);
  counts.commodityPrices = cpPatched;

  // 3. commodityPriceHistory (null NaN in place)
  console.log(`\n=== commodityPriceHistory ===`);
  const cphAll = await db.collection("commodityPriceHistory").find({}).toArray();
  let cphPatched = 0;
  for (const cph of cphAll) {
    const paths = new Set<string>();
    scanNaN(cph, "", paths, 0);
    if (paths.size === 0) continue;
    if (apply) {
      const setOps: Record<string, null> = {};
      for (const p of paths) setOps[p] = null;
      await db.collection("commodityPriceHistory").updateOne({ _id: cph._id }, { $set: setOps });
    }
    cphPatched++;
  }
  console.log(`  commodityPriceHistory patched: ${cphPatched}`);
  counts.commodityPriceHistory = cphPatched;

  // 4-6 + 9-11: generic "null all NaN" for read-only / recomputable collections
  const genericColls: Array<[string, "null" | "zero"]> = [
    ["federalBudget", "null"],
    ["stateBudgets", "null"],
    ["centralBanks", "zero"],
    ["tradeHistory", "null"],
    ["gameHealthSnapshots", "null"],
    ["investorRankingSnapshots", "zero"],
    ["turnLogs", "null"],
    ["locLedger", "zero"],
  ];
  for (const [colName, mode] of genericColls) {
    const docs = await db.collection(colName).find({}).toArray();
    let patched = 0;
    for (const d of docs) {
      const paths = new Set<string>();
      scanNaN(d, "", paths, 0);
      if (paths.size === 0) continue;
      if (apply) {
        const setOps: Record<string, unknown> = {};
        for (const p of paths) setOps[p] = mode === "zero" ? 0 : null;
        await db.collection(colName).updateOne({ _id: d._id }, { $set: setOps });
      }
      patched++;
    }
    console.log(`=== ${colName} === patched ${patched} docs (mode=${mode})`);
    counts[colName] = patched;
  }

  if (apply) {
    await migrationsRun.updateOne(
      { _id: MIGRATION_ID },
      { $set: { _id: MIGRATION_ID, completedAt: new Date(), counts } },
      { upsert: true }
    );
    console.log(`\n[spread-heal] stamped as ${MIGRATION_ID}`);
  }

  await closeDb();
  console.log(`[spread-heal] done.`);
}

main().catch((e) => {
  console.error("[spread-heal] failed:", e);
  process.exit(1);
});
