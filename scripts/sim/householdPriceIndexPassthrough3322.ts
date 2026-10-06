/**
 * Deterministic calibration for issue #3322. Drives the production
 * advanceHouseholdPriceIndex through whole years of constant and varying annual
 * CPI and compares the accumulated index with the documented passthrough. No
 * database, world or random input; the legacy column reproduces the replaced
 * linear-slice formula only so the change is visible side by side.
 */
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  advanceHouseholdPriceIndex,
  HOUSEHOLD_PRICE_INFLATION_PASSTHROUGH,
} from "@/lib/economy/householdPriceIndex";

const constantRates = [-10, -2, 0, 2, 8, 25, 100, 480] as const;

function legacyAdvance(prior: number, annualInflationPercent: number): number {
  const perTurn =
    (HOUSEHOLD_PRICE_INFLATION_PASSTHROUGH * annualInflationPercent) / 100 / TURNS_PER_YEAR;
  return Math.max(Number.EPSILON, prior * (1 + perTurn));
}

function run(rates: readonly number[], step: (prior: number, rate: number) => number): number {
  return rates.reduce((index, rate) => step(index, rate), 1);
}

const fmt = (value: number) => value.toFixed(6);
const yearOf = (rate: number) => Array.from({ length: TURNS_PER_YEAR }, () => rate);

console.log(
  `Passthrough ${HOUSEHOLD_PRICE_INFLATION_PASSTHROUGH}, ${TURNS_PER_YEAR} turns per year, index starts at 1.\n`
);
console.log(
  "| Annual CPI | Documented annual factor | Legacy after one year | Fixed after one year |"
);
console.log(
  "| ---------: | -----------------------: | --------------------: | -------------------: |"
);
for (const rate of constantRates) {
  const target = 1 + (HOUSEHOLD_PRICE_INFLATION_PASSTHROUGH * rate) / 100;
  const rates = yearOf(rate);
  console.log(
    `| ${rate}% | ${fmt(target)} | ${fmt(run(rates, legacyAdvance))} | ${fmt(run(rates, advanceHouseholdPriceIndex))} |`
  );
}

const varying: { label: string; rates: number[] }[] = [
  {
    label: "24 turns at 8%, then 24 at 100%",
    rates: [...yearOf(8).slice(24), ...yearOf(100).slice(24)],
  },
  {
    label: "24 turns at 100%, then 24 at 8%",
    rates: [...yearOf(100).slice(24), ...yearOf(8).slice(24)],
  },
  {
    label: "linear glide 480% to 8% over one year",
    rates: Array.from(
      { length: TURNS_PER_YEAR },
      (_, turn) => 480 + ((8 - 480) * turn) / (TURNS_PER_YEAR - 1)
    ),
  },
  { label: "two years at 8%", rates: [...yearOf(8), ...yearOf(8)] },
];

console.log("\n| Varying path | Geometric-mean target | Legacy | Fixed |");
console.log("| ------------ | --------------------: | -----: | ----: |");
for (const { label, rates } of varying) {
  const target = rates.reduce(
    (product, rate) =>
      product * (1 + (HOUSEHOLD_PRICE_INFLATION_PASSTHROUGH * rate) / 100) ** (1 / TURNS_PER_YEAR),
    1
  );
  console.log(
    `| ${label} | ${fmt(target)} | ${fmt(run(rates, legacyAdvance))} | ${fmt(run(rates, advanceHouseholdPriceIndex))} |`
  );
}
