import {
  makeEasternBlocLegislation,
  makeEasternBlocSpendingLegislation,
} from "@/lib/seeds/shared/easternBlocLegislation";

/** Yugoslavia legislation (1979) — dual-scenario planned-economy set. */
const yuTaxAndSystemLegislation = makeEasternBlocLegislation({
  prefix: "yu",
  scope: "yu",
  chamberKey: "federalAssembly",
  rulingParty: "the SKJ",
  reformProgramme: "workers self-management",
});

/**
 * Yugoslavia spending legislation (1953 baseline) — gdp/population MUST match
 * the "YU" makeEasternBlocBudget1953 call in
 * src/lib/seeds/reference/budgets.ts (guarded by
 * src/lib/seeds/reference/easternBlocSpending1953.test.ts). Not a Warsaw Pact
 * member (expelled from Cominform 1948) — `selfManagement: true` frames the
 * investment and grant programmes as workers'-council/self-management
 * administration rather than a central ministry, per the 1950 Basic Law.
 */
const yuSpendingLegislation = makeEasternBlocSpendingLegislation({
  prefix: "yu",
  scope: "yu",
  chamberKey: "federalAssembly",
  gdp: 100_000_000_000,
  population: 16_900_000,
  planName: "the Federal Investment Plan",
  selfManagement: true,
});

export const yuLegislationTypes = [...yuTaxAndSystemLegislation, ...yuSpendingLegislation];
export default yuLegislationTypes;
