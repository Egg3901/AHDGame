// Targeted extraction-capacity reseed for the LIVE (mature) game — audit t786.
//
// The hand-authored per-state capacity ceilings were calibrated for early game
// and became a binding clamp as the economy matured (iron/oil/natural_gas pinned
// at ~30% of revenue-based output at turn ~787). This script raises capacity in
// states that ALREADY carry a resource (cap > 0) to max(existingCap,
// TARGET_MULTIPLE × current revenue-based output), so the clamp stops binding and
// extraction reaches its geological supply ceiling. It NEVER lowers a ceiling and
// NEVER fabricates geology (states with 0 capacity for a resource stay 0).
//
// Pairs with the capacity→revenue haircut: raising capacity directly lifts the
// realized revenue of previously-clamped miners.
//
// Usage:
//   node scripts/reseed-extraction-capacity-t786.js            # DRY RUN (default)
//   node scripts/reseed-extraction-capacity-t786.js --apply    # writes to Mongo
//   TARGET_MULTIPLE=1.5 node scripts/reseed-extraction-capacity-t786.js
require("dotenv").config({ path: "./.env.local" });
const { MongoClient } = require("mongodb");

const APPLY = process.argv.includes("--apply");
const TARGET_MULTIPLE = Number(process.env.TARGET_MULTIPLE ?? 1.5);
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
  console.log(
    `turn=${gs?.currentTurn} TARGET_MULTIPLE=${TARGET_MULTIPLE} mode=${APPLY ? "APPLY" : "DRY RUN"}\n`
  );

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

  // Per-state per-resource revenue-based output (units/turn).
  const stateOutput = {}; // stateId -> resource -> output
  for (const s of sectors) {
    const fx = corpFx[s.corporationId?.toString()] || 1;
    const revA = (s.revenue || 0) / fx;
    const rates = (s.strategyId && s.strategyId !== "standard" && STRAT[s.strategyId]) || BROAD;
    for (const [r, rate] of Object.entries(rates)) {
      stateOutput[s.stateId] = stateOutput[s.stateId] || {};
      stateOutput[s.stateId][r] = (stateOutput[s.stateId][r] || 0) + (revA * rate) / BASE[r];
    }
  }

  const caps = await db.collection("stateResourceCapacity").find({}).toArray();

  // National EXISTING capacity per resource — the materiality guard raises only
  // genuine geological producers (states holding a real share of national
  // capacity for a resource), never the tiny "trickle" capacities live docs
  // carry in non-producing states (e.g. NJ iron:517). This is the key guard
  // against validating misallocated broad-mix output: a state with huge fake
  // iron output but a trickle iron deposit is skipped — that is a strategy-
  // adoption problem (C3), not a capacity one.
  const nationalCapacity = {};
  for (const r of RESOURCES) nationalCapacity[r] = 0;
  for (const cap of caps) {
    for (const r of RESOURCES) nationalCapacity[r] += cap.resources?.[r] ?? 0;
  }
  const CAPACITY_SHARE = Number(process.env.CAPACITY_SHARE ?? 0.02); // ≥2% of national capacity = real deposit
  const perResourceDelta = {};
  for (const r of RESOURCES) perResourceDelta[r] = { before: 0, after: 0, statesRaised: 0 };
  const updates = [];

  for (const cap of caps) {
    const existingResources = cap.resources || {};
    const raised = {}; // dotted-path selective $set: only resources.<r> that increase
    let changed = false;
    for (const r of RESOURCES) {
      const existing = existingResources[r] ?? 0;
      if (existing <= 0) continue; // never fabricate geology
      // Materiality guard: only a genuine deposit (≥ CAPACITY_SHARE of national
      // capacity for this resource) is eligible. Trickle-capacity states are
      // skipped even if their broad-mix output is large (that is misallocated
      // output → C3 strategy adoption, not a capacity raise).
      if (existing < CAPACITY_SHARE * (nationalCapacity[r] || Infinity)) {
        perResourceDelta[r].before += existing;
        perResourceDelta[r].after += existing;
        continue;
      }
      const output = stateOutput[cap.stateId]?.[r] ?? 0;
      const target = Math.max(existing, Math.ceil(output * TARGET_MULTIPLE));
      perResourceDelta[r].before += existing;
      perResourceDelta[r].after += target;
      if (target > existing) {
        // Selective, per-resource RAISE only. We record just the specific keys
        // that increase and write them with dotted paths (resources.<r>) so no
        // other resource, and no other field on the doc, is ever touched.
        raised[`resources.${r}`] = target;
        changed = true;
        perResourceDelta[r].statesRaised++;
      }
    }
    if (changed) updates.push({ stateId: cap.stateId, raised });
  }

  console.log("resource      | total cap before | total cap after | states raised");
  for (const r of RESOURCES) {
    const d = perResourceDelta[r];
    console.log(
      r.padEnd(13),
      "|",
      String(Math.round(d.before)).padStart(16),
      "|",
      String(Math.round(d.after)).padStart(15),
      "|",
      String(d.statesRaised).padStart(13)
    );
  }
  console.log(`\n${updates.length} state docs would be updated.`);

  // Sample of the exact dotted-path writes, for eyeballing before apply.
  console.log("\nsample writes (first 5):");
  for (const u of updates.slice(0, 5)) {
    console.log(`  ${u.stateId.padEnd(12)} ${JSON.stringify(u.raised)}`);
  }

  if (APPLY && updates.length > 0) {
    const now = new Date();
    const ops = updates.map((u) => ({
      updateOne: {
        filter: { stateId: u.stateId },
        // Dotted-path $set: adds ONLY the specific raised resource keys + updatedAt.
        // Never replaces the resources object; never touches any other field.
        update: { $set: { ...u.raised, updatedAt: now } },
      },
    }));
    const res = await db.collection("stateResourceCapacity").bulkWrite(ops);
    console.log(`APPLIED: matched ${res.matchedCount}, modified ${res.modifiedCount} docs.`);
  } else if (!APPLY) {
    console.log("DRY RUN — no writes. Re-run with --apply to persist.");
  }
  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
