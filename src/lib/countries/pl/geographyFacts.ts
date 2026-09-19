import type { AdjacencyMap } from "@/lib/constants/stateAdjacency";
import type { CountryMapConfig } from "@/lib/commodity-map/commodityMapRegistry";
import type { Continent } from "@/lib/constants/countryContinents";

import type { WorldEntityRegion } from "@/lib/world/worldEntityManifest";

/**
 * The small facts about where PL is.
 *
 * ⚠ GENERATED FROM `__snapshots__/pl.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-geography-facts.ts PL --force
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
 * `COUNTRY_TO_ISO_NUMERIC` maps PL to the code and
 * `ISO_NUMERIC_TO_COUNTRY` maps it back. The generator asserts they agree
 * before writing; if they ever disagree, a lookup by code and a lookup by
 * country would report different things.
 */

export const PL_CONTINENT: Continent = "Europe";

/** ISO 3166-1 numeric. `ISO_NUMERIC_TO_COUNTRY` holds the inverse entry. */
export const PL_ISO_NUMERIC = "616";

export const PL_UN_MEMBER_SINCE = 1945;

export const PL_WORLD_REGION: WorldEntityRegion = "europe";

/** Where an NPP corporation is seated when it has no other home. */
export const PL_NPP_CAPITAL_STATE = "";

/* No PL_NON_PARTY_INDEPENDENT_BIAS: the registry has no PL entry, and
   `nonPartyIndependentBias` is optional in the contract. A country with no nudge
   is not a country nudged by zero. */

/** Map centring for the commodity and world maps: [longitude, latitude]. */
export const PL_MAP_ANCHOR: [number, number] = [19.1, 52.1];

/**
 * Median-income scoring thresholds.
 *
 * ⚠ LOCAL CURRENCY, like every money figure in the folder, and NOT comparable to
 * another country's.
 */
/* No PL_MEDIAN_INCOME_THRESHOLDS: no row in the registry. */

/**
 * Core-5 metric normals, keyed by metric.
 *
 * ⚠ THE REGISTRY IS METRIC-FIRST, NOT COUNTRY-FIRST. `CORE5_NORMALS` is read as
 * `CORE5_NORMALS.gdpGrowth.PL`, so the snapshot captured one entry per
 * metric rather than one object for the country. Each anchor is keyed `year`,
 * a NUMBER -- not `era`, a string.
 */
/* No PL_CORE5_NORMALS: the metric-first registry carries no PL anchors. */

/**
 * Which regions border which.
 *
 * ⚠ KEYED BY REGION, AND FOR PL THOSE KEYS ARE NOT COUNTRY CODES. In the
 * United States' map `CA`, `DE` and `IN` are California, Delaware and Indiana,
 * not Canada, Germany and India. A tool that reads two-letter keys as countries
 * misreads this file, which is how 5,900 lines of US state data stayed invisible
 * to the relocation guard until its rule was fixed.
 */
export const PL_ADJACENCY_MAP: AdjacencyMap = {
  PL_MAZ: ["PL_LOD", "PL_WLK", "PL_POM", "PL_EAS"],
  PL_LOD: ["PL_MAZ", "PL_MAL", "PL_SLK", "PL_WLK", "PL_EAS"],
  PL_MAL: ["PL_LOD", "PL_SLK", "PL_EAS"],
  PL_SLK: ["PL_LOD", "PL_MAL", "PL_DSL", "PL_WLK"],
  PL_DSL: ["PL_SLK", "PL_WLK", "PL_POM"],
  PL_WLK: ["PL_MAZ", "PL_LOD", "PL_SLK", "PL_DSL", "PL_POM"],
  PL_POM: ["PL_MAZ", "PL_DSL", "PL_WLK", "PL_EAS"],
  PL_EAS: ["PL_MAZ", "PL_LOD", "PL_MAL", "PL_POM"],
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
export const PL_MAP_REGISTRY: CountryMapConfig = {
  countryId: "PL",
  name: "Poland",
  overviewPath: "/country/pl",
  mapPath: "/country/pl/map",
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
/* No PL_INCOME_ANCHORS: the registry has no PL row. */

/*
 * ⚠ THESE TWO ARE INDEPENDENT, AND NESTING THEM COST ELEVEN COUNTRIES. The
 * income-anchor block was first written INSIDE the population-multiplier
 * ternary, so a country with anchors but no 1991 cohort row -- France, Austria,
 * East Germany and eight others -- emitted neither. Typecheck caught it only
 * because metricCatalog.ts had already been repointed at the missing export.
 */
/* No PL_POPULATION_MULTIPLIERS: the 1991 cohort table has no PL row, so that era passes through at 1.0. */
