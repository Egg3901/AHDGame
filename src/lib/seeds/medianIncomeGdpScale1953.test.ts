/**
 * 1953 seed scale guard — median household income must be denominated in the
 * SAME currency scale as the country's own GDP seed.
 *
 * Local-currency denomination is by design: `budgets.ts` seeds UK GDP in
 * pounds, RU in rubles, FR in anciens francs. What is NOT by design is a
 * country whose GDP seed is on one scale and whose median-income seed is on
 * another. That happened to FR/ES/TR because their 1953 incomes were authored
 * as `1979 nominal local-currency income × Maddison REAL GDP/capita ratio` —
 * a real-volume ratio applied to a nominal value, which silently drops 26
 * years of local price change (and, for France, the 1960 100:1 franc
 * redenomination on top).
 *
 * The consequence was not cosmetic. `moneySupply/assemble.ts`
 * `addHouseholdMoneyFromDemography` derives the household money stock from
 * population × median income, so a mis-scaled income makes the domestic side
 * of M2 either invisible (FR: household aggregate 1.9% of GDP, leaving M2 ~91%
 * an inert exogenous residual that no domestic activity could move) or absurd
 * (ES 1068%, TR 1910% of GDP).
 *
 * The invariant asserted here is deliberately POPULATION-INDEPENDENT:
 *
 *   medianHouseholdIncome / (GDP / population)
 *
 * Both sides are per-capita-normalised in the same currency, so the ratio is
 * pure denomination and cannot be moved by a country's region populations
 * disagreeing with its budget population. With PERSONS_PER_HOUSEHOLD = 3.2 a
 * ratio of R implies aggregate household income ≈ R / 3.2 of GDP, so the band
 * [0.8, 2.6] corresponds to an aggregate income share of ~25%-81% of GDP.
 *
 * Reference points inside the band: US 1953 ≈ 1.59 (Census P60 median family
 * income $3,900 against $2,449 GDP/capita), the 1979 FR seed ≈ 1.07.
 * The bug being guarded against is an order-of-magnitude error, so the band is
 * wide on purpose — it must catch 20×/100× and not bikeshed 1.1× vs 1.9×.
 */
import { describe, expect, it } from "vitest";
import { getRegionMetricPresets } from "@/lib/seeds/metricPresets";
import { NATIONAL_BUDGET_SEED_CONFIGS_1953 } from "@/lib/seeds/reference/budgets";
import { frRegions1953 } from "@/lib/seeds/fr/frRegions1953";
import { esRegions1953 } from "@/lib/seeds/es/esRegions1953";
import { trRegions1953 } from "@/lib/seeds/tr/trRegions1953";
import { ieRegions1953 } from "@/lib/seeds/ie/ieRegions1953";
import { brRegions1953 } from "@/lib/seeds/br/brRegions1953";
import { ruRegions1953 } from "@/lib/seeds/ru/ruRegions1953";
import { cnRegions1953 } from "@/lib/seeds/cn/cnRegions1953";
import { ngRegions1953 } from "@/lib/seeds/ng/ngRegions1953";
import { jpRegions1953 } from "@/lib/seeds/jp/jpRegions1953";
import { itRegions1953 } from "@/lib/seeds/it/itRegions1953";
import { seRegions1953 } from "@/lib/seeds/se/seRegions1953";
import { atRegions1953 } from "@/lib/seeds/at/atRegions1953";
import { fiRegions1953 } from "@/lib/seeds/fi/fiRegions1953";
import { grRegions1953 } from "@/lib/seeds/gr/grRegions1953";
import { ukRegions1953 } from "@/lib/seeds/uk/ukRegions1953";
import { PERSONS_PER_HOUSEHOLD } from "@/lib/moneySupply/assemble";
import type { CountryId } from "@/lib/constants/countries";

/** Income / GDP-per-capita. Wide enough to admit real cross-country spread. */
const INCOME_TO_GDP_PER_CAPITA_MIN = 0.8;
const INCOME_TO_GDP_PER_CAPITA_MAX = 2.6;

/**
 * Countries whose 1953 income seed authors `economic.medianIncome` directly
 * in the region overlay (`getRegionMetricPresets`) and is denominated to
 * match its own GDP seed. Extend this list — do not relax the band — when
 * another country is fixed.
 *
 * NOT included here (each for a different, documented reason — see the
 * "known gaps / different mechanism" describe block below rather than a
 * silent omission):
 *   - DE: passes, but via `applyEra1953Adjustments` scaling the modern seed
 *     rather than an authored overlay value — `getRegionMetricPresets`
 *     returns no `economic.medianIncome` key, so this test's helper cannot
 *     see it. Verified separately (audit table); not regression-tested here.
 *   - US: out of scope for this pass (src/lib/seeds/us/** untouched).
 *   - HU/PL/RO/YU/BG/BLR/CS/BAL/DD: built via `makeEasternBlocStateMetrics` /
 *     a hand-built `StateMetrics[]`, not the `getRegionMetricPresets` overlay
 *     system this test's helper reads — covered instead by the sibling file
 *     `easternBlocIncomeGdpScale1953.test.ts`, which reads the CONSTRUCTED
 *     `economic.medianIncome` values directly off each country's seed config.
 */
const COUNTRIES: Array<{
  country: CountryId;
  regions: Array<{ _id: string; population: number }>;
}> = [
  { country: "FR", regions: frRegions1953 },
  { country: "ES", regions: esRegions1953 },
  { country: "TR", regions: trRegions1953 },
  { country: "IE", regions: ieRegions1953 },
  { country: "BR", regions: brRegions1953 },
  { country: "RU", regions: ruRegions1953 },
  { country: "CN", regions: cnRegions1953 },
  { country: "NG", regions: ngRegions1953 },
  { country: "JP", regions: jpRegions1953 },
  { country: "IT", regions: itRegions1953 },
  { country: "SE", regions: seRegions1953 },
  { country: "AT", regions: atRegions1953 },
  { country: "FI", regions: fiRegions1953 },
  { country: "GR", regions: grRegions1953 },
  { country: "UK", regions: ukRegions1953 },
];

function budget1953(country: CountryId) {
  const b = NATIONAL_BUDGET_SEED_CONFIGS_1953.find((c) => c.countryId === country);
  if (!b) throw new Error(`no 1953 budget seed for ${country}`);
  return b;
}

/** Population-weighted mean of the authored per-region 1953 median incomes. */
function weightedMedianIncome(
  country: CountryId,
  regions: Array<{ _id: string; population: number }>
): { weighted: number; totalPopulation: number } {
  let weightedSum = 0;
  let totalPopulation = 0;
  for (const region of regions) {
    const overlay = getRegionMetricPresets(country, region._id, "1953-default");
    expect(overlay, `${country}/${region._id} has no 1953 overlay`).toBeTruthy();
    const income = overlay!["economic.medianIncome"];
    expect(income, `${country}/${region._id} medianIncome`).toBeTypeOf("number");
    expect(income as number).toBeGreaterThan(0);
    weightedSum += (income as number) * region.population;
    totalPopulation += region.population;
  }
  return { weighted: weightedSum / totalPopulation, totalPopulation };
}

describe("1953 seeds — median income and GDP share one currency scale", () => {
  for (const { country, regions } of COUNTRIES) {
    it(`${country}: median household income is ${INCOME_TO_GDP_PER_CAPITA_MIN}-${INCOME_TO_GDP_PER_CAPITA_MAX}× GDP per capita`, () => {
      const budget = budget1953(country);
      const { weighted } = weightedMedianIncome(country, regions);
      const gdpPerCapita = budget.gdp / budget.population;
      const ratio = weighted / gdpPerCapita;

      expect(
        ratio,
        `${country}: weighted median income ${Math.round(weighted).toLocaleString()} ${budget.currencyCode} vs GDP/capita ${Math.round(gdpPerCapita).toLocaleString()} ${budget.currencyCode} = ${ratio.toFixed(2)}×. ` +
          `Outside [${INCOME_TO_GDP_PER_CAPITA_MIN}, ${INCOME_TO_GDP_PER_CAPITA_MAX}] means the income seed and the GDP seed are on different currency scales.`
      ).toBeGreaterThanOrEqual(INCOME_TO_GDP_PER_CAPITA_MIN);
      expect(ratio).toBeLessThanOrEqual(INCOME_TO_GDP_PER_CAPITA_MAX);
    });

    it(`${country}: the national default income is on the same scale as the regions`, () => {
      // The national default is the fallback for any region without a tilt and
      // for `incomeByCountry` in addHouseholdMoneyFromDemography. A default left
      // on the old scale would reintroduce the bug for exactly those states.
      const { weighted } = weightedMedianIncome(country, regions);
      const values = regions.map(
        (r) =>
          getRegionMetricPresets(country, r._id, "1953-default")!["economic.medianIncome"] as number
      );
      for (const value of values) {
        expect(value / weighted).toBeGreaterThan(0.25);
        expect(value / weighted).toBeLessThan(4);
      }
    });

    it(`${country}: aggregate household income is a plausible share of GDP`, () => {
      // The money-supply consequence, computed the way
      // addHouseholdMoneyFromDemography actually computes it: region
      // populations (NOT the budget population) / PERSONS_PER_HOUSEHOLD.
      const budget = budget1953(country);
      const { weighted, totalPopulation } = weightedMedianIncome(country, regions);
      const aggregate = (totalPopulation / PERSONS_PER_HOUSEHOLD) * weighted;
      const share = aggregate / budget.gdp;

      // Wider than the per-capita band because a country's region populations
      // may not sum to its budget population (FR's 1953 regions sum to 36.0M
      // against a 42.8M budget population — a separate, diagnosed defect).
      expect(
        share,
        `${country}: aggregate household income ${(aggregate / 1e9).toFixed(1)}B vs GDP ${(budget.gdp / 1e9).toFixed(1)}B = ${(share * 100).toFixed(1)}% of GDP`
      ).toBeGreaterThan(0.2);
      expect(share).toBeLessThan(0.95);
    });
  }
});
