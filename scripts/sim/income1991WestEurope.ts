/**
 * 1991 household income vintages for AT, ES, FI, FR, GR, IT and SE (#3393, parent #3316).
 *
 * A bounded, deterministic, pure harness. It reads the game's own seed tables
 * and rules (no database, no clock, no randomness) and reports:
 *
 *   1. Input cross-checks against primary sources (World Bank WDI, PIP Gini,
 *      Eurostat 1991 census round).
 *   2. Opening income level, anchor, income/GDP ratio and score, before and after.
 *   3. Proxy sensitivity: the national median under alternative inputs.
 *   4. Regional score spread at the opening, region by region.
 *   5. A fixed scenario grid of medianIncome engine turns (productivity x
 *      unemployment), scored each year with the era band.
 *   6. Anchor regression for every other start year.
 *
 * This is NOT a worldsim. Only the medianIncome node runs; GDP, prices,
 * migration, policy and every other system are held fixed.
 *
 * Run: npx tsx scripts/sim/income1991WestEurope.ts > scripts/sim/income1991WestEurope.report.json
 */
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { gdp1991LegacyLcu, FISCAL_ANCHORS_1991 } from "@/lib/constants/fiscalAnchors1991";
import {
  getIncomeAnchor,
  getStartingIncomeAnchor,
  incomeVintageStampsFor,
} from "@/lib/era/metricCatalog";
import { evaluateRegistry } from "@/lib/metricEngine/evaluate";
import { medianIncomeNode } from "@/lib/metricEngine/registry/economic";
import { scoreMetric } from "@/lib/utils/metricScoring";
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
  INCOME_1991_PROXIES,
  INCOME_1991_REGIONAL,
  gdpPerResident1991,
  nationalHouseholdMedian1991,
} from "@/lib/seeds/reference/income1991";
import {
  HOUSEHOLD_INCOME_PROXY_BOUNDS,
  nationalHouseholdMedianFromGdp,
  type HouseholdIncomeProxy,
} from "@/lib/seeds/reference/income1991/rules";

const COUNTRIES = ["AT", "ES", "FI", "FR", "GR", "IT", "SE"] as const;
type West = (typeof COUNTRIES)[number];
const START = 1991;
const PRESET = "1991-default";
const YEARS = 5;

/** Primary-source values, retrieved 2026-10-07. */
const SOURCES = {
  population: {
    url: "https://api.worldbank.org/v2/country/FRA;ITA;ESP;SWE;GRC;AUT;FIN/indicator/SP.POP.TOTL?date=1991&format=json",
    note: "WDI total population, 1991. FR includes overseas departments.",
    values: {
      AT: 7_754_891,
      ES: 38_966_376,
      FI: 5_013_740,
      FR: 58_554_242,
      GR: 10_319_927,
      IT: 56_758_521,
      SE: 8_617_375,
    },
  },
  privateConsumptionShare: {
    url: "https://api.worldbank.org/v2/country/FRA;ITA;ESP;SWE;GRC;AUT;FIN/indicator/NE.CON.PRVT.ZS?date=1991&format=json",
    note: "WDI household final consumption, % of GDP, 1991. Used as the household income share.",
    values: {
      AT: 0.5485,
      ES: 0.6133,
      FI: 0.5317,
      FR: 0.5453,
      GR: 0.6699,
      IT: 0.5744,
      SE: 0.4933,
    },
  },
  gini: {
    url: "https://api.worldbank.org/v2/country/FRA;ITA;ESP;SWE;GRC;AUT;FIN/indicator/SI.POV.GINI?date=1985:1996&format=json",
    note: "WDI / Poverty and Inequality Platform Gini, survey year nearest 1991.",
    portal: "https://pip.worldbank.org/",
    values: { AT: 30.8, ES: 32.0, FI: 22.9, FR: 32.1, GR: 36.5, IT: 31.1, SE: 24.9 },
    years: { AT: 1994, ES: 1990, FI: 1991, FR: 1990, GR: 1995, IT: 1991, SE: 1992 },
  },
  householdSize: {
    url: "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/cens_91hpnper?format=JSON&lang=EN",
    note: "Eurostat cens_91hpnper, private households by size, 1991 census round. Mean = sum(size x households) / households, with 7+ counted as 7.",
    values: { AT: 2.532, ES: 3.237, FI: 2.408, FR: 2.561, GR: 2.967, IT: 2.823, SE: 2.135 },
  },
} as const;

/** Explicit gameplay assumptions; each is a choice, not a measurement. */
const ASSUMPTIONS = [
  "economic.medianIncome is annual household median income in the legacy currency the 1991 GDP and FX use (ATS, ESP, FIM, FRF, GRD, ITL, SEK); never euro.",
  "Household median = GDP per resident x household size x household consumption share of GDP x lognormal median/mean at the Gini (rules.ts, #3386).",
  "Consumption share omits household saving (level leans low); an equivalised disposable Gini understates household gross dispersion (level leans high).",
  "Regional shape comes from each country's authored ~1979 bundle and is kept by one population-weighted rescale.",
  "A world that starts in 1991 scores income against the derived national median (start-year vintage). Other start years keep their existing anchors.",
  "The engine grid holds GDP fixed (income band index 1) and runs only the medianIncome node.",
];

const REGIONS: Record<West, Array<{ _id: unknown; population: number }>> = {
  AT: atRegions1991,
  ES: esRegions1991,
  FI: fiRegions1991,
  FR: frRegions1991,
  GR: grRegions1991,
  IT: itRegions1991,
  SE: seRegions1991,
};
const BASE = {
  AT: atStateMetrics,
  ES: esStateMetrics,
  FI: fiStateMetrics,
  FR: frStateMetrics,
  GR: grStateMetrics,
  IT: itStateMetrics,
  SE: seStateMetrics,
};

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

function round(v: number, d = 0): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function popWeighted(c: West, values: Record<string, number>): number {
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

// Provenance the fresh 1991 seed writers stamp. Scores below go through the
// runtime gate: the vintage anchor applies only with the matching stamp, and an
// unstamped (pre-#3393) world keeps the legacy anchor.
const FRESH = incomeVintageStampsFor(START);

function score(c: West, value: number, stamps: Record<string, string> | null = FRESH): number {
  return round(scoreMetric("medianIncome", value, c, PRESET, START, 1, START, stamps)!, 2);
}

/** What the seed writers wrote before #3393: the raw ~1979 bundle, unscaled. */
function previousOpening(c: West): Record<string, number> {
  return Object.fromEntries(
    BASE[c].map((m) => [String(m._id), m.economic?.medianIncome?.value ?? 0] as const)
  );
}

function crossChecks(c: West) {
  const proxy = INCOME_1991_PROXIES[c];
  const seedPop = REGIONS[c].reduce((s, r) => s + r.population, 0);
  return {
    currency: FISCAL_ANCHORS_1991[c].currencyCode,
    gdp1991LegacyLcu: gdp1991LegacyLcu(c),
    seedPopulation: seedPop,
    wdiPopulation: SOURCES.population.values[c],
    seedGdpPerResident: round(gdpPerResident1991(c), 2),
    wdiPopGdpPerResident: round(gdp1991LegacyLcu(c) / SOURCES.population.values[c], 2),
    proxy: {
      householdSize: proxy.householdSize,
      householdIncomeShare: proxy.householdIncomeShare,
      medianToMean: proxy.medianToMean,
    },
    sourceHouseholdSize: SOURCES.householdSize.values[c],
    sourceConsumptionShare: SOURCES.privateConsumptionShare.values[c],
    giniImpliedMedianToMean: round(medianToMeanFromGini(SOURCES.gini.values[c] / 100), 3),
  };
}

function sensitivity(c: West) {
  const proxy = INCOME_1991_PROXIES[c];
  const gdpPc = gdpPerResident1991(c);
  const clampTo = (k: keyof HouseholdIncomeProxy, v: number) =>
    Math.max(HOUSEHOLD_INCOME_PROXY_BOUNDS[k][0], Math.min(HOUSEHOLD_INCOME_PROXY_BOUNDS[k][1], v));
  const alt: Array<{ input: string; median: number; overBase: number; score: number }> = [];
  const base = nationalHouseholdMedian1991(c);
  const push = (input: string, p: HouseholdIncomeProxy, gdp = gdpPc) => {
    const m = nationalHouseholdMedianFromGdp(gdp, p);
    alt.push({ input, median: round(m), overBase: round(m / base, 3), score: score(c, m) });
  };
  push("household share 0.65 (the NG/TR choice in #3386)", {
    ...proxy,
    householdIncomeShare: 0.65,
  });
  push("median/mean 0.05 lower (household gross dispersion)", {
    ...proxy,
    medianToMean: clampTo("medianToMean", proxy.medianToMean - 0.05),
  });
  push("household size +0.25", { ...proxy, householdSize: proxy.householdSize + 0.25 });
  push("household size -0.25", {
    ...proxy,
    householdSize: clampTo("householdSize", proxy.householdSize - 0.25),
  });
  push(
    "GDP per resident on WDI population",
    proxy,
    gdp1991LegacyLcu(c) / SOURCES.population.values[c]
  );
  const scores = alt.map((a) => a.score);
  return {
    baseMedian: round(base),
    alternatives: alt,
    scoreRange: [Math.min(...scores), Math.max(...scores)],
  };
}

function regionalOpening(c: West) {
  const before = previousOpening(c);
  const rows = Object.entries(INCOME_1991_REGIONAL[c]).map(([id, v]) => ({
    id,
    before: before[id],
    beforeScore: score(c, before[id], null),
    after: v,
    afterScore: score(c, v),
  }));
  const incomes = rows.map((r) => r.after);
  return {
    maxOverMin: round(Math.max(...incomes) / Math.min(...incomes), 2),
    bandWidth: round(1.25 / 0.45, 2),
    insideBand: rows.filter((r) => r.afterScore > 0 && r.afterScore < 100).length,
    atEdge: rows.filter((r) => r.afterScore <= 0 || r.afterScore >= 100).length,
    rows,
  };
}

function engineGrid(c: West) {
  const out: Array<{
    productivity: number;
    unemployment: number;
    yearly: Array<{ year: number; national: number; score: number }>;
  }> = [];
  for (const productivity of [0, 1.5, 3]) {
    for (const unemployment of [3, 6, 12]) {
      const value: Record<string, number> = { ...INCOME_1991_REGIONAL[c] };
      const simBaseline: Record<string, number> = {};
      const n0 = popWeighted(c, value);
      const yearly = [{ year: 0, national: round(n0), score: score(c, n0) }];
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

function anchorRegression(c: West) {
  return [1953, 1979, 1991, 1999, 2007, 2019, 2023].map((year) => ({
    startYear: year,
    interpolated: getIncomeAnchor(c, year),
    unstampedStartAnchor: getStartingIncomeAnchor(c, year),
    stampedStartAnchor: getStartingIncomeAnchor(c, year, FRESH),
    changedWhenStamped: getIncomeAnchor(c, year) !== getStartingIncomeAnchor(c, year, FRESH),
  }));
}

const countries = Object.fromEntries(
  COUNTRIES.map((c) => {
    const gdpPc = gdpPerResident1991(c);
    const beforeNational = popWeighted(c, previousOpening(c));
    const afterNational = popWeighted(c, INCOME_1991_REGIONAL[c]);
    return [
      c,
      {
        crossChecks: crossChecks(c),
        opening: {
          before: {
            national: round(beforeNational),
            anchor: getIncomeAnchor(c, START),
            overGdpPerResident: round(beforeNational / gdpPc, 3),
            // Unstamped world: legacy anchor through the same runtime gate.
            score: score(c, beforeNational, null),
          },
          after: {
            national: round(afterNational),
            stamp: FRESH[c],
            anchor: getStartingIncomeAnchor(c, START, FRESH),
            overGdpPerResident: round(afterNational / gdpPc, 3),
            score: score(c, afterNational),
            factorOverBefore: round(afterNational / beforeNational, 3),
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
      harness: "scripts/sim/income1991WestEurope.ts",
      scope:
        "Targeted pure fixture: seed tables, era scoring and the medianIncome node only. Not a worldsim.",
      turnsPerYear: TURNS_PER_YEAR,
      years: YEARS,
      provenanceGate:
        "Scores use scoreMetric with the stamps the fresh 1991 seed writers write. 'before' is the unstamped legacy world scored through the same gate.",
      sources: SOURCES,
      assumptions: ASSUMPTIONS,
      countries,
    },
    null,
    2
  )
);
