/**
 * READ-ONLY dry run of 2026-09-07-reprice-strategy-capacity against live.
 * Reimplements computeRepricedStock's arithmetic from the same constants so the
 * script needs no TS build step. Writes nothing.
 */
import * as dotenv from "dotenv";
import { MongoClient } from "mongodb";
dotenv.config({ path: "E:/Program Projects/A House Divided/.env.local" });
let uri = process.env.MONGODB_URI_LIVE;
if (!uri.includes("directConnection"))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";
const client = new MongoClient(uri);
const M = (n) =>
  n == null ? "-" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

const GROWTH_COST_MULTIPLIER = 3.0;
const BASE = {
  steel: 800,
  electronics: 500,
  energy: 60,
  chemicals: 220,
  pharmaceuticals: 1200,
  fertilizers: 180,
  food: 200,
  building_materials: 400,
  construction_services: 3500,
  healthcare_services: 2500,
  real_estate_services: 2200,
  software: 1000,
  financial_services: 2000,
  advertising: 150,
  vehicles: 25000,
  retail: 150,
  freight: 3000,
  consulting_services: 5000,
  iron: 120,
  coal: 150,
  oil: 80,
  rare_earth: 21000,
  timber: 400,
  natural_gas: 25,
  ordnance: 4500,
  plastics: 1000,
  network_services: 1200,
  entertainment_services: 600,
};
// Only the strategies that actually appear on live non-default rows.
const SUPPLY = {
  "extraction/standard": {
    iron: 0.25,
    coal: 0.22,
    oil: 0.14,
    rare_earth: 0.14,
    natural_gas: 0.14,
    timber: 0.12,
  },
  "extraction/rare_earth_mining": { rare_earth: 0.72 },
  "extraction/coal_mining": { coal: 0.72 },
  "extraction/iron_mining": { iron: 0.78 },
  "extraction/oil_gas": { oil: 0.58, natural_gas: 0.32 },
  "extraction/timber_logging": { timber: 0.64 },
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
  const scale = 70; // 1953 preset era unit scale
  console.log(
    `turn ${gs.currentTurn} year ${year} eraPriceIndex ${eraPriceIndex(year)} eraUnitScale ${scale}`
  );

  const sectors = await db
    .collection("corporateSectors")
    .find({ strategyId: { $nin: [null, "standard"] } })
    .toArray();
  const corps = await db
    .collection("corporations")
    .find(
      { _id: { $in: [...new Set(sectors.map((s) => s.corporationId))] } },
      { projection: { name: 1, sequentialId: 1, sharePrice: 1, totalShares: 1, isPrivate: 1 } }
    )
    .toArray();
  const cmap = new Map(corps.map((c) => [String(c._id), c]));

  let scanned = 0,
    repriced = 0,
    skipped = 0,
    unpriceable = 0;
  const perCorp = new Map();
  const rows = [];
  for (const s of sectors) {
    scanned++;
    const stock = s.capitalStock ?? 0;
    if (!(stock > 0)) continue;
    const book = s.capacityBookAnchor;
    if (typeof book !== "number" || !Number.isFinite(book) || book < 0) {
      skipped++;
      continue;
    }
    const key = `${s.sectorType}/${s.strategyId}`;
    const r = rpu(key, scale);
    if (r == null) {
      unpriceable++;
      continue;
    }
    const unitPrice = GROWTH_COST_MULTIPLIER * r * eraPriceIndex(year);
    if (!(unitPrice > 0)) continue;
    const correct = Math.min(stock, book / unitPrice);
    const removed = stock - correct;
    if (removed <= stock * 1e-6) continue;
    repriced++;
    const c = cmap.get(String(s.corporationId));
    const id = `${c?.sequentialId ?? "?"} ${c?.name ?? "?"}`;
    const revBefore = s.revenue ?? 0;
    const revAfter = revBefore * (correct / stock);
    perCorp.set(id, (perCorp.get(id) ?? 0) + (revBefore - revAfter));
    rows.push({ id, key, state: s.stateId, stock, correct, removed, revBefore, revAfter, book });
  }

  rows.sort((a, b) => b.removed - a.removed);
  console.log(
    `\nscanned ${scanned} non-default-strategy sectors; ${repriced} re-priced; ${skipped} skipped (no basis); ${unpriceable} unpriceable strategies\n`
  );
  console.log("corp | strategy | state | stock before -> after | % cut | rev/day before -> after");
  for (const r of rows) {
    console.log(
      `${r.id.slice(0, 26).padEnd(26)} ${r.key.replace("extraction/", "").padEnd(18)} ${String(r.state).padEnd(6)} ${String(M(r.stock)).padStart(9)} -> ${String(r.correct.toFixed(1)).padStart(10)}  -${((r.removed / r.stock) * 100).toFixed(2)}%  ${String(M(r.revBefore)).padStart(12)} -> ${M(r.revAfter)}`
    );
  }

  console.log("\n=== revenue/day removed per corp ===");
  for (const [id, lost] of [...perCorp.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${id.slice(0, 30).padEnd(30)} -${M(lost)}/day`);
  }

  console.log("\n=== strategies present on live non-default rows (coverage check) ===");
  const keys = new Map();
  for (const s of sectors) {
    const k = `${s.sectorType}/${s.strategyId}`;
    keys.set(k, (keys.get(k) ?? 0) + 1);
  }
  for (const [k, n] of [...keys.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${SUPPLY[k] ? "  priced" : "UNPRICED"} ${k} (${n} sectors)`);
  }
} finally {
  await client.close();
}
