// What-if: per-resource capacity scale (bearing states only) — READ-ONLY (audit t786)
// Usage: cd /root/projects/a-house-divided && node scripts/economy-whatif-capacity-t786.js
require("dotenv").config({ path: "./.env.local" });
const { MongoClient } = require("mongodb");

const BASE = {
  iron: 120,
  coal: 150,
  oil: 80,
  rare_earth: 50000,
  copper: 9000,
  natural_gas: 25,
  timber: 400,
};
const RESOURCES = Object.keys(BASE);
const BROAD = {
  iron: 0.4,
  coal: 0.3,
  oil: 0.14,
  rare_earth: 0.03,
  copper: 0.03,
  natural_gas: 0.24,
  timber: 0.2,
};
const STRAT = {
  iron_mining: { iron: 0.78 },
  oil_gas: { oil: 0.58, natural_gas: 0.32 },
  rare_earth_mining: { rare_earth: 0.45 },
  coal_mining: { coal: 0.72 },
  copper_mining: { copper: 0.72 },
  timber_logging: { timber: 0.64 },
};

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");
  const gs = await db.collection("gameState").findOne({ _id: "current" });

  const fxDocs = await db.collection("exchangeRates").find({}).toArray();
  const fxMap = { USD: 1 };
  for (const r of fxDocs) fxMap[r.currencyCode || r._id] = r.rate;
  const corps = await db
    .collection("corporations")
    .find({})
    .project({ liquidCurrencyCode: 1 })
    .toArray();
  const corpFx = {};
  for (const c of corps) corpFx[c._id.toString()] = fxMap[c.liquidCurrencyCode] || 1;

  const sectors = await db
    .collection("corporateSectors")
    .find({ sectorType: "extraction" })
    .project({ stateId: 1, revenue: 1, strategyId: 1, corporationId: 1 })
    .toArray();
  const caps = await db.collection("stateResourceCapacity").find({}).toArray();
  const capByState = {};
  for (const c of caps) capByState[c.stateId] = c.resources || {};

  const byState = {};
  for (const s of sectors) {
    const fx = corpFx[s.corporationId?.toString()] || 1;
    const revA = (s.revenue || 0) / fx;
    const rates = (s.strategyId && s.strategyId !== "standard" && STRAT[s.strategyId]) || BROAD;
    const st = (byState[s.stateId] = byState[s.stateId] || {});
    for (const [r, rate] of Object.entries(rates)) st[r] = (st[r] || 0) + (revA * rate) / BASE[r];
  }

  function supplyUnder(scaleMap) {
    const out = {};
    for (const r of RESOURCES) out[r] = 0;
    for (const [stateId, outputs] of Object.entries(byState)) {
      const capDoc = capByState[stateId];
      for (const [r, o] of Object.entries(outputs)) {
        if (!capDoc) {
          out[r] += o;
          continue;
        }
        const rawCap = capDoc[r] ?? 0;
        if (rawCap <= 0) continue; // geologically absent — never fabricate
        const cap = rawCap * (scaleMap[r] ?? 1);
        out[r] += Math.min(o, cap);
      }
    }
    return out;
  }

  const hist = await db
    .collection("commodityPriceHistory")
    .find({ turn: gs.currentTurn, commodity: { $in: RESOURCES } })
    .toArray();
  const demand = {};
  for (const h of hist) demand[h.commodity] = h.globalDemand;

  const now = supplyUnder({});
  const uniform = (k) => Object.fromEntries(RESOURCES.map((r) => [r, k]));
  const ceiling = supplyUnder(uniform(Infinity)); // no binding in bearing states
  const levels = [2, 3, 5, 8, 12];
  const supplyAt = levels.map((k) => supplyUnder(uniform(k)));
  console.log(`turn=${gs.currentTurn}  (bearing-state cap × factor; demand incl. 50k stab)\n`);
  console.log(
    "resource      | D/S now |" +
      levels.map((k) => ` D/S×${k}`.padStart(8)).join(" |") +
      " | D/S ceil (uncapped, geol.)"
  );
  for (const r of RESOURCES) {
    const cells = supplyAt.map((s) => (demand[r] / s[r]).toFixed(2).padStart(7));
    console.log(
      r.padEnd(13),
      "|",
      (demand[r] / now[r]).toFixed(2).padStart(7),
      "|",
      cells.join(" | "),
      "|",
      (demand[r] / ceiling[r]).toFixed(2).padStart(7)
    );
  }
  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
