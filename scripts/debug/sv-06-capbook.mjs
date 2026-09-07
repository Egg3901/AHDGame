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

  console.log("=== revenue / capacityBookAnchor  by sectorType (US only, same currency) ===");
  const rows = await db
    .collection("corporateSectors")
    .find(
      { countryId: "US" },
      {
        projection: {
          sectorType: 1,
          strategyId: 1,
          revenue: 1,
          realizedRevenue: 1,
          capacityBookAnchor: 1,
          capitalStock: 1,
          workers: 1,
          corporationId: 1,
          stateId: 1,
          plantsStartTurn: 1,
        },
      }
    )
    .toArray();
  const byType = new Map();
  for (const r of rows) {
    const k = r.sectorType;
    if (!byType.has(k)) byType.set(k, { n: 0, rev: 0, rr: 0, cb: 0, cs: 0, wk: 0 });
    const g = byType.get(k);
    g.n++;
    g.rev += r.revenue ?? 0;
    g.rr += r.realizedRevenue ?? r.revenue ?? 0;
    g.cb += r.capacityBookAnchor ?? 0;
    g.cs += r.capitalStock ?? 0;
    g.wk += r.workers ?? 0;
  }
  console.log("type | n | sumRevenue | sumRealized | sumCapBook | rev/capBook | realized/capBook");
  for (const [k, g] of [...byType.entries()].sort((a, b) => b[1].rev - a[1].rev)) {
    console.log(
      `${String(k).padEnd(20)} n=${String(g.n).padEnd(4)} rev=${String(M(g.rev)).padStart(14)} rr=${String(M(g.rr)).padStart(14)} cb=${String(M(g.cb)).padStart(13)} r/cb=${(g.rev / (g.cb || 1)).toFixed(2)} rr/cb=${(g.rr / (g.cb || 1)).toFixed(2)}`
    );
  }

  console.log("\n=== US extraction sectors by strategy: rev vs capBook ===");
  const ex = new Map();
  for (const r of rows.filter((r) => r.sectorType === "extraction")) {
    const k = r.strategyId ?? "null";
    if (!ex.has(k)) ex.set(k, { n: 0, rev: 0, rr: 0, cb: 0, wk: 0 });
    const g = ex.get(k);
    g.n++;
    g.rev += r.revenue ?? 0;
    g.rr += r.realizedRevenue ?? r.revenue ?? 0;
    g.cb += r.capacityBookAnchor ?? 0;
    g.wk += r.workers ?? 0;
  }
  for (const [k, g] of [...ex.entries()].sort((a, b) => b[1].rev - a[1].rev)) {
    console.log(
      `${String(k).padEnd(22)} n=${String(g.n).padEnd(4)} rev=${String(M(g.rev)).padStart(14)} rr=${String(M(g.rr)).padStart(14)} cb=${String(M(g.cb)).padStart(12)} wk=${String(M(g.wk)).padStart(9)} r/cb=${(g.rev / (g.cb || 1)).toFixed(2)}`
    );
  }

  console.log("\n=== TOP 20 US sectors by revenue/capacityBookAnchor (capBook>1000, rev>100k) ===");
  const corps = await db
    .collection("corporations")
    .find({}, { projection: { name: 1, sequentialId: 1 } })
    .toArray();
  const cmap = new Map(corps.map((c) => [String(c._id), c]));
  const ranked = rows
    .filter((r) => (r.capacityBookAnchor ?? 0) > 1000 && (r.revenue ?? 0) > 100000)
    .map((r) => ({ ...r, ratio: (r.revenue ?? 0) / r.capacityBookAnchor }))
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 20);
  for (const r of ranked) {
    const c = cmap.get(String(r.corporationId));
    console.log(
      `${String(c?.sequentialId ?? "?").padEnd(5)} ${String(c?.name ?? "?")
        .slice(0, 22)
        .padEnd(
          22
        )} ${String(r.sectorType).padEnd(12)} ${r.stateId} strat=${String(r.strategyId).padEnd(18)} rev=${String(M(r.revenue)).padStart(12)} rr=${String(M(r.realizedRevenue)).padStart(12)} cb=${String(M(r.capacityBookAnchor)).padStart(10)} ratio=${r.ratio.toFixed(1)} wk=${M(r.workers)} pst=${r.plantsStartTurn}`
    );
  }
} finally {
  await client.close();
}
