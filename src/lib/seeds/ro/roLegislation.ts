import {
  makeEasternBlocLegislation,
  makeEasternBlocSpendingLegislation,
} from "@/lib/seeds/shared/easternBlocLegislation";

/** Romania legislation (1979) — dual-scenario planned-economy set. */
const roTaxAndSystemLegislation = makeEasternBlocLegislation({
  prefix: "ro",
  scope: "ro",
  chamberKey: "grandNationalAssembly",
  rulingParty: "the PCR",
  reformProgramme: "cautious reform under austerity",
});

/**
 * Romania spending legislation (1953 baseline) — gdp/population MUST match the
 * "RO" makeEasternBlocBudget1953 call in src/lib/seeds/reference/budgets.ts
 * (guarded by src/lib/seeds/reference/easternBlocSpending1953.test.ts).
 */
const roSpendingLegislation = makeEasternBlocSpendingLegislation({
  prefix: "ro",
  scope: "ro",
  chamberKey: "grandNationalAssembly",
  gdp: 80_000_000_000,
  population: 16_600_000,
  planName: "the First Five-Year Plan (1951-55)",
});

export const roLegislationTypes = [...roTaxAndSystemLegislation, ...roSpendingLegislation];
export default roLegislationTypes;
