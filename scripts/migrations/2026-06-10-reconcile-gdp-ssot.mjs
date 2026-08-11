/**
 * Reconcile the GDP fields to the A1 SSOT (P1a, design §5.4).
 *
 * After P1a, `state.gdp` (millions) is the single source of truth and national
 * GDP = Σ regional state.gdp. This converges live games' three historically-
 * divergent GDP fields to that SSOT, per country:
 *   - federalBudget.gdp        = Σ state.gdp × 1_000_000  (excl. national-scope)
 *   - federalBudget.gdpSmoothed = federalBudget.gdp        (seed the EMA)
 *   - stateBudget.stateGdp     = state.gdp × 1_000_000     (per region)
 *
 * Guarded:
 *   - DRY RUN by default. `--apply` to mutate.
 *   - `--live` targets MONGODB_URI_LIVE (else MONGODB_URI).
 *   - Idempotent: re-running after apply reports ~zero drift.
 */

import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const args = new Set(process.argv.slice(2));
const useLive = args.has("--live");
const apply = args.has("--apply");

const uri = useLive ? process.env.MONGODB_URI_LIVE : process.env.MONGODB_URI;
if (!uri) {
  console.error(`MISSING env: ${useLive ? "MONGODB_URI_LIVE" : "MONGODB_URI"} not set`);
  process.exit(1);
}

// National-scope synthetic stateMetrics/states doc ids (mirror of NATIONAL_SCOPE).
const NATIONAL_SCOPE_IDS = new Set([
  "federal",
  "uk_national",
  "jp_national",
  "de_national",
  "br_national",
  "ie_national",
  "cn_national",
  "ng_national",
]);

const MILLION = 1_000_000;
const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : String(n));

const client = new MongoClient(uri);
try {
  await client.connect();
  const db = client.db();

  const [federalBudgets, states, stateBudgets] = await Promise.all([
    db.collection("federalBudget").find({}).toArray(),
    db
      .collection("states")
      .find({}, { projection: { _id: 1, countryId: 1, gdp: 1 } })
      .toArray(),
    db
      .collection("stateBudgets")
      .find({}, { projection: { _id: 1, countryId: 1, stateGdp: 1 } })
      .toArray(),
  ]);

  const realStates = states.filter((s) => !NATIONAL_SCOPE_IDS.has(String(s._id)));
  const fedOps = [];
  const stateOps = [];

  for (const budget of federalBudgets) {
    const countryId =
      budget.countryId ?? (String(budget._id) === "federal" ? "US" : String(budget._id));
    const sumMillions = realStates
      .filter((s) => s.countryId === countryId)
      .reduce((sum, s) => sum + (s.gdp || 0), 0);
    if (sumMillions <= 0) {
      console.log(`[skip] ${countryId}: no SSOT state.gdp data`);
      continue;
    }
    const newGdp = sumMillions * MILLION;
    console.log(
      `[${countryId}] federalBudget.gdp ${fmt(budget.gdp)} → ${fmt(newGdp)}` +
        ` (gdpSmoothed ${fmt(budget.gdpSmoothed)} → ${fmt(newGdp)})`
    );
    fedOps.push({
      updateOne: {
        filter: { _id: budget._id },
        update: { $set: { gdp: newGdp, gdpSmoothed: newGdp } },
      },
    });
  }

  for (const sb of stateBudgets) {
    const state = realStates.find((s) => String(s._id) === String(sb._id));
    if (!state || !(state.gdp > 0)) continue;
    const newStateGdp = state.gdp * MILLION;
    if (Math.abs((sb.stateGdp || 0) - newStateGdp) < 1) continue; // already reconciled
    stateOps.push({
      updateOne: { filter: { _id: sb._id }, update: { $set: { stateGdp: newStateGdp } } },
    });
  }

  console.log(
    `\n${apply ? "APPLY" : "DRY RUN"} — federalBudget: ${fedOps.length} docs, stateBudgets: ${stateOps.length} docs`
  );

  if (apply) {
    if (fedOps.length) await db.collection("federalBudget").bulkWrite(fedOps);
    if (stateOps.length) await db.collection("stateBudgets").bulkWrite(stateOps);
    console.log("Applied.");
  } else {
    console.log("Dry run only — re-run with --apply to write.");
  }
} finally {
  await client.close();
}
