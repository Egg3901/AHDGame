/**
 * 1991 household income vintages for countries whose base metric bundle is
 * dated to another era (#3370 NG, #3371 TR, #3376 CN; parent #3316).
 *
 * The base bundles keep their authored REGIONAL SHAPE; only the national
 * level is replaced. The level is derived from the same 1991 regional GDP and
 * population the seed writes, so income, GDP and FX share one currency
 * vintage (circulating naira, 1991 renminbi, pre-2005 old lira).
 *
 * Provenance of the superseded levels, kept for history:
 *   - NG: base bundle is 2022-23 nominal NGN, previously scaled by the US
 *     1991/2019 anchor ratio (0.46), opening at about 579k NGN per household,
 *     87x GDP per resident. The authored 1991 NG anchor of 210,000 NGN was
 *     not reused: it is about 32x GDP per resident in the same naira.
 *   - CN: base bundle is approximate 2023 NBS household CNY, previously
 *     scaled by the same US ratio, opening at about 48k CNY, 26x GDP per
 *     resident. The authored 1991 CN anchor of 9,000 CNY was not reused: it
 *     sits above the NBS 1991 urban household mean.
 *   - TR: base bundle is roughly 1979 nominal lira with no 1991 replacement,
 *     opening at about 127k TRL, 1.2% of 1991 GDP per resident.
 */

import type { CountryId } from "@/lib/constants/countries";
import { getIncomeStartVintage } from "@/lib/era/metricCatalog";
import type { StateMetrics } from "@/lib/db/types";
import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";
import { ngRegions1991 } from "@/lib/countries/ng/data/ngRegions1991";
import { cnRegions1991 } from "@/lib/countries/cn/data/cnRegions1991";
import { trRegions1991 } from "@/lib/countries/tr/data/trRegions1991";
import { ngStateMetrics } from "@/lib/seeds/ng/ngStateMetrics";
import { cnStateMetrics } from "@/lib/seeds/cn/cnStateMetrics";
import { trStateMetrics } from "@/lib/seeds/tr/trStateMetrics";
import {
  nationalHouseholdMedianFromGdp,
  scaleRegionalIncomes,
  type HouseholdIncomeProxy,
} from "./rules";

export type Income1991CountryId = "NG" | "CN" | "TR";

/**
 * Bounded gameplay proxies. Household size and income-share inputs are
 * rounded public figures; median/mean is the lognormal median/mean for the
 * country's approximate early-1990s Gini. None of this is a measured median.
 */
export const INCOME_1991_PROXIES: Record<
  Income1991CountryId,
  HouseholdIncomeProxy & { note: string }
> = {
  NG: {
    householdSize: 5.0,
    householdIncomeShare: 0.65,
    medianToMean: 0.7,
    note:
      "Household size near 5 per early-1990s Nigerian household surveys; household share " +
      "below the high private-consumption share of GDP; Gini about 0.45.",
  },
  CN: {
    householdSize: 3.96,
    householdIncomeShare: 0.52,
    medianToMean: 0.83,
    note:
      "Household size 3.96 from the 1990 census. Share cross-checked against NBS 1991 " +
      "household surveys (urban disposable 1,700.6 CNY, rural net 708.6 CNY per person, " +
      "about 975 CNY per person nationally, roughly 0.52 of GDP per resident). Gini about 0.35.",
  },
  TR: {
    householdSize: 5.0,
    householdIncomeShare: 0.65,
    medianToMean: 0.7,
    note:
      "Household size 5.0 from the 1990 census; household share below private consumption " +
      "share of GDP; Gini about 0.44 per the late-1980s household income surveys.",
  },
};

interface RegionRow {
  _id: unknown;
  population: number;
  gdp?: number;
}

const SOURCES: Record<Income1991CountryId, { regions: RegionRow[]; metrics: StateMetrics[] }> = {
  NG: { regions: ngRegions1991 as RegionRow[], metrics: ngStateMetrics },
  CN: { regions: cnRegions1991 as RegionRow[], metrics: cnStateMetrics },
  TR: { regions: trRegions1991 as RegionRow[], metrics: trStateMetrics },
};

/** Region `gdp` fields are millions of local currency. */
export function gdpPerResident1991(countryId: Income1991CountryId): number {
  const { regions } = SOURCES[countryId];
  let gdp = 0;
  let pop = 0;
  for (const r of regions) {
    gdp += (r.gdp ?? 0) * 1_000_000;
    pop += r.population;
  }
  return gdp / pop;
}

export function nationalHouseholdMedian1991(countryId: Income1991CountryId): number {
  return nationalHouseholdMedianFromGdp(
    gdpPerResident1991(countryId),
    INCOME_1991_PROXIES[countryId]
  );
}

function buildRegional(countryId: Income1991CountryId): Record<string, number> {
  const { regions, metrics } = SOURCES[countryId];
  const incomeById = new Map(
    metrics.map((m) => [String(m._id), m.economic?.medianIncome?.value ?? 0])
  );
  return scaleRegionalIncomes(
    regions.map((r) => ({
      id: String(r._id),
      population: r.population,
      baseIncome: incomeById.get(String(r._id)) ?? 0,
    })),
    nationalHouseholdMedian1991(countryId)
  );
}

export const INCOME_1991_REGIONAL: Record<Income1991CountryId, Record<string, number>> = {
  NG: buildRegional("NG"),
  CN: buildRegional("CN"),
  TR: buildRegional("TR"),
};

function regionalIncome(countryId: string, regionId: string): number | undefined {
  const table = INCOME_1991_REGIONAL[countryId as Income1991CountryId];
  return table?.[regionId];
}

/** Start year whose income vintage these tables write (see INCOME_START_VINTAGES). */
export const INCOME_1991_VINTAGE_YEAR = 1991;

/**
 * Provenance id of the incomes the seed writers write for `preset`, or null when
 * they write the legacy bundle. Writers stamp this on gameState next to the
 * values, so scoring switches anchors only for data that carries it.
 */
export function seededIncomeVintageId(countryId: string, preset: string): string | null {
  if (preset !== "1991-default" || !(countryId in INCOME_1991_REGIONAL)) return null;
  return getIncomeStartVintage(countryId, INCOME_1991_VINTAGE_YEAR)?.id ?? null;
}

/** Replace a 1991 metric doc's median income with its dated vintage, if authored. */
export function apply1991IncomeVintage(countryId: CountryId, metrics: StateMetrics): StateMetrics {
  const value = regionalIncome(countryId, String(metrics._id));
  if (value === undefined || !metrics.economic) return metrics;
  return {
    ...metrics,
    economic: {
      ...metrics.economic,
      medianIncome: { ...metrics.economic.medianIncome, value },
    },
  };
}

/** Same value for the decay target, so the first turn has no income pressure. */
export function apply1991IncomeVintageBaseline(
  countryId: CountryId,
  baseline: StateMetricBaseline
): StateMetricBaseline {
  const value = regionalIncome(countryId, String(baseline._id));
  const b = baseline.baselines as Record<string, Record<string, number>> | undefined;
  if (value === undefined || !b?.economic || typeof b.economic.medianIncome !== "number") {
    return baseline;
  }
  return {
    ...baseline,
    baselines: { ...b, economic: { ...b.economic, medianIncome: value } },
  } as StateMetricBaseline;
}
