/**
 * Deterministic fiscal stress sweep for the authored HU 2027 seed.
 * No database, world start, or player data is read.
 *
 * Run: npx tsx scripts/sim/hu2027FiscalEnvelope.ts
 */
import { getInitialNationalBudgetsForPreset } from "../../src/lib/seeds/reference/budgets";

const hu = getInitialNationalBudgetsForPreset("2027-default").find((row) => row.countryId === "HU");
if (!hu) throw new Error("HU 2027 budget is missing");

const gdp = hu.gdp;
const openingDebt = hu.debt.principal;
const fmt = (amount: number) => (amount / 1_000_000_000_000).toFixed(3);
const pct = (fraction: number) => (fraction * 100).toFixed(2);
const scenarios = [
  { name: "authored opening", revenueScale: 1, spendingScale: 1 },
  { name: "revenue 5% below opening", revenueScale: 0.95, spendingScale: 1 },
  { name: "spending 5% above opening", revenueScale: 1, spendingScale: 1.05 },
] as const;

console.log(
  "| Scenario | Revenue (HUF tn) | Spending (HUF tn) | Deficit / GDP | Debt / GDP after one FY |"
);
console.log("| --- | ---: | ---: | ---: | ---: |");
for (const scenario of scenarios) {
  const revenue = hu.revenue.total * scenario.revenueScale;
  const spending = hu.spending.total * scenario.spendingScale;
  const deficit = spending - revenue;
  const closingDebt = openingDebt + deficit;
  console.log(
    `| ${scenario.name} | ${fmt(revenue)} | ${fmt(spending)} | ${pct(deficit / gdp)}% | ${pct(closingDebt / gdp)}% |`
  );
}

if (Math.abs(hu.revenue.total - 37_082_000_000_000) > 1_000_000) {
  throw new Error("HU revenue drifted from the KSH 2025 anchor");
}
if (Math.abs(hu.spending.total - 41_141_000_000_000) > 1_000_000) {
  throw new Error("HU spending drifted from the KSH 2025 anchor");
}
if (hu.debt.principal !== 64_912_000_000_000 || gdp !== 87_045_554_000_000) {
  throw new Error("HU debt/GDP anchor drifted");
}
