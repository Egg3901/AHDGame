import type { AdjacencyMap } from "@/lib/constants/stateAdjacency";
import type { CountryMapConfig } from "@/lib/commodity-map/commodityMapRegistry";
import type { Continent } from "@/lib/constants/countryContinents";
import type { ConscriptionPolicy } from "@/lib/demographics/conscription";
import type { NormalAnchor } from "@/lib/era/metricCatalog";
import type { ScoreThreshold } from "@/lib/utils/metricScoring";
import type { WorldEntityRegion } from "@/lib/world/worldEntityManifest";

/**
 * The small facts about where UK is.
 *
 * ⚠ GENERATED FROM `__snapshots__/uk.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-geography-facts.ts UK --force
 *
 * A hand-written draft of this file got six values wrong, including an
 * independent-bias of 0.06 where the registry says 2.33 and a threshold object
 * with the wrong KEYS. All six typechecked. Do not edit values here by hand.
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair;
 * `geography.ts` imports every era of census, metric and region data as values.
 * A registry that forwards to the heavy module for one string ships all of it to
 * the browser -- which shipped once already, when `countryContinents.ts` started
 * pulling 108 KB per bundle for a continent name.
 *
 * ⚠ THE ISO PAIR IS TWO REGISTRIES DESCRIBING ONE FACT.
 * `COUNTRY_TO_ISO_NUMERIC` maps UK to the code and
 * `ISO_NUMERIC_TO_COUNTRY` maps it back. The generator asserts they agree
 * before writing; if they ever disagree, a lookup by code and a lookup by
 * country would report different things.
 */

export const UK_CONTINENT: Continent = "Europe";

/** ISO 3166-1 numeric. `ISO_NUMERIC_TO_COUNTRY` holds the inverse entry. */
export const UK_ISO_NUMERIC = "826";

export const UK_UN_MEMBER_SINCE = 1945;

export const UK_WORLD_REGION: WorldEntityRegion = "europe";

/** Where an NPP corporation is seated when it has no other home. */
export const UK_NPP_CAPITAL_STATE = "LON";

/** Independent-bias nudge for the non-party bucket. */
export const UK_NON_PARTY_INDEPENDENT_BIAS = 1;

/** Map centring for the commodity and world maps: [longitude, latitude]. */
export const UK_MAP_ANCHOR: [number, number] = [-2, 54];

/**
 * Median-income scoring thresholds.
 *
 * ⚠ LOCAL CURRENCY, like every money figure in the folder, and NOT comparable to
 * another country's.
 */
export const UK_MEDIAN_INCOME_THRESHOLDS: ScoreThreshold = {
  best: 44000,
  worst: 16000,
};

/** Conscription policy at seed time. */
export const UK_CONSCRIPTION: ConscriptionPolicy = {
  eligibleBand: [18, 20],
  sexEnabled: {
    male: true,
    female: false,
  },
  option: 2,
};

/**
 * Core-5 metric normals, keyed by metric.
 *
 * ⚠ THE REGISTRY IS METRIC-FIRST, NOT COUNTRY-FIRST. `CORE5_NORMALS` is read as
 * `CORE5_NORMALS.gdpGrowth.UK`, so the snapshot captured one entry per
 * metric rather than one object for the country. Each anchor is keyed `year`,
 * a NUMBER -- not `era`, a string.
 */
export const UK_CORE5_NORMALS: Record<string, NormalAnchor[]> = {
  gdpGrowth: [
    {
      year: 1953,
      value: 3,
    },
    {
      year: 1979,
      value: 2.4,
    },
    {
      year: 1991,
      value: 2.2,
    },
    {
      year: 2019,
      value: 1.5,
    },
    {
      year: 2040,
      value: 1.3,
    },
  ],
  unemploymentRate: [
    {
      year: 1953,
      value: 1.8,
    },
    {
      year: 1979,
      value: 5,
    },
    {
      year: 1991,
      value: 8.5,
    },
    {
      year: 2019,
      value: 4,
    },
    {
      year: 2040,
      value: 4.2,
    },
  ],
  lifeExpectancy: [
    {
      year: 1953,
      value: 69.5,
    },
    {
      year: 1979,
      value: 73.5,
    },
    {
      year: 1991,
      value: 76,
    },
    {
      year: 2019,
      value: 81.2,
    },
    {
      year: 2040,
      value: 84,
    },
  ],
  violentCrimeRate: [
    {
      year: 1953,
      value: 80,
    },
    {
      year: 1979,
      value: 250,
    },
    {
      year: 1991,
      value: 400,
    },
    {
      year: 2019,
      value: 350,
    },
    {
      year: 2040,
      value: 320,
    },
  ],
  povertyRate: [
    {
      year: 1953,
      value: 20,
    },
    {
      year: 1979,
      value: 13,
    },
    {
      year: 1991,
      value: 17,
    },
    {
      year: 2019,
      value: 12,
    },
    {
      year: 2040,
      value: 11,
    },
  ],
};

/**
 * Which regions border which.
 *
 * ⚠ KEYED BY REGION, AND FOR UK THOSE KEYS ARE NOT COUNTRY CODES. In the
 * United States' map `CA`, `DE` and `IN` are California, Delaware and Indiana,
 * not Canada, Germany and India. A tool that reads two-letter keys as countries
 * misreads this file, which is how 5,900 lines of US state data stayed invisible
 * to the relocation guard until its rule was fixed.
 */
export const UK_ADJACENCY_MAP: AdjacencyMap = {
  LON: ["SEE", "EAE"],
  SEE: ["LON", "SWE", "EAE"],
  SWE: ["SEE", "WMI", "WAL"],
  EAE: ["LON", "SEE", "EMI", "YHU"],
  EMI: ["EAE", "WMI", "YHU"],
  WMI: ["SWE", "EMI", "NWE", "WAL"],
  YHU: ["EAE", "EMI", "NWE", "NEE"],
  NWE: ["WMI", "YHU", "NEE", "WAL", "NIR"],
  NEE: ["YHU", "NWE", "SCO"],
  SCO: ["NEE", "NIR"],
  WAL: ["SWE", "WMI", "NWE"],
  NIR: ["SCO", "NWE"],
};

/**
 * Map registry: where the country's map lives and how its features map to
 * region ids.
 *
 * ⚠ THIS IS NOT A COUPLE OF FIELDS. A hand-written draft of the geography
 * module stubbed it as `{ countryId, anchor }` and would have broken the map
 * outright: the real record carries `name`, `overviewPath`, `mapPath`,
 * `hasRegionMap`, `geoUrl` and a `featureIdToStateId` table with one entry per
 * region. Guessing the shape of a config object is the same failure as guessing
 * a value, and it typechecks just as readily behind a cast.
 */
export const UK_MAP_REGISTRY: CountryMapConfig = {
  countryId: "UK",
  name: "United Kingdom",
  overviewPath: "/country/uk",
  mapPath: "/country/uk/map",
  hasRegionMap: true,
  geoUrl: "https://cdn.ahousedividedgame.com/static/maps/uk-nuts1.json",
  featureIdToStateId: {
    UKC: "NEE",
    UKD: "NWE",
    UKE: "YHU",
    UKF: "EMI",
    UKG: "WMI",
    UKH: "EAE",
    UKI: "LON",
    UKJ: "SEE",
    UKK: "SWE",
    UKL: "WAL",
    UKM: "SCO",
    UKN: "NIR",
  },
  projection: "mercator",
  projectionCenter: [-2, 55.5],
  projectionScale: 1800,
};

/**
 * 1991-era cohort multipliers.
 *
 * ⚠ 1991 ONLY. `POPULATION_MULTIPLIERS` lives in `stateDemographics1991.ts`
 * and describes how that era's cohorts differ from the modern ones. It says
 * nothing about any other preset, and a country missing from it passes through
 * unchanged at 1.0 rather than taking someone else's numbers.
 */
/**
 * Income anchors by year.
 *
 * ⚠ IN THE LIGHT MODULE ON PURPOSE. `metricCatalog.ts` reads these and is
 * CLIENT-REACHABLE. Pointing it at `geography.ts` instead shipped seventeen
 * countries' census, metric and region bundles into the browser -- the same
 * failure `countryContinents.ts` had when it started pulling 108 KB for one
 * string.
 */
export const UK_INCOME_ANCHORS: NormalAnchor[] = [
  {
    year: 1953,
    value: 450,
  },
  {
    year: 1979,
    value: 11000,
  },
  {
    year: 1991,
    value: 15500,
  },
  {
    year: 2019,
    value: 30000,
  },
];

/*
 * ⚠ THESE TWO ARE INDEPENDENT, AND NESTING THEM COST ELEVEN COUNTRIES. The
 * income-anchor block was first written INSIDE the population-multiplier
 * ternary, so a country with anchors but no 1991 cohort row -- France, Austria,
 * East Germany and eight others -- emitted neither. Typecheck caught it only
 * because metricCatalog.ts had already been repointed at the missing export.
 */
export const UK_POPULATION_MULTIPLIERS: Record<string, number> = {
  new_britons: 0.3,
  urban_progressives: 0.7,
  young_renters: 0.85,
  post_industrial_workers: 1.4,
  rural_traditionalists: 1.15,
  retirees: 0.9,
  populist_right: 0.3,
  green_activists: 0.4,
  suburban_homeowners: 1.15,
  moderate_centrists: 0.9,
  public_sector: 1.15,
};
