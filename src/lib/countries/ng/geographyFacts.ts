import type { AdjacencyMap } from "@/lib/constants/stateAdjacency";
import type { CountryMapConfig } from "@/lib/commodity-map/commodityMapRegistry";
import type { Continent } from "@/lib/constants/countryContinents";
import type { ConscriptionPolicy } from "@/lib/demographics/conscription";
import type { NormalAnchor } from "@/lib/era/metricCatalog";
import type { ScoreThreshold } from "@/lib/utils/metricScoring";
import type { WorldEntityRegion } from "@/lib/world/worldEntityManifest";

/**
 * The small facts about where NG is.
 *
 * ⚠ GENERATED FROM `__snapshots__/ng.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-geography-facts.ts NG --force
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
 * `COUNTRY_TO_ISO_NUMERIC` maps NG to the code and
 * `ISO_NUMERIC_TO_COUNTRY` maps it back. The generator asserts they agree
 * before writing; if they ever disagree, a lookup by code and a lookup by
 * country would report different things.
 */

export const NG_CONTINENT: Continent = "Africa";

/** ISO 3166-1 numeric. `ISO_NUMERIC_TO_COUNTRY` holds the inverse entry. */
export const NG_ISO_NUMERIC = "566";

export const NG_UN_MEMBER_SINCE = 1960;

export const NG_WORLD_REGION: WorldEntityRegion = "africa";

/** Where an NPP corporation is seated when it has no other home. */
export const NG_NPP_CAPITAL_STATE = "NORTH_CENTRAL";

/* No NG_NON_PARTY_INDEPENDENT_BIAS: the registry has no NG entry, and
   `nonPartyIndependentBias` is optional in the contract. A country with no nudge
   is not a country nudged by zero. */

/** Map centring for the commodity and world maps: [longitude, latitude]. */
export const NG_MAP_ANCHOR: [number, number] = [8.7, 9.1];

/**
 * Median-income scoring thresholds.
 *
 * ⚠ LOCAL CURRENCY, like every money figure in the folder, and NOT comparable to
 * another country's.
 */
export const NG_MEDIAN_INCOME_THRESHOLDS: ScoreThreshold = {
  best: 1500000,
  worst: 540000,
};

/** Conscription policy at seed time. */
export const NG_CONSCRIPTION: ConscriptionPolicy = {
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
 * `CORE5_NORMALS.gdpGrowth.NG`, so the snapshot captured one entry per
 * metric rather than one object for the country. Each anchor is keyed `year`,
 * a NUMBER -- not `era`, a string.
 */
export const NG_CORE5_NORMALS: Record<string, NormalAnchor[]> = {
  gdpGrowth: [
    {
      year: 1953,
      value: 4,
    },
    {
      year: 1979,
      value: 5,
    },
    {
      year: 1991,
      value: 2,
    },
    {
      year: 2019,
      value: 2.2,
    },
    {
      year: 2040,
      value: 3,
    },
  ],
  unemploymentRate: [
    {
      year: 1953,
      value: 5,
    },
    {
      year: 1979,
      value: 7,
    },
    {
      year: 1991,
      value: 12,
    },
    {
      year: 2019,
      value: 14,
    },
    {
      year: 2040,
      value: 11,
    },
  ],
  lifeExpectancy: [
    {
      year: 1953,
      value: 35,
    },
    {
      year: 1979,
      value: 44.5,
    },
    {
      year: 1991,
      value: 46,
    },
    {
      year: 2019,
      value: 54.5,
    },
    {
      year: 2040,
      value: 62,
    },
  ],
  violentCrimeRate: [
    {
      year: 1953,
      value: 250,
    },
    {
      year: 1979,
      value: 400,
    },
    {
      year: 1991,
      value: 550,
    },
    {
      year: 2019,
      value: 600,
    },
    {
      year: 2040,
      value: 550,
    },
  ],
  povertyRate: [
    {
      year: 1953,
      value: 30,
    },
    {
      year: 1979,
      value: 27,
    },
    {
      year: 1991,
      value: 28,
    },
    {
      year: 2019,
      value: 26,
    },
    {
      year: 2040,
      value: 22,
    },
  ],
};

/**
 * Which regions border which.
 *
 * ⚠ KEYED BY REGION, AND FOR NG THOSE KEYS ARE NOT COUNTRY CODES. In the
 * United States' map `CA`, `DE` and `IN` are California, Delaware and Indiana,
 * not Canada, Germany and India. A tool that reads two-letter keys as countries
 * misreads this file, which is how 5,900 lines of US state data stayed invisible
 * to the relocation guard until its rule was fixed.
 */
export const NG_ADJACENCY_MAP: AdjacencyMap = {
  NORTH_WEST: ["NORTH_EAST", "NORTH_CENTRAL"],
  NORTH_EAST: ["NORTH_WEST", "NORTH_CENTRAL"],
  NORTH_CENTRAL: ["NORTH_WEST", "NORTH_EAST", "SOUTH_WEST", "SOUTH_SOUTH", "SOUTH_EAST"],
  SOUTH_WEST: ["NORTH_CENTRAL", "SOUTH_SOUTH"],
  SOUTH_SOUTH: ["NORTH_CENTRAL", "SOUTH_WEST", "SOUTH_EAST"],
  SOUTH_EAST: ["NORTH_CENTRAL", "SOUTH_SOUTH"],
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
export const NG_MAP_REGISTRY: CountryMapConfig = {
  countryId: "NG",
  name: "Nigeria",
  overviewPath: "/country/ng",
  mapPath: "/country/ng/map",
  hasRegionMap: false,
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
export const NG_INCOME_ANCHORS: NormalAnchor[] = [
  {
    year: 1953,
    value: 150,
  },
  {
    year: 1979,
    value: 90000,
  },
  {
    year: 1991,
    value: 210000,
  },
  {
    year: 2019,
    value: 1100000,
  },
];

/*
 * ⚠ THESE TWO ARE INDEPENDENT, AND NESTING THEM COST ELEVEN COUNTRIES. The
 * income-anchor block was first written INSIDE the population-multiplier
 * ternary, so a country with anchors but no 1991 cohort row -- France, Austria,
 * East Germany and eight others -- emitted neither. Typecheck caught it only
 * because metricCatalog.ts had already been repointed at the missing export.
 */
/* No NG_POPULATION_MULTIPLIERS: the 1991 cohort table has no NG row, so that era passes through at 1.0. */
