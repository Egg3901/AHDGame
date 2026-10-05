import { CORPORATION_TYPES } from "../../src/lib/constants/corporations";
import { openingPlantScenario } from "../../src/lib/corporations/investment/rules/openingBalance";
import { getOpeningPolicyRate } from "../../src/lib/centralBank/rules/openingPolicyRate";
import { getInitialNationalBudgetsForPreset } from "../../src/lib/seeds/reference/budgets";
import { getStateResourceCapacity } from "../../src/lib/seeds/reference/stateResourceCapacity";
import { getInitialRates } from "../../src/lib/constants/currencies";

const countries = ["US", "UK", "JP"] as const;
const plants = countries.flatMap((country) =>
  CORPORATION_TYPES.map((type) => ({
    country,
    balanced: openingPlantScenario(type, getOpeningPolicyRate(country, 1991, 5)),
    stress: openingPlantScenario(type, getOpeningPolicyRate(country, 1991, 5), true),
  }))
);
const fiscal = getInitialNationalBudgetsForPreset("1991-default").map((budget) => ({
  country: budget.countryId,
  currency: budget.currencyCode,
  gdp: budget.gdp,
  debt: budget.debt.principal,
  debtGdpPercent: budget.debtToGdpRatio * 100,
  annualReceipts: budget.revenue.total,
  annualSpending: budget.spending.total,
  annualInterest: budget.spending.debtInterest,
  deficitGdpPercent: (-100 * budget.surplus) / budget.gdp,
}));
const resources = countries.map((country) => ({
  country,
  regions: Object.entries(getStateResourceCapacity("1991-default"))
    .filter(([, row]) => row.countryId === country)
    .map(([region, row]) => ({ region, resources: row.resources })),
}));
const report = {
  preset: "1991-default",
  assumptions: {
    operating:
      "Full utilization and sales; neutral management and technology; no policy credits or subsidies",
    stress:
      "Input prices +10%, output prices -10%, wages +10% through the engine's price realization",
    excluded:
      "Corporate and regional tax, debt funding, construction delay, endogenous clearing and turn feedback",
  },
  plants,
  fiscal,
  resources,
  fx: getInitialRates("1991-default"),
};
const failed = plants.some(
  (row) =>
    row.balanced.dailyProfit <= 0 ||
    row.stress.dailyProfit <= 0 ||
    row.balanced.priceRevenueRatio > 1.8
);
// Imported turn modules start cache timers. Exit only after the JSON is flushed.
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`, () => process.exit(failed ? 1 : 0));
