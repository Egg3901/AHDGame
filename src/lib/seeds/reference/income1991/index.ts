/**
 * 1991 household income vintages for countries whose base metric bundle is
 * dated to another era (#3370 NG, #3371 TR, #3376 CN, #3393 AT/ES/FI/FR/GR/IT/SE;
 * parent #3316).
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
 *   - AT, ES, FI, FR, GR, IT, SE (#3393): base bundles are roughly 1979
 *     nominal legacy currency with no 1991 replacement, opening at 0.18x
 *     (GR) to 0.70x (AT) of 1991 GDP per resident. Their only authored
 *     income anchor is the 1953 overlay level (anciens francs for FR, old
 *     markka for FI, the overlay's USD for IT), read flat into 1991, so every
 *     region scored 0 or 100. GDP is WDI 1991 converted to the legacy unit,
 *     never euro (fiscalAnchors1991.ts).
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
import { atRegions1991 } from "@/lib/countries/at/data/atRegions1991";
import { esRegions1991 } from "@/lib/countries/es/data/esRegions1991";
import { fiRegions1991 } from "@/lib/countries/fi/data/fiRegions1991";
import { frRegions1991 } from "@/lib/countries/fr/data/frRegions1991";
import { grRegions1991 } from "@/lib/countries/gr/data/grRegions1991";
import { itRegions1991 } from "@/lib/countries/it/data/itRegions1991";
import { seRegions1991 } from "@/lib/countries/se/data/seRegions1991";
import { atStateMetrics } from "@/lib/seeds/at/atStateMetrics";
import { esStateMetrics } from "@/lib/seeds/es/esStateMetrics";
import { fiStateMetrics } from "@/lib/seeds/fi/fiStateMetrics";
import { frStateMetrics } from "@/lib/seeds/fr/frStateMetrics";
import { grStateMetrics } from "@/lib/seeds/gr/grStateMetrics";
import { itStateMetrics } from "@/lib/seeds/it/itStateMetrics";
import { seStateMetrics } from "@/lib/seeds/se/seStateMetrics";
import {
  nationalHouseholdMedianFromGdp,
  scaleRegionalIncomes,
  type HouseholdIncomeProxy,
} from "./rules";

export type Income1991CountryId =
  "NG" | "CN" | "TR" | "AT" | "ES" | "FI" | "FR" | "GR" | "IT" | "SE";

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
  // #3393. One method for all seven, every input a primary 1991 series:
  //   householdSize: Eurostat cens_91hpnper (1991 census round, private
  //     households by size; persons / households with 7+ counted as 7).
  //   householdIncomeShare: WDI NE.CON.PRVT.ZS 1991, household final
  //     consumption share of GDP. It omits household saving, so the level
  //     leans low; it is used as is rather than adjusted by a guessed rate.
  //   medianToMean: lognormal median/mean for the WDI/PIP Gini nearest 1991.
  //     Gini is equivalised disposable income, so the ratio leans high.
  AT: {
    householdSize: 2.53,
    householdIncomeShare: 0.549,
    medianToMean: 0.85,
    note: "1991 census 2.53 persons per household; consumption 54.9% of GDP; Gini 30.8 (1994).",
  },
  ES: {
    householdSize: 3.24,
    householdIncomeShare: 0.613,
    medianToMean: 0.84,
    note: "1991 census 3.24 persons per household; consumption 61.3% of GDP; Gini 32.0 (1990).",
  },
  FI: {
    householdSize: 2.41,
    householdIncomeShare: 0.532,
    medianToMean: 0.92,
    note: "1990 census 2.41 persons per household; consumption 53.2% of GDP; Gini 22.9 (1991).",
  },
  FR: {
    householdSize: 2.56,
    householdIncomeShare: 0.545,
    medianToMean: 0.84,
    note: "1990 census 2.56 persons per household; consumption 54.5% of GDP; Gini 32.1 (1990).",
  },
  GR: {
    householdSize: 2.97,
    householdIncomeShare: 0.67,
    medianToMean: 0.8,
    note: "1991 census 2.97 persons per household; consumption 67.0% of GDP; Gini 36.5 (1995).",
  },
  IT: {
    householdSize: 2.82,
    householdIncomeShare: 0.574,
    medianToMean: 0.85,
    note: "1991 census 2.82 persons per household; consumption 57.4% of GDP; Gini 31.1 (1991).",
  },
  SE: {
    householdSize: 2.14,
    householdIncomeShare: 0.493,
    medianToMean: 0.9,
    note: "1990 census 2.14 persons per household; consumption 49.3% of GDP; Gini 24.9 (1992).",
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
  AT: { regions: atRegions1991 as RegionRow[], metrics: atStateMetrics },
  ES: { regions: esRegions1991 as RegionRow[], metrics: esStateMetrics },
  FI: { regions: fiRegions1991 as RegionRow[], metrics: fiStateMetrics },
  FR: { regions: frRegions1991 as RegionRow[], metrics: frStateMetrics },
  GR: { regions: grRegions1991 as RegionRow[], metrics: grStateMetrics },
  IT: { regions: itRegions1991 as RegionRow[], metrics: itStateMetrics },
  SE: { regions: seRegions1991 as RegionRow[], metrics: seStateMetrics },
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
  AT: buildRegional("AT"),
  ES: buildRegional("ES"),
  FI: buildRegional("FI"),
  FR: buildRegional("FR"),
  GR: buildRegional("GR"),
  IT: buildRegional("IT"),
  SE: buildRegional("SE"),
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
