import {
  makeEasternBlocLegislation,
  makeEasternBlocSpendingLegislation,
} from "@/lib/seeds/shared/easternBlocLegislation";

/** Hungary legislation (1979) — dual-scenario planned-economy set; Kádár's MSZMP
 *  and the New Economic Mechanism reform flavour. */
const huTaxAndSystemLegislation = makeEasternBlocLegislation({
  prefix: "hu",
  scope: "hu",
  chamberKey: "nationalAssembly",
  rulingParty: "the MSZMP",
  reformProgramme: "the New Economic Mechanism",
});

/**
 * Hungary spending legislation (1953 baseline) — gdp/population MUST match the
 * "HU" makeEasternBlocBudget1953 call in src/lib/seeds/reference/budgets.ts
 * (guarded by src/lib/seeds/reference/easternBlocSpending1953.test.ts).
 */
const huSpendingLegislation = makeEasternBlocSpendingLegislation({
  prefix: "hu",
  scope: "hu",
  chamberKey: "nationalAssembly",
  gdp: 100_000_000_000,
  population: 9_500_000,
  planName: "the First Five-Year Plan (1950-54)",
});

export const huLegislationTypes = [...huTaxAndSystemLegislation, ...huSpendingLegislation];
export default huLegislationTypes;
