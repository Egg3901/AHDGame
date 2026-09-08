/**
 * READ-ONLY. The three open decisions, with the live numbers behind each.
 *
 *   1. Who the re-pricing migration actually hits, and how hard.
 *   2. What removing the bond-pool inflow would do to each pool's runway.
 *   3. What the held migrations are currently leaving switched off.
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
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const GCM = 3.0;
const BASE = {
  iron: 120,
  coal: 150,
  oil: 80,
  rare_earth: 21000,
  timber: 400,
  natural_gas: 25,
  vehicles: 25000,
  steel: 800,
  ordnance: 4500,
  electronics: 500,
};
const SUPPLY = {
  "extraction/rare_earth_mining": { rare_earth: 0.72 },
  "extraction/timber_logging": { timber: 0.64 },
  "defense/heavy_armor": { vehicles: 0.55, steel: 0.2 },
};
const eraPriceIndex = (y) =>
  y < 1971 ? 1.0 : y < 1979 ? 1.4 : y < 1991 ? 2.6 : y < 1999 ? 3.6 : 5.0;
const rpu = (key, scale) => {
  const s = SUPPLY[key];
  if (!s) return null;
  let k = 0;
  for (const [c, rate] of Object.entries(s)) if (rate > 0 && BASE[c] > 0) k += rate / BASE[c];
  k *= scale;
  return k > 0 ? 1 / k : 0;
};

try {
  await client.connect();
  const db = client.db();
  const gs = await db.collection("gameState").findOne({ _id: "current" });
  const year = gs.currentYear;
  const scale = 69.76744186046511; // loadWorldEraUnitScale for 1953-default

  // ── 1. WHO THE RE-PRICING MIGRATION HITS ────────────────────────────────
  const sectors = await db
    .collection("corporateSectors")
    .find({ strategyId: { $in: ["rare_earth_mining", "timber_logging", "heavy_armor"] } })
    .toArray();
  const corpIds = [...new Set(sectors.map((s) => String(s.corporationId)))];
  const corps = await db
    .collection("corporations")
    .find({ _id: { $in: sectors.map((s) => s.corporationId) } })
    .toArray();
  const cmap = new Map(corps.map((c) => [String(c._id), c]));
  const allSectors = await db
    .collection("corporateSectors")
    .find({ corporationId: { $in: sectors.map((s) => s.corporationId) } })
    .toArray();
  const revByCorp = new Map();
  for (const s of allSectors)
    revByCorp.set(
      String(s.corporationId),
      (revByCorp.get(String(s.corporationId)) ?? 0) + num(s.revenue)
    );

  const perCorp = new Map();
  for (const s of sectors) {
    const key = `${s.sectorType}/${s.strategyId}`;
    const r = rpu(key, scale);
    if (r == null) continue;
    const unitPrice = GCM * r * eraPriceIndex(year);
    const stock = num(s.capitalStock);
    const book = num(s.capacityBookAnchor);
    if (!(stock > 0) || !(book > 0) || !(unitPrice > 0)) continue;
    const correct = Math.min(stock, book / unitPrice);
    const removed = stock - correct;
    if (removed <= stock * 1e-6) continue;
    const id = String(s.corporationId);
    const e = perCorp.get(id) ?? { n: 0, revLost: 0, bookAffected: 0 };
    e.n++;
    e.revLost += num(s.revenue) * (removed / stock);
    e.bookAffected += book;
    perCorp.set(id, e);
  }

  console.log(`=== 1. RE-PRICING IMPACT (turn ${gs.currentTurn}) ===`);
  console.log("corp | run by | public | sectors hit | rev/day lost | % of corp revenue | share px");
  const rows = [...perCorp.entries()]
    .map(([id, e]) => ({ id, ...e, c: cmap.get(id), totalRev: revByCorp.get(id) ?? 0 }))
    .sort((a, b) => b.revLost - a.revLost);
  let playerRun = 0;
  for (const r of rows) {
    const c = r.c ?? {};
    const runBy = c.ceoType === "character" ? "PLAYER" : (c.ceoType ?? "npc");
    if (runBy === "PLAYER") playerRun++;
    const pct = r.totalRev > 0 ? (r.revLost / r.totalRev) * 100 : 0;
    console.log(
      `${String(c.sequentialId ?? "?").padEnd(5)} ${String(c.name ?? "?")
        .slice(0, 24)
        .padEnd(
          24
        )} ${runBy.padEnd(9)} ${(c.isPrivate === false ? "public" : "private").padEnd(8)} ${String(r.n).padStart(3)} ${String(M(r.revLost)).padStart(14)} ${pct.toFixed(1).padStart(7)}% ${String(M(c.sharePrice)).padStart(10)}`
    );
  }
  console.log(`\n${rows.length} corps affected, ${playerRun} run by a player character.`);

  // ── 2. BOND POOL RUNWAY ─────────────────────────────────────────────────
  console.log("\n=== 2. BOND POOLS: what removing the inflow would do ===");
  const bp = await db.collection("bondMarketPools").find({}).toArray();
  console.log("ccy | cash | minted lifetime | net drain/turn | turns to dry");
  const lifeTurns = Math.max(1, gs.currentTurn - 600);
  let totalMint = 0;
  for (const p of bp.sort((a, b) => num(b.lifetime?.inflowIn) - num(a.lifetime?.inflowIn))) {
    const l = p.lifetime ?? {};
    totalMint += num(l.inflowIn);
    const netOut =
      num(l.salesOut) +
      num(l.issuanceOut) +
      num(l.sweepOut) +
      num(l.qtOut) -
      num(l.purchasesIn) -
      num(l.couponsIn) -
      num(l.maturitiesIn) -
      num(l.retiredIn) -
      num(l.qeIn);
    const perTurn = netOut / lifeTurns;
    const turns = perTurn > 0 ? num(p.cashLocal) / perTurn : Infinity;
    console.log(
      `${String(p._id).padEnd(4)} ${String(M(p.cashLocal)).padStart(18)} ${String(M(l.inflowIn)).padStart(18)} ${String(perTurn > 0 ? M(perTurn) : "net inflow").padStart(14)} ${String(turns === Infinity ? "never" : Math.round(turns)).padStart(13)}`
    );
  }
  console.log(`\ntotal bond-pool minting, mixed ccy: ${M(totalMint)}`);

  // ── 3. WHAT THE HELD MIGRATIONS LEAVE OFF ───────────────────────────────
  console.log("\n=== 3. HELD MIGRATIONS: what is currently switched off ===");
  const pools = await db.collection("equityMarketPools").find({}).toArray();
  const withSeed = pools.filter((p) => typeof p.seedLocal === "number").length;
  console.log(`equity pools: ${pools.length} total, ${withSeed} carry seedLocal`);
  console.log(
    `=> poolConservationResidual returns NaN for ${pools.length - withSeed} of them, so the`
  );
  console.log("   per-turn conservation warning is inert on every pool until the backfill runs.");
  const stillGrowing = sectors.filter((s) => num(s.capitalStock) > 0).length;
  console.log(`\ndefective-pair sectors still holding mispriced capacity: ${stillGrowing}`);
} finally {
  await client.close();
}
