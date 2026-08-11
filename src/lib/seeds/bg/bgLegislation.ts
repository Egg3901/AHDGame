import {
  makeEasternBlocLegislation,
  makeEasternBlocSpendingLegislation,
} from "@/lib/seeds/shared/easternBlocLegislation";

/** Bulgaria legislation (1979) — dual-scenario planned-economy set. */
const bgTaxAndSystemLegislation = makeEasternBlocLegislation({
  prefix: "bg",
  scope: "bg",
  chamberKey: "nationalAssembly",
  rulingParty: "the BKP",
  reformProgramme: "limited reform",
});

/**
 * Bulgaria spending legislation (1953 baseline) — gdp/population MUST match the
 * "BG" makeEasternBlocBudget1953 call in src/lib/seeds/reference/budgets.ts
 * (guarded by src/lib/seeds/reference/easternBlocSpending1953.test.ts).
 */
const bgSpendingLegislation = makeEasternBlocSpendingLegislation({
  prefix: "bg",
  scope: "bg",
  chamberKey: "nationalAssembly",
  gdp: 40_000_000_000,
  population: 7_300_000,
  planName: "the First Five-Year Plan (1949-53)",
});

export const bgLegislationTypes = [...bgTaxAndSystemLegislation, ...bgSpendingLegislation];
export default bgLegislationTypes;
