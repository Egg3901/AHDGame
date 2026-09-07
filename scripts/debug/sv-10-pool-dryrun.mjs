/**
 * READ-ONLY dry run of 2026-09-07-equity-pool-seed-backfill, plus the
 * exhaustion projection the conservation change needs. Writes nothing.
 */
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
const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const inferSeed = (p) => {
  const l = p.lifetime ?? {};
  const net =
    n(l.purchasesIn) +
    n(l.dividendsIn) +
    n(l.inflowIn) -
    n(l.salesOut) -
    n(l.issuanceOut) -
    n(l.sweepOut);
  return Math.max(0, n(p.cashLocal) - net);
};
const residual = (p, seed) => {
  const l = p.lifetime ?? {};
  return (
    n(p.cashLocal) -
    (seed + n(l.purchasesIn) + n(l.dividendsIn) - n(l.salesOut) - n(l.issuanceOut) - n(l.sweepOut))
  );
};

try {
  await client.connect();
  const db = client.db();
  const gs = await db.collection("gameState").findOne({ _id: "current" });
  const pools = await db.collection("equityMarketPools").find({}).toArray();

  console.log(`turn ${gs.currentTurn}\n`);
  console.log("=== seed backfill (DRY RUN) ===");
  console.log("ccy      cashLocal        inferred seed        residual (= minted)");
  let totalMinted = 0;
  for (const p of pools.sort((a, b) => n(b.lifetime?.inflowIn) - n(a.lifetime?.inflowIn))) {
    const seed = inferSeed(p);
    const r = residual(p, seed);
    totalMinted += r;
    console.log(
      `${String(p._id).padEnd(5)} ${String(M(p.cashLocal)).padStart(18)} ${String(M(seed)).padStart(20)} ${String(M(r)).padStart(20)}`
    );
  }
  console.log(`\ntotal residual across all pools (mixed ccy): ${M(totalMinted)}`);

  console.log("\n=== exhaustion projection with the inflow removed ===");
  console.log("Net drain per turn is estimated from lifetime salesOut - purchasesIn over the");
  console.log("pool's life, so it is an average, not a spot rate.\n");
  console.log("ccy      cash now        net drain/turn      turns to dry");
  const lifeTurns = Math.max(1, gs.currentTurn - 600); // pools created ~turn 600
  for (const p of pools) {
    const l = p.lifetime ?? {};
    const netOut = n(l.salesOut) + n(l.issuanceOut) - n(l.purchasesIn) - n(l.dividendsIn);
    const perTurn = netOut / lifeTurns;
    const turns = perTurn > 0 ? n(p.cashLocal) / perTurn : Infinity;
    if (perTurn <= 0) continue;
    console.log(
      `${String(p._id).padEnd(5)} ${String(M(p.cashLocal)).padStart(16)} ${String(M(perTurn)).padStart(18)} ${String(turns === Infinity ? "never" : Math.round(turns)).padStart(16)}`
    );
  }
  console.log("\n(pools with no net drain are omitted: they are net-funded by real purchases)");
} finally {
  await client.close();
}
