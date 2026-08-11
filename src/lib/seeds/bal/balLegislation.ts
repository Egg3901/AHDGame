import {
  makeEasternBlocLegislation,
  makeEasternBlocSpendingLegislation,
} from "@/lib/seeds/shared/easternBlocLegislation";

/** Baltics tax and system legislation (1979 authoring, used by both presets). */
const balTaxAndSystemLegislation = makeEasternBlocLegislation({
  prefix: "bal",
  scope: "bal",
  chamberKey: "supremeSoviet",
  rulingParty: "the CPSU",
  reformProgramme: "Soviet reform and independence",
});

/**
 * Baltics spending legislation (1953 baseline).
 *
 * Without these seven types the country carries only revenue and system levers,
 * every one of them cost-class "none", so `calculateFederalSpending`
 * (src/lib/budget/spending.ts) falls back to the static
 * `baselineSpendingByCategory` and the budget is frozen for the whole game.
 * This is the same fix the Warsaw-Pact six got, guarded there by
 * src/lib/seeds/reference/easternBlocSpending1953.test.ts.
 *
 * gdp/population MUST match the "BAL" `makeEasternBlocBudget1953` call in
 * src/lib/seeds/reference/budgets.ts. The factory computes each option's legacy
 * `annualCostPerCapita` as fraction × gdp ÷ population, and that per-capita
 * figure is what actually prices the seed, so a mismatch silently books the
 * wrong share of GDP in every category.
 *
 * The values below are the country's own canonical 1953 totals: population
 * 2,900,000 and GDP ₽29.167bn, i.e. the sum of balRegions1953.ts (29,167
 * millions of rubles) times one million. Region rollup, budget seed and law
 * pricing then all quote the same GDP, which is the invariant the RU 1953 seed
 * documents as "one GDP truth".
 *
 * The plan is the Fifth Five-Year Plan (1951-55): in the Baltics its content is
 * the Kohtla-Jarve shale complex, the Riga machine-building works, and the
 * capital rebuilding of Tallinn and Riga after the 1944 fighting.
 */
const balSpendingLegislation = makeEasternBlocSpendingLegislation({
  prefix: "bal",
  scope: "bal",
  chamberKey: "supremeSoviet",
  gdp: 29_167_000_000,
  population: 2_900_000,
  planName: "the Fifth Five-Year Plan (1951-55)",
});

export const balLegislationTypes = [...balTaxAndSystemLegislation, ...balSpendingLegislation];
export default balLegislationTypes;
