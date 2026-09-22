import {
  makeEasternBlocLegislation,
  makeEasternBlocSpendingLegislation,
} from "@/lib/seeds/shared/easternBlocLegislation";

/** Poland legislation (1979) — dual-scenario planned-economy set. */
const plTaxAndSystemLegislation = makeEasternBlocLegislation({
  prefix: "pl",
  scope: "pl",
  chamberKey: "sejm",
  rulingParty: "the PZPR",
  reformProgramme: "limited market reform",
});

/**
 * Poland spending legislation (1953 baseline) — gdp/population MUST match the
 * "PL" makeEasternBlocBudget1953 call in src/lib/seeds/reference/budgets.ts
 * (guarded by src/lib/seeds/reference/easternBlocSpending1953.test.ts).
 */
const plSpendingLegislation = makeEasternBlocSpendingLegislation({
  prefix: "pl",
  scope: "pl",
  chamberKey: "sejm",
  gdp: 300_000_000_000,
  population: 25_500_000,
  planName: "the Six-Year Plan (1950-55)",
});

export const plLegislationTypes = [...plTaxAndSystemLegislation, ...plSpendingLegislation];
export default plLegislationTypes;
