import {
  makeEasternBlocLegislation,
  makeEasternBlocSpendingLegislation,
} from "@/lib/seeds/shared/easternBlocLegislation";

/** Byelorussia legislation (1979) — dual-scenario planned-economy set. */
const blrTaxAndSystemLegislation = makeEasternBlocLegislation({
  prefix: "blr",
  scope: "blr",
  chamberKey: "supremeSoviet",
  rulingParty: "the CPB",
  reformProgramme: "Soviet reform",
});

/**
 * Byelorussia spending legislation (1953 baseline) — gdp/population MUST match
 * the "BLR" makeEasternBlocBudget1953 call in src/lib/seeds/reference/budgets.ts
 * (SUR 140B against 8.1M), the same discipline the other bloc members follow and
 * the thing src/lib/seeds/reference/easternBlocSpending1953.test.ts checks.
 *
 * Note the deliberate mismatch with blrRegions1953.ts: the region seed sums to
 * 7.7M people and SUR 50,000M of regional product, because those are republican
 * figures on the RSFSR regional scale, while the budget block is the union
 * fiscal-scale base for the republic. Do not "reconcile" one to the other by
 * editing this file — the numbers here exist only to price the spending ladder
 * against the budget seed.
 *
 * Unlike the satellites, Byelorussia is a union republic, so its investment
 * programme is the all-union five-year plan rather than a national one: the
 * Fifth Five-Year Plan (1951-55), whose Byelorussian chapter is overwhelmingly
 * war reconstruction — Minsk rebuilt from the foundations, MAZ and MTZ stood up,
 * and the Soligorsk potash basin opened.
 */
const blrSpendingLegislation = makeEasternBlocSpendingLegislation({
  prefix: "blr",
  scope: "blr",
  chamberKey: "supremeSoviet",
  // The region seed is canonical: the six oblasts sum to SUR 50,000M and
  // 7.7M people, on the same ruble basis the RSFSR macro-regions use. The
  // budget seed is reconciled to this, not the other way round.
  gdp: 50_000_000_000,
  population: 7_700_000,
  planName: "the Fifth Five-Year Plan (1951-55)",
});

export const blrLegislationTypes = [...blrTaxAndSystemLegislation, ...blrSpendingLegislation];
export default blrLegislationTypes;
