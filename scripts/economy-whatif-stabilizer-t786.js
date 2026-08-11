// What-if: per-commodity stabilizer vs current flat 50k — READ-ONLY (audit t786)
// Usage: cd /root/projects/a-house-divided && node scripts/economy-whatif-stabilizer-t786.js
require("dotenv").config({ path: "./.env.local" });
const { MongoClient } = require("mongodb");

const OLD_STAB = 50000;
const LOG_SCALE = 0.7; // COMMODITY_PRICE_LOG_SCALE
const KNEE = 3; // COMMODITY_PRESSURE_SOFT_KNEE
const TAIL = 0.25; // COMMODITY_PRESSURE_TAIL_SLOPE

// Mirror computeEffectiveCommodityPressureRatio(supply, demand) -> demand pressure (D/S)
function effPressure(supply, demand) {
  const s = Math.max(supply, 0.01),
    d = Math.max(demand, 0.01);
  const raw = d / s;
  if (raw <= 0 || !Number.isFinite(raw)) return 1;
  const lp = Math.log(raw),
    alp = Math.abs(lp),
    klp = Math.log(KNEE);
  if (alp <= klp) return raw;
  return Math.exp(Math.sign(lp) * (klp + (alp - klp) * TAIL));
}
// Mirror computeMarketPrice: shortage (D>S) -> price above base
function priceOverBase(supply, demand) {
  const ratio = effPressure(supply, demand);
  const lp = Math.log(ratio);
  return lp >= 0 ? 1 + LOG_SCALE * lp : 1 / (1 + LOG_SCALE * -lp);
}

// Proposed per-commodity stabilizer: ~5% of real demand, floored/capped.
function proposedStab(realD) {
  const raw = Math.max(1500, Math.min(50000, realD * 0.05));
  // round to 2 significant figures for a legible constant
  const mag = Math.pow(10, Math.floor(Math.log10(raw)) - 1);
  return Math.round(raw / mag) * mag;
}

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");
  const gs = await db.collection("gameState").findOne({ _id: "current" });
  const T = gs.currentTurn;

  const latest = await db
    .collection("commodityPriceHistory")
    .find({ turn: T })
    .project({ commodity: 1, globalSupply: 1, globalDemand: 1, globalPrice: 1 })
    .toArray();

  console.log(
    `turn=${T} year=${gs.currentYear || "?"}  (proposed stab = clamp(realD*0.05, 1500, 50000))\n`
  );
  console.log(
    "commodity            | realS  | realD  || old stab | oldRatio old p/b || new stab | newRatio new p/b | Δp/b"
  );
  const rows = [];
  for (const d of latest) {
    const realS = Math.max(0, d.globalSupply - OLD_STAB);
    const realD = Math.max(0, d.globalDemand - OLD_STAB);
    const stab2 = proposedStab(realD);
    const oldR = d.globalDemand / d.globalSupply;
    const oldP = priceOverBase(d.globalSupply, d.globalDemand);
    const newS = realS + stab2,
      newD = realD + stab2;
    const newR = newD / newS;
    const newP = priceOverBase(newS, newD);
    rows.push({ c: d.commodity, realS, realD, stab2, oldR, oldP, newR, newP, dP: newP - oldP });
  }
  rows.sort((a, b) => Math.abs(b.dP) - Math.abs(a.dP));
  for (const r of rows) {
    console.log(
      r.c.padEnd(20),
      "|",
      String(Math.round(r.realS)).padStart(6),
      "|",
      String(Math.round(r.realD)).padStart(6),
      "||",
      String(OLD_STAB).padStart(8),
      "|",
      r.oldR.toFixed(2).padStart(8),
      r.oldP.toFixed(2).padStart(5),
      "||",
      String(r.stab2).padStart(8),
      "|",
      r.newR.toFixed(2).padStart(8),
      r.newP.toFixed(2).padStart(5),
      "|",
      (r.dP >= 0 ? "+" : "") + r.dP.toFixed(2)
    );
  }
  console.log("\n(only commodities where |Δp/b| > 0.05 are materially affected)");
  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
