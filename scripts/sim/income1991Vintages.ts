/**
 * 1991 household income vintages for NG, CN and TR (#3316, #3370, #3371, #3376).
 *
 * A bounded, deterministic, pure harness. It reads the game's own seed tables
 * and rules (no database, no clock, no randomness) and reports:
 *
 *   1. Input cross-checks against primary sources (World Bank WDI, PIP Gini).
 *   2. Opening income level, era anchor and score before and after the change.
 *   3. Proxy sensitivity: the national median if each proxy input took its
 *      alternative source value instead, and how that median would score.
 *   4. Regional score spread at the opening.
 *   5. A fixed scenario grid of medianIncome engine turns (productivity x
 *      unemployment), scored each year with the era band.
 *   6. Anchor regression for every other NG/CN/TR start year.
 *
 * This is NOT a worldsim. Only the medianIncome node runs; GDP, prices,
 * migration, policy and every other system are held fixed. Use it as targeted
 * evidence for the income seed and scoring change, not for the whole economy.
 *
 * Run: npx tsx scripts/sim/income1991Vintages.ts > scripts/sim/income1991Vintages.report.json
 */
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  getIncomeAnchor,
  getStartingIncomeAnchor,
  INCOME_START_VINTAGES,
} from "@/lib/era/metricCatalog";
import { evaluateRegistry } from "@/lib/metricEngine/evaluate";
import { medianIncomeNode } from "@/lib/metricEngine/registry/economic";
import { scoreMetric } from "@/lib/utils/metricScoring";
import { ngRegions1991 } from "@/lib/countries/ng/data/ngRegions1991";
import { cnRegions1991 } from "@/lib/countries/cn/data/cnRegions1991";
import { trRegions1991 } from "@/lib/countries/tr/data/trRegions1991";
import { ngStateMetrics } from "@/lib/seeds/ng/ngStateMetrics";
import { cnStateMetrics } from "@/lib/seeds/cn/cnStateMetrics";
import { trStateMetrics } from "@/lib/seeds/tr/trStateMetrics";
import { applyEra1991Adjustments } from "@/lib/seeds/reference/stateMetrics1991";
import {
  INCOME_1991_PROXIES,
  INCOME_1991_REGIONAL,
  gdpPerResident1991,
  nationalHouseholdMedian1991,
  type Income1991CountryId,
} from "@/lib/seeds/reference/income1991";
import {
  HOUSEHOLD_INCOME_PROXY_BOUNDS,
  nationalHouseholdMedianFromGdp,
} from "@/lib/seeds/reference/income1991/rules";

const COUNTRIES: Income1991CountryId[] = ["NG", "CN", "TR"];
const START = 1991;
const PRESET = "1991-default";
const YEARS = 5;

/**
 * Primary-source values, retrieved from the World Bank API on 2026-10-07.
 * `null` means the source has no observation for that country and year.
 */
const SOURCES = {
  gdpPerCapitaLcu: {
    url: "https://api.worldbank.org/v2/country/NGA;CHN;TUR/indicator/NY.GDP.PCAP.CN?date=1991&format=json",
    note: "WDI GDP per capita, current local currency. TR is reported in post-2005 lira; x 1e6 for old lira.",
    values: { NG: 5917.16, CN: 1917.91, TR: 11.0527653 * 1_000_000 },
  },
  population: {
    url: "https://api.worldbank.org/v2/country/NGA;CHN;TUR/indicator/SP.POP.TOTL?date=1991&format=json",
    note: "WDI total population, 1991.",
    values: { NG: 99_720_162, CN: 1_150_780_000, TR: 57_009_887 },
  },
  privateConsumptionShare: {
    url: "https://api.worldbank.org/v2/country/NGA;CHN;TUR/indicator/NE.CON.PRVT.ZS?date=1991&format=json",
    note: "WDI household final consumption, % of GDP, 1991. An upper reference for the household income share.",
    values: { NG: null, CN: 0.4782, TR: 0.706 },
  },
  gini: {
    url: "https://api.worldbank.org/v2/country/NGA;CHN;TUR/indicator/SI.POV.GINI?date=1985:1995&format=json",
    note: "WDI / Poverty and Inequality Platform Gini, nearest survey year to 1991 (NG 1992, CN 1990, TR 1994).",
    portal: "https://pip.worldbank.org/",
    values: { NG: 44.9, CN: 32.2, TR: 41.3 },
  },
  householdSize: {
    url: "https://www.un.org/development/desa/pd/data/household-size-and-composition",
    note: "UN DESA Household Size and Composition database, census rounds near 1990. Rounded values used.",
  },
  chinaHouseholdSurvey: {
    url: "https://www.stats.gov.cn/english/Statisticaldata/yearbook/",
    note: "NBS China Statistical Yearbook household survey tables: 1991 urban disposable 1,700.6 and rural net 708.6 CNY per person.",
  },
} as const;

/** Explicit gameplay assumptions; each is a choice, not a measurement. */
const ASSUMPTIONS = [
  "economic.medianIncome is annual household median income in local currency, same vintage as the 1991 regional GDP the seed writes.",
  "Household median = GDP per resident x household size x household income share x median/mean, each factor bounded (see rules.ts).",
  "median/mean follows a lognormal income distribution at the stated Gini; this is a modelling convenience, not a survey median.",
  "Regional shape comes from each country's authored base bundle and is kept by one population-weighted rescale.",
  "A world that starts in 1991 scores income against the derived national median (start-year vintage). Other start years keep the interpolation series unchanged.",
  "The engine grid holds GDP fixed (income band index 1) and runs only the medianIncome node; no other system moves.",
  "No new monetary mechanic: no inflation pass-through, no FX or price-level change.",
];

/** Standard normal CDF via Abramowitz and Stegun 7.1.26 erf. */
function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(x) / Math.SQRT2));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Lognormal median/mean for a Gini in [0,1]: G = 2 Phi(sigma / sqrt 2) - 1. */
function medianToMeanFromGini(gini: number): number {
  let lo = 0;
  let hi = 5;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (2 * normCdf(mid / Math.SQRT2) - 1 < gini) lo = mid;
    else hi = mid;
  }
  const sigma = (lo + hi) / 2;
  return Math.exp((-sigma * sigma) / 2);
}

const REGIONS: Record<Income1991CountryId, Array<{ _id: unknown; population: number }>> = {
  NG: ngRegions1991,
  CN: cnRegions1991,
  TR: trRegions1991,
};

function popWeighted(c: Income1991CountryId, values: Record<string, number>): number {
  let pop = 0;
  let sum = 0;
  for (const r of REGIONS[c]) {
    const v = values[String(r._id)];
    if (v === undefined) continue;
    pop += r.population;
    sum += v * r.population;
  }
  return sum / pop;
}

function score(c: Income1991CountryId, value: number, anchorOverride?: number): number {
  if (anchorOverride === undefined) {
    return round(scoreMetric("medianIncome", value, c, PRESET, START, 1, START)!, 2);
  }
  const best = anchorOverride * 1.25;
  const worst = anchorOverride * 0.45;
  return round(Math.max(0, Math.min(100, ((value - worst) / (best - worst)) * 100)), 2);
}

function round(v: number, d = 0): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

/** The pre-change opening: NG/CN via the US-ratio era adjustment, TR on its base bundle. */
function previousOpening(c: Income1991CountryId): Record<string, number> {
  const base = c === "NG" ? ngStateMetrics : c === "CN" ? cnStateMetrics : trStateMetrics;
  const rows = c === "TR" ? base : base.map(applyEra1991Adjustments);
  return Object.fromEntries(
    rows.map((m) => [String(m._id), m.economic?.medianIncome?.value ?? 0] as const)
  );
}

const PREVIOUS_1991_ANCHOR: Record<Income1991CountryId, number> = {
  NG: 210_000,
  CN: 9_000,
  TR: 1_900,
};

function crossChecks(c: Income1991CountryId) {
  const gdpPc = gdpPerResident1991(c);
  const wdiGdpPc = SOURCES.gdpPerCapitaLcu.values[c];
  const proxy = INCOME_1991_PROXIES[c];
  const giniMm = medianToMeanFromGini(SOURCES.gini.values[c] / 100);
  const consumption = SOURCES.privateConsumptionShare.values[c];
  const regionPop = REGIONS[c].reduce((s, r) => s + r.population, 0);
  return {
    seedGdpPerResident: round(gdpPc, 2),
    wdiGdpPerCapita: round(wdiGdpPc, 2),
    seedOverWdi: round(gdpPc / wdiGdpPc, 3),
    seedPopulation: regionPop,
    wdiPopulation: SOURCES.population.values[c],
    proxy: {
      householdSize: proxy.householdSize,
      householdIncomeShare: proxy.householdIncomeShare,
      medianToMean: proxy.medianToMean,
    },
    giniImpliedMedianToMean: round(giniMm, 3),
    wdiPrivateConsumptionShare: consumption,
  };
}

function sensitivity(c: Income1991CountryId) {
  const gdpPc = gdpPerResident1991(c);
  const proxy = INCOME_1991_PROXIES[c];
  const base = nationalHouseholdMedian1991(c);
  const alt: Array<{ input: string; median: number; score: number }> = [];
  const push = (input: string, p: typeof proxy, gdp = gdpPc) => {
    const m = nationalHouseholdMedianFromGdp(gdp, p);
    alt.push({ input, median: round(m), score: score(c, m) });
  };
  const clampTo = (k: keyof typeof HOUSEHOLD_INCOME_PROXY_BOUNDS, v: number) =>
    Math.max(HOUSEHOLD_INCOME_PROXY_BOUNDS[k][0], Math.min(HOUSEHOLD_INCOME_PROXY_BOUNDS[k][1], v));
  push("median/mean from WDI Gini", {
    ...proxy,
    medianToMean: clampTo("medianToMean", medianToMeanFromGini(SOURCES.gini.values[c] / 100)),
  });
  const cons = SOURCES.privateConsumptionShare.values[c];
  if (cons != null) {
    push("household share = WDI private consumption share", {
      ...proxy,
      householdIncomeShare: clampTo("householdIncomeShare", cons),
    });
  }
  push("GDP per resident at WDI per capita", proxy, SOURCES.gdpPerCapitaLcu.values[c]);
  push("household size -0.5", {
    ...proxy,
    householdSize: clampTo("householdSize", proxy.householdSize - 0.5),
  });
  push("household size +0.5", {
    ...proxy,
    householdSize: clampTo("householdSize", proxy.householdSize + 0.5),
  });
  const scores = alt.map((a) => a.score);
  return {
    baseMedian: round(base),
    alternatives: alt,
    scoreRange: [Math.min(...scores), Math.max(...scores)],
  };
}

function regionalOpening(c: Income1991CountryId) {
  const rows = Object.entries(INCOME_1991_REGIONAL[c]).map(([id, v]) => ({
    id,
    income: v,
    score: score(c, v),
  }));
  const incomes = rows.map((r) => r.income);
  return {
    maxOverMin: round(Math.max(...incomes) / Math.min(...incomes), 2),
    bandWidth: round(1.25 / 0.45, 2),
    insideBand: rows.filter((r) => r.score > 0 && r.score < 100).length,
    atEdge: rows.filter((r) => r.score <= 0 || r.score >= 100).length,
    // medianIncome is stored in whole units, so a per-turn change under half a
    // unit rounds away. Below this annual wage growth (either sign) the
    // poorest region does not move at all.
    poorestRegionFreezeBelowPctPerYear: round(
      (0.5 / Math.min(...incomes)) * TURNS_PER_YEAR * 100,
      3
    ),
    rows,
  };
}

function engineGrid(c: Income1991CountryId) {
  const out: Array<{
    productivity: number;
    unemployment: number;
    yearly: Array<{ year: number; national: number; score: number }>;
  }> = [];
  for (const productivity of [0, 1.2, 3]) {
    for (const unemployment of [3, 5, 10]) {
      const value: Record<string, number> = { ...INCOME_1991_REGIONAL[c] };
      const simBaseline: Record<string, number> = {};
      const yearly = [
        { year: 0, national: round(popWeighted(c, value)), score: score(c, popWeighted(c, value)) },
      ];
      for (let turn = 1; turn <= YEARS * TURNS_PER_YEAR; turn++) {
        for (const id of Object.keys(value)) {
          const res = evaluateRegistry([medianIncomeNode], {
            stateId: id,
            countryId: c,
            prev: { "economic.medianIncome": value[id] },
            prevSimBaseline: id in simBaseline ? { "economic.medianIncome": simBaseline[id] } : {},
            providers: {},
            spending: {},
            policyValues: { "economic.medianIncome": value[id] },
            seedCurrent: {
              "economic.productivityGrowth": productivity,
              "economic.unemploymentRate": unemployment,
            },
          })["economic.medianIncome"];
          value[id] = res.value;
          simBaseline[id] = res.simBaseline;
        }
        if (turn % TURNS_PER_YEAR === 0) {
          const n = popWeighted(c, value);
          yearly.push({ year: turn / TURNS_PER_YEAR, national: round(n), score: score(c, n) });
        }
      }
      out.push({ productivity, unemployment, yearly });
    }
  }
  return out;
}

function anchorRegression(c: Income1991CountryId) {
  return [1953, 1979, 1991, 1999, 2007, 2019, 2023].map((year) => ({
    startYear: year,
    interpolated: round(getIncomeAnchor(c, year) ?? NaN, 2),
    startAnchor: round(getStartingIncomeAnchor(c, year) ?? NaN, 2),
    changed: getIncomeAnchor(c, year) !== getStartingIncomeAnchor(c, year),
  }));
}

const countries = Object.fromEntries(
  COUNTRIES.map((c) => {
    const before = previousOpening(c);
    const beforeNational = popWeighted(c, before);
    const afterNational = popWeighted(c, INCOME_1991_REGIONAL[c]);
    return [
      c,
      {
        crossChecks: crossChecks(c),
        opening: {
          before: {
            national: round(beforeNational),
            anchor: PREVIOUS_1991_ANCHOR[c],
            overGdpPerResident: round(beforeNational / gdpPerResident1991(c), 3),
            score: score(c, beforeNational, PREVIOUS_1991_ANCHOR[c]),
          },
          after: {
            national: round(afterNational),
            anchor: getStartingIncomeAnchor(c, START),
            overGdpPerResident: round(afterNational / gdpPerResident1991(c), 3),
            score: score(c, afterNational),
            withinEngineBounds: Object.values(INCOME_1991_REGIONAL[c]).every(
              (v) => v >= medianIncomeNode.bounds[0] && v <= medianIncomeNode.bounds[1]
            ),
          },
        },
        sensitivity: sensitivity(c),
        regionalOpening: regionalOpening(c),
        engineGrid: engineGrid(c),
        anchorRegression: anchorRegression(c),
      },
    ];
  })
);

console.log(
  JSON.stringify(
    {
      harness: "scripts/sim/income1991Vintages.ts",
      scope:
        "Targeted pure fixture: seed tables, era scoring and the medianIncome node only. Not a worldsim.",
      turnsPerYear: TURNS_PER_YEAR,
      years: YEARS,
      startVintages: INCOME_START_VINTAGES,
      sources: SOURCES,
      assumptions: ASSUMPTIONS,
      countries,
    },
    null,
    2
  )
);
