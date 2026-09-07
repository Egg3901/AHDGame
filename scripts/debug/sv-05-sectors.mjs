import * as dotenv from "dotenv";
import { MongoClient } from "mongodb";
dotenv.config({ path: "E:/Program Projects/A House Divided/.env.local" });
let uri = process.env.MONGODB_URI_LIVE;
if (!uri.includes("directConnection"))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";
const client = new MongoClient(uri);
const M = (n) =>
  n == null ? "-" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
try {
  await client.connect();
  const db = client.db();

  console.log("=== TOP 30 corporateSectors BY REVENUE ===");
  const top = await db
    .collection("corporateSectors")
    .find(
      {},
      {
        projection: {
          corporationId: 1,
          sectorType: 1,
          countryId: 1,
          stateId: 1,
          revenue: 1,
          workers: 1,
          capitalStock: 1,
          capacityBookAnchor: 1,
          strategyId: 1,
          plantsStartTurn: 1,
          profitMargin: 1,
        },
      }
    )
    .sort({ revenue: -1 })
    .limit(30)
    .toArray();
  const corpIds = [...new Set(top.map((s) => String(s.corporationId)))];
  const corps = await db
    .collection("corporations")
    .find(
      { _id: { $in: top.map((s) => s.corporationId) } },
      { projection: { name: 1, sequentialId: 1, countryId: 1, sharePrice: 1 } }
    )
    .toArray();
  const byId = new Map(corps.map((c) => [String(c._id), c]));
  for (const s of top) {
    const c = byId.get(String(s.corporationId));
    console.log(
      `${String(c?.sequentialId ?? "?").padEnd(5)} ${String(c?.name ?? "?")
        .slice(0, 20)
        .padEnd(
          20
        )} ${String(s.sectorType).padEnd(14)} ${s.countryId}/${s.stateId} rev=${M(s.revenue)} wk=${M(s.workers)} cap=${M(s.capitalStock)} capBook=${M(s.capacityBookAnchor)} r/w=${M((s.revenue || 0) / (s.workers || 1))} r/c=${((s.revenue || 0) / (s.capitalStock || 1)).toFixed(1)} strat=${s.strategyId} pst=${s.plantsStartTurn}`
    );
  }

  console.log("\n=== revenue-per-worker distribution by sectorType (all sectors) ===");
  const agg = await db
    .collection("corporateSectors")
    .aggregate([
      { $match: { workers: { $gt: 0 }, revenue: { $gt: 0 } } },
      {
        $group: {
          _id: "$sectorType",
          n: { $sum: 1 },
          totRev: { $sum: "$revenue" },
          totWk: { $sum: "$workers" },
          maxRev: { $max: "$revenue" },
        },
      },
      { $sort: { totRev: -1 } },
    ])
    .toArray();
  for (const a of agg) {
    console.log(
      `${String(a._id).padEnd(16)} n=${String(a.n).padEnd(5)} totRev=${M(a.totRev)} totWk=${M(a.totWk)} rev/wk=${M(a.totRev / a.totWk)} maxRev=${M(a.maxRev)}`
    );
  }

  console.log("\n=== extraction sectors by strategy ===");
  const agg2 = await db
    .collection("corporateSectors")
    .aggregate([
      { $match: { sectorType: "extraction" } },
      {
        $group: {
          _id: "$strategyId",
          n: { $sum: 1 },
          totRev: { $sum: "$revenue" },
          totWk: { $sum: "$workers" },
          maxRev: { $max: "$revenue" },
        },
      },
      { $sort: { totRev: -1 } },
    ])
    .toArray();
  for (const a of agg2) {
    console.log(
      `${String(a._id).padEnd(22)} n=${String(a.n).padEnd(5)} totRev=${M(a.totRev)} totWk=${M(a.totWk)} rev/wk=${M(a.totRev / (a.totWk || 1))} maxRev=${M(a.maxRev)}`
    );
  }
} finally {
  await client.close();
}
