import {
  makeEasternBlocLegislation,
  makeEasternBlocSpendingLegislation,
} from "@/lib/seeds/shared/easternBlocLegislation";

/**
 * Ukraine legislation (1979) - dual-scenario planned-economy set. The chamber is
 * the Supreme Soviet of the Ukrainian SSR (435 deputies), the same chamber key
 * Belarus uses, because a union republic has one unicameral soviet rather than
 * a satellite state's national assembly.
 */
const uaTaxAndSystemLegislation = makeEasternBlocLegislation({
  prefix: "ukr",
  scope: "ukr",
  chamberKey: "supremeSoviet",
  rulingParty: "the KPU",
  reformProgramme: "Soviet reform",
});

/**
 * Ukraine spending legislation (1953 baseline) - gdp/population MUST match the
 * "UKR" makeEasternBlocBudget1953 call in src/lib/seeds/reference/budgets.ts
 * (guarded by src/lib/seeds/reference/easternBlocSpending1953.test.ts).
 *
 * gdp is the regional rollup of uaRegions1953.ts expressed in rubles rather
 * than millions of rubles (291,667M = SUR 291.667B), so the budget page, the
 * metrics system and the law cost engine all read one GDP truth. Do not
 * substitute a figure invented for the budget seed alone: that is exactly the
 * mismatch the #income-gdp-scale-audit had to unwind for the satellites.
 */
const uaSpendingLegislation = makeEasternBlocSpendingLegislation({
  prefix: "ukr",
  scope: "ukr",
  chamberKey: "supremeSoviet",
  gdp: 291_667_000_000,
  population: 41_000_000,
  planName: "the Fifth Five-Year Plan (1951-55)",
});

export const uaLegislationTypes = [...uaTaxAndSystemLegislation, ...uaSpendingLegislation];
export default uaLegislationTypes;
