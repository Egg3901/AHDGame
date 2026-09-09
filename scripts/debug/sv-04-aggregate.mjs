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

  console.log("=== USD / ITL / JPY equityMarketPools ===");
  for (const id of ["USD", "ITL", "JPY", "SUR"]) {
    const p = await db.collection("equityMarketPools").findOne({ _id: id });
    if (p)
      console.log(
        `${id} cash=${M(p.cashLocal)} target=${M(p.targetCashLocal)} m2=${M(p.m2Local)} lifetime=${JSON.stringify(p.lifetime)}`
      );
  }

  console.log("\n=== CORP 738 sector revenue by sector ===");
  const tt = await db.collection("corporations").findOne({ sequentialId: 738 });
  const secs = await db.collection("corporateSectors").find({ corporationId: tt._id }).toArray();
  let totRev = 0;
  for (const s of secs) {
    totRev += s.revenue ?? 0;
    console.log(
      `${String(s.sectorType).padEnd(16)} ${s.stateId} rev=${M(s.revenue)} margin=${s.profitMargin} workers=${M(s.workers)} capStock=${M(s.capitalStock)} capBook=${M(s.capacityBookAnchor)} growth=${s.currentGrowthRate} strat=${s.strategyId} plantsStart=${s.plantsStartTurn}`
    );
  }
  console.log("TOTAL sector revenue:", M(totRev));

  console.log("\n=== Aggregate corp liquidCapital + sectorNPV over time (corporationHistory) ===");
  const agg = await db
    .collection("corporationHistory")
    .aggregate([
      { $match: { turn: { $gte: 400 } } },
      {
        $group: {
          _id: "$turn",
          n: { $sum: 1 },
          mcap: { $sum: "$marketCap" },
          npv: { $sum: "$sectorNPV" },
          cash: { $sum: "$liquidCapital" },
          rev: { $sum: "$revenue" },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();
  console.log(
    "turn | corps | sum mcap | sum sectorNPV | sum cash | sum revenue   (mixed currency!)"
  );
  for (const a of agg) {
    if (a._id % 10 !== 0 && a._id < 685) continue;
    console.log(`${a._id} | ${a.n} | ${M(a.mcap)} | ${M(a.npv)} | ${M(a.cash)} | ${M(a.rev)}`);
  }
} finally {
  await client.close();
}
