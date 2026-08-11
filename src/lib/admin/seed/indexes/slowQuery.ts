import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

// Indexes for collections identified via MongoDB profiler as COLLSCAN offenders.
// Each of these was doing full collection scans on hot paths before the index landed.
export async function seedSlowQueryIndexes(db: Db, log: (msg: string) => void) {
  log("Slow-query indexes:");

  // corporationHistory — stock exchange / market cap / bonds aggregations
  await ensureIndex(
    db,
    "corporationHistory",
    { corporationId: 1, turn: -1 },
    { name: "corporationHistory_corporationId_turn" },
    log
  );

  // commodityPriceHistory — commodity list/detail + aggregations
  await ensureIndex(
    db,
    "commodityPriceHistory",
    { commodity: 1, turn: -1 },
    { name: "commodityPriceHistory_commodity_turn" },
    log
  );

  // actionLogs — achievement triggers + action dedup checks
  await ensureIndex(
    db,
    "actionLogs",
    { characterId: 1, actionType: 1 },
    { name: "actionLogs_characterId_actionType" },
    log
  );

  // statePartyElections — validation on entry routes
  await ensureIndex(
    db,
    "statePartyElections",
    { stateId: 1, partyId: 1, status: 1 },
    { name: "statePartyElections_stateId_partyId_status" },
    log
  );

  // --- GlitchTip slow-query sweep 2026-07-18 (issue #3343) ---
  // These collections use `_id` for most lookups, but a handful of hot paths
  // filter on the `countryId` *field* (distinct from `_id`) or on `status`,
  // which the `_id` index cannot serve — so those queries were COLLSCANning.
  // Indexes below target only those field-filter shapes, not the `_id` reads
  // (already covered) nor the deliberate `find({})` bulk loaders (unindexable).

  // federalBudget — per-turn envelope calculators
  // (infra/energy/portfolio/defenseEnvelope.ts) and the national crisis snapshot
  // (autoCrisisConditions.ts) do `findOne({ countryId })`. The collection holds
  // both national-budget docs and fiscal-year snapshot docs, so it is not a
  // singleton scan — the field filter needs its own index. (`find({})` bulk
  // loaders in the metric engine / turn loop are genuine full scans, not gaps.)
  await ensureIndex(
    db,
    "federalBudget",
    { countryId: 1 },
    { name: "federalBudget_countryId" },
    log
  );

  // governmentApprovals — most reads are `findOne({ _id: countryId })`, but
  // autoCrisisConditions.ts uses `findOne({ countryId })` and
  // nationalization/registerView.ts uses `findOne({ countryId }).sort({ updatedAt: -1 })`.
  // The compound serves both (equality prefix + sort suffix).
  await ensureIndex(
    db,
    "governmentApprovals",
    { countryId: 1, updatedAt: -1 },
    { name: "governmentApprovals_countryId_updatedAt" },
    log
  );

  // exchangeRates — the national crisis snapshot (autoCrisisConditions.ts) reads
  // `findOne({ countryId })` on the `countryId` field; the rest use `_id`. Field
  // filter needs its own index. (`find({})` full loads in forex/wealth-list are
  // deliberate whole-collection reads.)
  await ensureIndex(
    db,
    "exchangeRates",
    { countryId: 1 },
    { name: "exchangeRates_countryId" },
    log
  );

  // countryGameStates — getRegisteredCountryIds (country/registeredCountries.ts)
  // runs `find({ status: "active" })` on a hot per-request fanout path with no
  // index on `status`. Small collection but read constantly.
  await ensureIndex(
    db,
    "countryGameStates",
    { status: 1 },
    { name: "countryGameStates_status" },
    log
  );

  log("Slow-query indexes ensured");
}
