import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient } from "mongodb";
const __d = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__d, "../../.env.local") });
let uri = process.env.MONGODB_URI_LIVE;
if (!uri.includes("directConnection"))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";
const client = new MongoClient(uri);
const M = (n) =>
  n == null ? "-" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
try {
  await client.connect();
  const db = client.db();

  console.log("=== ALL rare_earth_mining sectors (global) ===");
  const rows = await db
    .collection("corporateSectors")
    .find({ strategyId: "rare_earth_mining" })
    .toArray();
  const corps = await db
    .collection("corporations")
    .find(
      { _id: { $in: rows.map((r) => r.corporationId) } },
      { projection: { name: 1, sequentialId: 1, sharePrice: 1, totalShares: 1, countryId: 1 } }
    )
    .toArray();
  const cmap = new Map(corps.map((c) => [String(c._id), c]));
  let totRev = 0,
    totCb = 0;
  for (const r of rows.sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))) {
    const c = cmap.get(String(r.corporationId));
    totRev += r.revenue ?? 0;
    totCb += r.capacityBookAnchor ?? 0;
    console.log(
      `${String(c?.sequentialId ?? "?").padEnd(5)} ${String(c?.name ?? "?")
        .slice(0, 24)
        .padEnd(
          24
        )} ${r.countryId}/${r.stateId} rev/day=${String(M(r.revenue)).padStart(12)} capBook=${String(M(r.capacityBookAnchor)).padStart(10)} stock=${String(M(r.capitalStock)).padStart(9)} wk=${String(M(r.workers)).padStart(8)} pst=${r.plantsStartTurn}`
    );
  }
  console.log(
    `TOTAL rev/day=${M(totRev)} capBook=${M(totCb)} ratio=${(totRev / totCb).toFixed(1)}`
  );

  console.log("\n=== equityMarketPools: net minted (inflowIn) vs net paid out ===");
  const pools = await db.collection("equityMarketPools").find({}).toArray();
  let gIn = 0,
    gOut = 0,
    gInflow = 0;
  console.log("ccy | cash | target | purchasesIn | salesOut | inflowIn(MINTED) | sweepOut");
  for (const p of pools.sort((a, b) => (b.lifetime?.inflowIn ?? 0) - (a.lifetime?.inflowIn ?? 0))) {
    const l = p.lifetime ?? {};
    gIn += l.purchasesIn ?? 0;
    gOut += l.salesOut ?? 0;
    gInflow += l.inflowIn ?? 0;
    console.log(
      `${String(p._id).padEnd(4)} ${String(M(p.cashLocal)).padStart(15)} ${String(M(p.targetCashLocal)).padStart(15)} ${String(M(l.purchasesIn)).padStart(14)} ${String(M(l.salesOut)).padStart(14)} ${String(M(l.inflowIn)).padStart(15)} ${String(M(l.sweepOut)).padStart(14)}`
    );
  }
  console.log(
    `\nGLOBAL (mixed ccy) purchasesIn=${M(gIn)} salesOut=${M(gOut)} inflowIn(minted)=${M(gInflow)}`
  );

  console.log("\n=== corp 738 shareholder cash-out: shareTradeHistory detail ===");
  const tt = await db.collection("corporations").findOne({ sequentialId: 738 });
  const tr = await db
    .collection("shareTradeHistory")
    .find({ corporationId: tt._id })
    .sort({ turn: 1 })
    .toArray();
  for (const t of tr) {
    console.log(JSON.stringify(t).slice(0, 600));
  }
} finally {
  await client.close();
}
