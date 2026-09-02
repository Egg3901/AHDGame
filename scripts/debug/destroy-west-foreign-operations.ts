/**
 * Destroy the foreign-owned operations sitting in former West Germany.
 *
 * The unified state is a command economy that owns every German-domiciled firm,
 * but 42 operations inside its borders belong to foreign multinationals that
 * came with the Federal Republic's territory. This closes the ones in the former
 * West and returns their capacity to the unowned pool.
 *
 * THE PARENT COMPANIES SURVIVE UNTOUCHED. Only `corporateSectors` rows inside
 * Germany are removed; the corporation documents and every operation abroad are
 * left exactly as they are. Marks & Spencer keeps its eight British and thirteen
 * American stores and loses three German ones. This is the distinction I got
 * wrong when I set `countryOwnerId` — that field is whole-company, so seizing a
 * branch through it took the whole multinational. Deleting the operation is the
 * only thing that acts on Germany alone.
 *
 * USES THE GAME'S OWN EXIT PATH. `restoreSectorsToUnowned` is what
 * `abandonSector` and the bond-default liquidations call: it credits the
 * `unownedSectors` pool idempotently FIRST and deletes the sector rows only
 * after, so a crash cannot lose the market. Raw-deleting the rows would strand
 * the capacity instead of returning it.
 *
 * NO CAPEX REFUND, unlike a voluntary abandonment: a firm whose plant is seized
 * and closed is not reimbursed for the building work it had queued.
 *
 * ⚠️ BERLIN IS EXCLUDED. The original merge fused East Berlin into Berlin, so the
 * four foreign operations there cannot be attributed to either half any more —
 * "in West Germany" is unanswerable for them from the data. They are reported,
 * not destroyed.
 *
 * DRY RUN BY DEFAULT. `--apply` writes.
 */
import { MongoClient, ObjectId, type Db } from "mongodb";
import { config } from "dotenv";
import { restoreSectorsToUnowned } from "@/lib/corporations/restoreSectorsToUnowned";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
/** The GDR's own Laender. Berlin is deliberately not in either list. */
const EAST = new Set(["MV", "BB", "ST", "SN", "TH"]);

async function main() {
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE not set");
  const client = new MongoClient(uri, { directConnection: true });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_LIVE || undefined);

  const gs = await db.collection("gameState").findOne({ _id: "current" as never });
  console.log(
    `${APPLY ? "APPLY" : "DRY RUN"} — turn ${gs?.currentTurn} processing=${gs?.processingStartedAt ?? "-"}\n`
  );

  const sectors = await db.collection("corporateSectors").find({ countryId: "DD" }).toArray();
  const corps = await db
    .collection("corporations")
    .find({
      _id: {
        $in: [...new Set(sectors.map((s) => String(s.corporationId)))].map((i) => new ObjectId(i)),
      },
    } as never)
    .project({ name: 1, countryId: 1 })
    .toArray();
  const byId = new Map(corps.map((c) => [String(c._id), c]));

  const isForeign = (s: Record<string, unknown>) => {
    const c = byId.get(String(s.corporationId));
    return c != null && String(c.countryId) !== "DD";
  };
  const west = sectors.filter(
    (s) => isForeign(s) && !EAST.has(String(s.stateId)) && String(s.stateId) !== "BE"
  );
  const berlin = sectors.filter((s) => isForeign(s) && String(s.stateId) === "BE");
  const east = sectors.filter((s) => isForeign(s) && EAST.has(String(s.stateId)));

  console.log(`foreign operations in the former WEST (to destroy): ${west.length}`);
  console.log(`foreign operations in Berlin (excluded, unattributable): ${berlin.length}`);
  console.log(`foreign operations in the former EAST: ${east.length}\n`);

  const byFirm = new Map<string, { home: string; ops: number; workers: number; revenue: number }>();
  for (const s of west) {
    const c = byId.get(String(s.corporationId))!;
    const e = byFirm.get(String(c.name)) ?? {
      home: String(c.countryId),
      ops: 0,
      workers: 0,
      revenue: 0,
    };
    e.ops++;
    e.workers += Number(s.workers ?? 0);
    e.revenue += Number(s.revenue ?? 0);
    byFirm.set(String(c.name), e);
  }
  console.log(
    "firm".padEnd(40) +
      "home".padEnd(6) +
      "ops".padStart(5) +
      "workers".padStart(10) +
      "revenue".padStart(14)
  );
  for (const [name, v] of [...byFirm.entries()].sort((a, b) => b[1].revenue - a[1].revenue)) {
    console.log(
      name.padEnd(40) +
        v.home.padEnd(6) +
        String(v.ops).padStart(5) +
        Math.round(v.workers).toLocaleString().padStart(10) +
        Math.round(v.revenue).toLocaleString().padStart(14)
    );
  }

  const queued = west.filter((s) => Array.isArray(s.buildQueue) && s.buildQueue.length > 0);
  console.log(`\noperations with construction queued (no refund is paid): ${queued.length}`);

  // Every operation abroad that these same firms keep.
  const firmIds = [...new Set(west.map((s) => String(s.corporationId)))];
  const abroad = await db.collection("corporateSectors").countDocuments({
    corporationId: { $in: firmIds.map((i) => new ObjectId(i)) },
    countryId: { $ne: "DD" },
  } as never);
  console.log(`operations these firms keep outside Germany: ${abroad}`);

  if (APPLY) {
    const result = await restoreSectorsToUnowned(db as unknown as Db, west as never, new Date());
    console.log(
      `\nAPPLIED — ${result.sectorsDeleted} operation(s) destroyed, ` +
        `${result.poolsUpdated} unowned pool(s) credited, ` +
        `${Math.round(result.totalRevenueRestored).toLocaleString()} revenue returned to the pool.`
    );
  } else {
    console.log("\nDRY RUN — nothing written.");
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
