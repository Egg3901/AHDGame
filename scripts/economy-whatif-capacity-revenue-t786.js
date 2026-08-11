// What-if: how much extraction revenue would capacity utilization haircut? READ-ONLY (t786)
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

  // aggregate open-access pool per state/resource (contracts ~0), then per-sector kept fraction
  const stateOutputs = {}; // stateId -> resource -> total output
  const perSector = [];
  for (const s of sectors) {
    const fx = corpFx[s.corporationId?.toString()] || 1;
    const revA = (s.revenue || 0) / fx;
    const rates = (s.strategyId && s.strategyId !== "standard" && STRAT[s.strategyId]) || BROAD;
    const out = {};
    for (const [r, rate] of Object.entries(rates)) {
      const o = (revA * rate) / BASE[r];
      out[r] = o;
      stateOutputs[s.stateId] = stateOutputs[s.stateId] || {};
      stateOutputs[s.stateId][r] = (stateOutputs[s.stateId][r] || 0) + o;
    }
    perSector.push({ revA, rates, out, stateId: s.stateId });
  }

  function haircutUnder(scaleMap) {
    let total = 0,
      lost = 0;
    for (const ps of perSector) {
      const cap = capByState[ps.stateId] || {};
      let rateSum = 0,
        keptRateSum = 0;
      for (const [r, rate] of Object.entries(ps.rates)) {
        rateSum += rate;
        const rawCap = (cap[r] ?? 0) * (scaleMap[r] ?? 1);
        const stateOut = stateOutputs[ps.stateId][r] || 0;
        let keptFrac;
        if ((cap[r] ?? 0) <= 0)
          keptFrac = 0; // geologically absent
        else if (stateOut <= rawCap) keptFrac = 1;
        else keptFrac = rawCap / stateOut; // proportional open-access share
        keptRateSum += rate * keptFrac;
      }
      const weightedUtil = rateSum > 0 ? keptRateSum / rateSum : 1;
      total += ps.revA;
      lost += ps.revA * (1 - weightedUtil);
    }
    return { total, lost, pct: (lost / total) * 100 };
  }

  const now = haircutUnder({});
  const reseed = haircutUnder({ iron: 3, oil: 2.5, natural_gas: 2.5, coal: 1.2, timber: 2 });
  const ceil = haircutUnder(Object.fromEntries(Object.keys(BASE).map((r) => [r, Infinity])));
  console.log(
    `extraction sectors=${sectors.length}, total anchor rev/turn=${Math.round(now.total).toLocaleString()}\n`
  );
  console.log("If realized extraction revenue = stored × weightedCapacityUtilization:");
  console.log(
    `  current capacity:   revenue lost = ${Math.round(now.lost).toLocaleString()} (${now.pct.toFixed(1)}%)`
  );
  console.log(
    `  reseed (3/2.5/2.5/1.2/2): lost = ${Math.round(reseed.lost).toLocaleString()} (${reseed.pct.toFixed(1)}%)`
  );
  console.log(
    `  ceiling (no cap bind):    lost = ${Math.round(ceil.lost).toLocaleString()} (${ceil.pct.toFixed(1)}%)`
  );
  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
