import {
  makeEasternBlocLegislation,
  makeEasternBlocSpendingLegislation,
} from "@/lib/seeds/shared/easternBlocLegislation";

/** Czechoslovakia legislation (1979) — dual-scenario planned-economy set. */
const csTaxAndSystemLegislation = makeEasternBlocLegislation({
  prefix: "cs",
  scope: "cs",
  chamberKey: "chamberOfThePeople",
  rulingParty: "the KSČ",
  reformProgramme: "post-1968 normalisation",
});

/**
 * Czechoslovakia spending legislation (1953 baseline) — gdp/population MUST
 * match the "CS" makeEasternBlocBudget1953 call in
 * src/lib/seeds/reference/budgets.ts (guarded by
 * src/lib/seeds/reference/easternBlocSpending1953.test.ts).
 */
const csSpendingLegislation = makeEasternBlocSpendingLegislation({
  prefix: "cs",
  scope: "cs",
  chamberKey: "chamberOfThePeople",
  gdp: 200_000_000_000,
  population: 12_400_000,
  planName: "the First Five-Year Plan (1949-53)",
});

export const csLegislationTypes = [...csTaxAndSystemLegislation, ...csSpendingLegislation];
export default csLegislationTypes;
