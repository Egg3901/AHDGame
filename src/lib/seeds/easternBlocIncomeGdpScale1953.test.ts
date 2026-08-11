/**
 * 1953 seed scale guard — Eastern-bloc / DD counterpart to
 * `medianIncomeGdpScale1953.test.ts`.
 *
 * These countries don't go through `getRegionMetricPresets` (they're built by
 * `makeEasternBlocStateMetrics`, or — for DD — a hand-built `StateMetrics[]`),
 * so they need their own harness reading the CONSTRUCTED `economic.medianIncome`
 * values straight off each country's seed config rather than a flat overlay.
 *
 * Same invariant, same band, same rationale as the sibling file: median
 * household income / (GDP / population) should sit in [0.8, 2.6] — wide
 * enough to admit real cross-country spread while catching an
 * order-of-magnitude denomination bug. Before this pass: HU 2.8-3.6x, PL
 * 3.5-4.6x, RO 4.3-5.6x, YU 5.8-7.3x (all over-scaled); BG 0.26-0.33x, BLR
 * 0.15x, BAL 0.18x (all under-scaled); DD 2.594x (a hair under the ceiling,
 * margin 0.006). CS already passed (1.735x) and was left untouched.
 */
import { describe, expect, it } from "vitest";
import { NATIONAL_BUDGET_SEED_CONFIGS_1953 } from "@/lib/seeds/reference/budgets";
import { PERSONS_PER_HOUSEHOLD } from "@/lib/moneySupply/assemble";
import type { CountryId } from "@/lib/constants/countries";

import { getHuSeedConfig } from "@/lib/seeds/hu/huSeed";
import { getPlSeedConfig } from "@/lib/seeds/pl/plSeed";
import { getRoSeedConfig } from "@/lib/seeds/ro/roSeed";
import { getYuSeedConfig } from "@/lib/seeds/yu/yuSeed";
import { getBgSeedConfig } from "@/lib/seeds/bg/bgSeed";
import { getBlrSeedConfig } from "@/lib/seeds/blr/blrSeed";
import { getCsSeedConfig } from "@/lib/seeds/cs/csSeed";
import { getBalSeedConfig } from "@/lib/seeds/bal/balSeed";
import { ddStateMetrics1953 } from "@/lib/seeds/dd/ddStateMetrics1953";
import { ddRegions1953 } from "@/lib/seeds/dd/ddRegions1953";

const INCOME_TO_GDP_PER_CAPITA_MIN = 0.8;
const INCOME_TO_GDP_PER_CAPITA_MAX = 2.6;

interface SeedConfigLike {
  regions: Array<{ _id: string; population: number }>;
  metrics: Array<{ _id: string; economic?: { medianIncome?: { value: number } } }>;
}

function budget1953(country: CountryId) {
  const b = NATIONAL_BUDGET_SEED_CONFIGS_1953.find((c) => c.countryId === country);
  if (!b) throw new Error(`no 1953 budget seed for ${country}`);
  return b;
}

function weightedMedianIncome(config: SeedConfigLike): {
  weighted: number;
  totalPopulation: number;
} {
  const popById = new Map(config.regions.map((r) => [r._id, r.population]));
  let weightedSum = 0;
  let totalPopulation = 0;
  for (const m of config.metrics) {
    const pop = popById.get(m._id) ?? 0;
    const income = m.economic?.medianIncome?.value;
    expect(income, `${m._id} economic.medianIncome`).toBeTypeOf("number");
    weightedSum += (income as number) * pop;
    totalPopulation += pop;
  }
  return { weighted: weightedSum / totalPopulation, totalPopulation };
}

const EASTERN_BLOC: Array<{ country: CountryId; getConfig: (preset: string) => SeedConfigLike }> = [
  { country: "HU", getConfig: getHuSeedConfig },
  { country: "PL", getConfig: getPlSeedConfig },
  { country: "RO", getConfig: getRoSeedConfig },
  { country: "YU", getConfig: getYuSeedConfig },
  { country: "BG", getConfig: getBgSeedConfig },
  { country: "BLR", getConfig: getBlrSeedConfig },
  { country: "CS", getConfig: getCsSeedConfig },
  { country: "BAL", getConfig: getBalSeedConfig },
];

describe("1953 seeds — Eastern bloc median income and GDP share one currency scale", () => {
  for (const { country, getConfig } of EASTERN_BLOC) {
    it(`${country}: median household income is ${INCOME_TO_GDP_PER_CAPITA_MIN}-${INCOME_TO_GDP_PER_CAPITA_MAX}× GDP per capita`, () => {
      const config = getConfig("1953-default");
      const budget = budget1953(country);
      const { weighted } = weightedMedianIncome(config);
      const gdpPerCapita = budget.gdp / budget.population;
      const ratio = weighted / gdpPerCapita;

      expect(
        ratio,
        `${country}: weighted median income ${Math.round(weighted).toLocaleString()} ${budget.currencyCode} vs GDP/capita ${Math.round(gdpPerCapita).toLocaleString()} ${budget.currencyCode} = ${ratio.toFixed(2)}×.`
      ).toBeGreaterThanOrEqual(INCOME_TO_GDP_PER_CAPITA_MIN);
      expect(ratio).toBeLessThanOrEqual(INCOME_TO_GDP_PER_CAPITA_MAX);
    });

    it(`${country}: aggregate household income is a plausible share of GDP`, () => {
      const config = getConfig("1953-default");
      const budget = budget1953(country);
      const { weighted, totalPopulation } = weightedMedianIncome(config);
      const aggregate = (totalPopulation / PERSONS_PER_HOUSEHOLD) * weighted;
      const share = aggregate / budget.gdp;

      expect(
        share,
        `${country}: aggregate household income vs GDP = ${(share * 100).toFixed(1)}%`
      ).toBeGreaterThan(0.2);
      expect(share).toBeLessThan(0.95);
    });
  }

  it("DD: median household income is 0.8-2.6× GDP per capita", () => {
    const config: SeedConfigLike = { regions: ddRegions1953, metrics: ddStateMetrics1953 };
    const budget = budget1953("DD");
    const { weighted } = weightedMedianIncome(config);
    const gdpPerCapita = budget.gdp / budget.population;
    const ratio = weighted / gdpPerCapita;

    expect(
      ratio,
      `DD: weighted median income ${Math.round(weighted).toLocaleString()} vs GDP/capita ${Math.round(gdpPerCapita).toLocaleString()} = ${ratio.toFixed(2)}×.`
    ).toBeGreaterThanOrEqual(INCOME_TO_GDP_PER_CAPITA_MIN);
    expect(ratio).toBeLessThanOrEqual(INCOME_TO_GDP_PER_CAPITA_MAX);
  });

  it("DD: aggregate household income is a plausible share of GDP", () => {
    const config: SeedConfigLike = { regions: ddRegions1953, metrics: ddStateMetrics1953 };
    const budget = budget1953("DD");
    const { weighted, totalPopulation } = weightedMedianIncome(config);
    const aggregate = (totalPopulation / PERSONS_PER_HOUSEHOLD) * weighted;
    const share = aggregate / budget.gdp;

    expect(
      share,
      `DD: aggregate household income vs GDP = ${(share * 100).toFixed(1)}%`
    ).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.95);
  });
});
