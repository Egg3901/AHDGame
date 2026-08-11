/**
 * Signed delta approach: delta = stateGdp × fraction × (neutralRate - primeRate) × sensitivity / basePrice
 * Zero at neutral, negative at high rates (suppresses demand), positive at low rates (boosts demand).
 */
const { MongoClient } = require("mongodb");
require("dotenv").config({ path: ".env.local" });

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is required");
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");

  const [stateBudgets, states, banks, fxDocs, latestCommodities] = await Promise.all([
    db
      .collection("stateBudgets")
      .find({}, { projection: { stateId: 1, stateGdp: 1 } })
      .toArray(),
    db
      .collection("states")
      .find({}, { projection: { _id: 1, countryId: 1 } })
      .toArray(),
    db.collection("centralBanks").find({}).toArray(),
    db.collection("exchangeRates").find({}).toArray(),
    db
      .collection("commodityPriceHistory")
      .aggregate([
        { $sort: { turn: -1 } },
        {
          $group: {
            _id: "$commodity",
            supply: { $first: "$globalSupply" },
            demand: { $first: "$globalDemand" },
            turn: { $first: "$turn" },
          },
        },
      ])
      .toArray(),
  ]);

  const fxByCode = new Map([["USD", 1.0]]);
  for (const r of fxDocs) {
    if (r.currencyCode) fxByCode.set(r.currencyCode, r.rate);
  }
  const countryToCurrency = {
    US: "USD",
    UK: "GBP",
    JP: "JPY",
    DE: "EUR",
    CN: "CNY",
    BR: "BRL",
    IE: "EUR",
    CA: "USD",
  };
  const stateToCountry = new Map(states.map((s) => [s._id, s.countryId]));
  const rateByCountry = new Map(banks.map((b) => [b.countryId, b.primeRate]));
  const NEUTRAL = 2.75;

  const anchorGdpByState = new Map();
  const anchorGdpByCountry = new Map();
  for (const sb of stateBudgets) {
    if (!sb.stateGdp || sb.stateGdp <= 0) continue;
    const stateId = sb.stateId || sb._id;
    const countryId = stateToCountry.get(stateId);
    if (!countryId) continue;
    const currCode = countryToCurrency[countryId] || "USD";
    const anchor = sb.stateGdp / (fxByCode.get(currCode) || 1);
    anchorGdpByState.set(stateId, anchor);
    anchorGdpByCountry.set(countryId, (anchorGdpByCountry.get(countryId) || 0) + anchor);
  }

  const current = {};
  for (const d of latestCommodities) current[d._id] = { supply: d.supply, demand: d.demand };

  const BASE_PRICES = { food: 200, vehicles: 25000, financial_services: 2000 };

  // delta = stateGdp × fraction × (NEUTRAL - primeRate) × sensitivity / basePrice
  // clamped per state to prevent any one state from extreme swings
  function simulate(commodity, fraction, sensitivity, _clampPct) {
    let totalDelta = 0;
    const byCountry = {};
    const cur = current[commodity];
    void cur; // referenced only for context; clamp reference unused after refactor

    for (const [stateId, gdp] of anchorGdpByState) {
      const countryId = stateToCountry.get(stateId);
      if (!countryId) continue;
      const rate = rateByCountry.get(countryId) ?? NEUTRAL;
      const delta = (gdp * fraction * (NEUTRAL - rate) * sensitivity) / BASE_PRICES[commodity];
      totalDelta += delta;
      byCountry[countryId] = (byCountry[countryId] || 0) + delta;
    }

    // Show what delta is at each country's rate
    return {
      totalDelta,
      newDemand: cur.demand + totalDelta,
      newDS: (cur.demand + totalDelta) / cur.supply,
      oldDS: cur.demand / cur.supply,
      pctChange: (totalDelta / cur.demand) * 100,
      byCountry,
    };
  }

  // Per-country rate delta contribution (for a given fraction×sensitivity)
  function countryDelta(rate, fraction, sensitivity, basePrice, gdp) {
    return (gdp * fraction * (NEUTRAL - rate) * sensitivity) / basePrice;
  }

  console.log("=== ANCHOR GDP (from stateBudgets.stateGdp) ===");
  for (const [cid, gdp] of [...anchorGdpByCountry.entries()].sort((a, b) => b[1] - a[1])) {
    const rate = rateByCountry.get(cid) ?? "?";
    console.log(cid.padEnd(4), String(rate + "%").padStart(6), "  ₳" + Math.round(gdp / 1e9) + "B");
  }

  console.log("\n=== CURRENT COMMODITY STATE ===");
  for (const c of ["food", "vehicles", "financial_services"]) {
    const d = current[c];
    console.log(
      c.padEnd(22),
      "D:",
      d.demand.toFixed(0),
      "  S:",
      d.supply.toFixed(0),
      "  D/S:",
      (d.demand / d.supply).toFixed(4)
    );
  }

  // Show per-country rate deviations
  console.log("\n=== RATE DEVIATION FROM NEUTRAL (2.75%) ===");
  console.log("Country  Prime    Deviation   Effect");
  for (const b of banks.sort((a, b) => b.primeRate - a.primeRate)) {
    const dev = NEUTRAL - b.primeRate;
    const sign = dev >= 0 ? "+" : "";
    console.log(
      b.countryId.padEnd(8),
      String(b.primeRate + "%").padStart(6),
      (sign + dev.toFixed(2) + "pp").padStart(12),
      dev >= 0 ? "↑ BOOST" : "↓ SUPPRESS"
    );
  }

  // Calibration grid
  console.log("\n=== SIGNED DELTA SIMULATION ===");
  console.log("Format: totalDelta  newD/S  (% of current demand)\n");

  const combos = [
    // food: gentle sensitivity — target ~2-8% delta at current high-rate env
    { c: "food", f: 1e-8, s: 1.0 },
    { c: "food", f: 2e-8, s: 1.0 },
    { c: "food", f: 4e-8, s: 1.0 },
    { c: "food", f: 8e-8, s: 1.0 },
    // vehicles: moderate-high — target ~10-20% delta
    { c: "vehicles", f: 1e-7, s: 1.0 },
    { c: "vehicles", f: 2e-7, s: 1.0 },
    { c: "vehicles", f: 4e-7, s: 1.0 },
    { c: "vehicles", f: 8e-7, s: 1.0 },
    // financial_services: high — target ~5-15% delta (strengthening existing)
    { c: "financial_services", f: 1e-8, s: 1.0 },
    { c: "financial_services", f: 2e-8, s: 1.0 },
    { c: "financial_services", f: 5e-8, s: 1.0 },
    { c: "financial_services", f: 1e-7, s: 1.0 },
  ];

  let lastC = "";
  for (const p of combos) {
    if (p.c !== lastC) {
      console.log(
        "\n── " +
          p.c.toUpperCase() +
          " (current D/S " +
          (current[p.c].demand / current[p.c].supply).toFixed(4) +
          ") ──"
      );
      console.log("  fraction    delta@US10.5%  delta@DE1%   totalDelta(live)   newD/S(live)   Δ%");
      lastC = p.c;
    }
    const r = simulate(p.c, p.f, p.s, 1.0);
    const usGdp = anchorGdpByCountry.get("US") || 0;
    const deGdp = anchorGdpByCountry.get("DE") || 0;
    const usDelta = countryDelta(10.5, p.f, p.s, BASE_PRICES[p.c], usGdp);
    const deDelta = countryDelta(1.0, p.f, p.s, BASE_PRICES[p.c], deGdp);
    const sign = (n) => (n >= 0 ? "+" : "") + n.toFixed(0);
    console.log(
      " ",
      p.f.toExponential(0).padStart(10),
      sign(usDelta).padStart(14),
      sign(deDelta).padStart(12),
      sign(r.totalDelta).padStart(18),
      r.newDS.toFixed(4).padStart(15),
      ((r.pctChange >= 0 ? "+" : "") + r.pctChange.toFixed(1) + "%").padStart(7)
    );
  }

  // Now show country-by-country for a promising fraction
  console.log("\n\n=== COUNTRY BREAKDOWN FOR CANDIDATE FRACTIONS ===");
  const candidates = [
    { c: "food", f: 2e-8, s: 1.0, label: "food  f=2e-8" },
    { c: "vehicles", f: 2e-7, s: 1.0, label: "veh   f=2e-7" },
    { c: "financial_services", f: 2e-8, s: 1.0, label: "fin   f=2e-8" },
  ];
  for (const p of candidates) {
    const r = simulate(p.c, p.f, p.s, 1.0);
    console.log(
      "\n" +
        p.label +
        "  totalDelta=" +
        (r.totalDelta >= 0 ? "+" : "") +
        r.totalDelta.toFixed(0) +
        "  D/S: " +
        r.oldDS.toFixed(4) +
        " → " +
        r.newDS.toFixed(4) +
        "  (" +
        (r.pctChange >= 0 ? "+" : "") +
        r.pctChange.toFixed(1) +
        "%)"
    );
    for (const [cid, delta] of Object.entries(r.byCountry).sort((a, b) => a[1] - b[1])) {
      const rate = rateByCountry.get(cid) ?? NEUTRAL;
      const gdp = anchorGdpByCountry.get(cid) || 0;
      console.log(
        "  ",
        cid.padEnd(4),
        String(rate + "%").padStart(6),
        "  gdp=₳" + Math.round(gdp / 1e9) + "B",
        "  delta=" + (delta >= 0 ? "+" : "") + delta.toFixed(0)
      );
    }
  }

  await client.close();
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
