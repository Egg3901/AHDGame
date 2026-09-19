import type { AdjacencyMap } from "@/lib/constants/stateAdjacency";
// No CountryMapConfig import: this country's map config is relocated source,
// so nothing here is typed by it.
import type { Continent } from "@/lib/constants/countryContinents";
import type { ConscriptionPolicy } from "@/lib/demographics/conscription";
import type { NormalAnchor } from "@/lib/era/metricCatalog";
import type { ScoreThreshold } from "@/lib/utils/metricScoring";
import type { WorldEntityRegion } from "@/lib/world/worldEntityManifest";

/**
 * The small facts about where DE is.
 *
 * ⚠ GENERATED FROM `__snapshots__/de.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-geography-facts.ts DE --force
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
 * `COUNTRY_TO_ISO_NUMERIC` maps DE to the code and
 * `ISO_NUMERIC_TO_COUNTRY` maps it back. The generator asserts they agree
 * before writing; if they ever disagree, a lookup by code and a lookup by
 * country would report different things.
 */

export const DE_CONTINENT: Continent = "Europe";

/** ISO 3166-1 numeric. `ISO_NUMERIC_TO_COUNTRY` holds the inverse entry. */
export const DE_ISO_NUMERIC = "276";

export const DE_WORLD_REGION: WorldEntityRegion = "europe";

/** Where an NPP corporation is seated when it has no other home. */
export const DE_NPP_CAPITAL_STATE = "BE";

/** Independent-bias nudge for the non-party bucket. */
export const DE_NON_PARTY_INDEPENDENT_BIAS = 0.42857142857142855;

/** Map centring for the commodity and world maps: [longitude, latitude]. */
export const DE_MAP_ANCHOR: [number, number] = [10.4, 51.2];

/**
 * Median-income scoring thresholds.
 *
 * ⚠ LOCAL CURRENCY, like every money figure in the folder, and NOT comparable to
 * another country's.
 */
export const DE_MEDIAN_INCOME_THRESHOLDS: ScoreThreshold = {
  best: 62000,
  worst: 22000,
};

/** Conscription policy at seed time. */
export const DE_CONSCRIPTION: ConscriptionPolicy = {
  eligibleBand: [18, 20],
  sexEnabled: {
    male: true,
    female: false,
  },
  option: 1,
};

/**
 * Core-5 metric normals, keyed by metric.
 *
 * ⚠ THE REGISTRY IS METRIC-FIRST, NOT COUNTRY-FIRST. `CORE5_NORMALS` is read as
 * `CORE5_NORMALS.gdpGrowth.DE`, so the snapshot captured one entry per
 * metric rather than one object for the country. Each anchor is keyed `year`,
 * a NUMBER -- not `era`, a string.
 */
export const DE_CORE5_NORMALS: Record<string, NormalAnchor[]> = {
  gdpGrowth: [
    {
      year: 1953,
      value: 7.5,
    },
    {
      year: 1979,
      value: 3,
    },
    {
      year: 1991,
      value: 3.5,
    },
    {
      year: 2019,
      value: 1.2,
    },
    {
      year: 2040,
      value: 1,
    },
  ],
  unemploymentRate: [
    {
      year: 1953,
      value: 7,
    },
    {
      year: 1979,
      value: 3.5,
    },
    {
      year: 1991,
      value: 6,
    },
    {
      year: 2019,
      value: 3.2,
    },
    {
      year: 2040,
      value: 3.5,
    },
  ],
  lifeExpectancy: [
    {
      year: 1953,
      value: 67.5,
    },
    {
      year: 1979,
      value: 72.5,
    },
    {
      year: 1991,
      value: 75.5,
    },
    {
      year: 2019,
      value: 81,
    },
    {
      year: 2040,
      value: 84,
    },
  ],
  violentCrimeRate: [
    {
      year: 1953,
      value: 120,
    },
    {
      year: 1979,
      value: 200,
    },
    {
      year: 1991,
      value: 280,
    },
    {
      year: 2019,
      value: 220,
    },
    {
      year: 2040,
      value: 200,
    },
  ],
  povertyRate: [
    {
      year: 1953,
      value: 22,
    },
    {
      year: 1979,
      value: 10,
    },
    {
      year: 1991,
      value: 11,
    },
    {
      year: 2019,
      value: 10.5,
    },
    {
      year: 2040,
      value: 10,
    },
  ],
};

/**
 * Which regions border which.
 *
 * ⚠ KEYED BY REGION, AND FOR DE THOSE KEYS ARE NOT COUNTRY CODES. In the
 * United States' map `CA`, `DE` and `IN` are California, Delaware and Indiana,
 * not Canada, Germany and India. A tool that reads two-letter keys as countries
 * misreads this file, which is how 5,900 lines of US state data stayed invisible
 * to the relocation guard until its rule was fixed.
 */
export const DE_ADJACENCY_MAP: AdjacencyMap = {
  SH: ["HH", "MV", "NI"],
  HH: ["SH", "NI"],
  BRE: ["NI"],
  NI: ["SH", "HH", "BRE", "MV", "BB", "ST", "TH", "HE", "NW"],
  MV: ["SH", "NI", "BB"],
  BB: ["MV", "NI", "ST", "SN", "BE"],
  BE: ["BB"],
  ST: ["NI", "BB", "SN", "TH"],
  SN: ["BB", "ST", "TH", "BY"],
  TH: ["NI", "ST", "SN", "BY", "HE"],
  BY: ["BW", "HE", "TH", "SN"],
  BW: ["BY", "HE", "RP"],
  HE: ["NI", "NW", "RP", "BW", "BY", "TH"],
  RP: ["NW", "HE", "BW", "SL"],
  SL: ["RP"],
  NW: ["NI", "HE", "RP"],
};

/*
 * No `DE_MAP_REGISTRY` here, deliberately.
 *
 * ⚠ THE SNAPSHOT COULD NOT HOLD IT. DE's entry in COUNTRY_MAP_REGISTRY
 * carries a `featureIdExtractor` function, which JSON cannot express, so the
 * emitter recorded the shape as `function-valued` with a null value. Emitting
 * that null would have produced a map config of `null` that satisfies a cast
 * and breaks the map at runtime.
 *
 * The block is RELOCATED as source instead -- see `./data/deMapConfig.ts`.
 */

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
export const DE_INCOME_ANCHORS: NormalAnchor[] = [
  {
    year: 1953,
    value: 4800,
  },
  {
    year: 1979,
    value: 21000,
  },
  {
    year: 1991,
    value: 28000,
  },
  {
    year: 2019,
    value: 47000,
  },
];

/*
 * ⚠ THESE TWO ARE INDEPENDENT, AND NESTING THEM COST ELEVEN COUNTRIES. The
 * income-anchor block was first written INSIDE the population-multiplier
 * ternary, so a country with anchors but no 1991 cohort row -- France, Austria,
 * East Germany and eight others -- emitted neither. Typecheck caught it only
 * because metricCatalog.ts had already been repointed at the missing export.
 */
export const DE_POPULATION_MULTIPLIERS: Record<string, number> = {
  katholische_konservative: 1.1,
  gewerkschafter: 1.4,
  urbane_progressive: 0.7,
  wirtschaftsliberale: 0.85,
  ost_post_industriell: 3,
  gruene_mittelschicht: 0.5,
  rentner_west: 0.85,
  migranten_communities: 0.5,
  landwirte_dorf: 1.2,
  junge_grossstadt: 0.9,
  protest_waehler_ost: 2.5,
};
