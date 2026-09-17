import type { AdjacencyMap } from "@/lib/constants/stateAdjacency";
import type { Continent } from "@/lib/constants/countryContinents";
import type { ConscriptionPolicy } from "@/lib/demographics/conscription";
import type { NormalAnchor } from "@/lib/era/metricCatalog";
import type { ScoreThreshold } from "@/lib/utils/metricScoring";
import type { WorldEntityRegion } from "@/lib/world/worldEntityManifest";

/**
 * The small facts about where US is.
 *
 * ⚠ GENERATED FROM `__snapshots__/us.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-geography-facts.ts US --force
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
 * `COUNTRY_TO_ISO_NUMERIC` maps US to the code and
 * `ISO_NUMERIC_TO_COUNTRY` maps it back. The generator asserts they agree
 * before writing; if they ever disagree, a lookup by code and a lookup by
 * country would report different things.
 */

export const US_CONTINENT: Continent = "North America";

/** ISO 3166-1 numeric. `ISO_NUMERIC_TO_COUNTRY` holds the inverse entry. */
export const US_ISO_NUMERIC = "840";

export const US_UN_MEMBER_SINCE = 1945;

export const US_WORLD_REGION: WorldEntityRegion = "americas";

/** Where an NPP corporation is seated when it has no other home. */
export const US_NPP_CAPITAL_STATE = "DC";

/** Independent-bias nudge for the non-party bucket. */
export const US_NON_PARTY_INDEPENDENT_BIAS = 2.3333333333333335;

/** Map centring for the commodity and world maps: [longitude, latitude]. */
export const US_MAP_ANCHOR: [number, number] = [-98.5, 39.8];

/**
 * Median-income scoring thresholds.
 *
 * ⚠ LOCAL CURRENCY, like every money figure in the folder, and NOT comparable to
 * another country's.
 */
export const US_MEDIAN_INCOME_THRESHOLDS: ScoreThreshold = {
  best: 90000,
  worst: 32000,
};

/** Conscription policy at seed time. */
export const US_CONSCRIPTION: ConscriptionPolicy = {
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
 * `CORE5_NORMALS.gdpGrowth.US`, so the snapshot captured one entry per
 * metric rather than one object for the country. Each anchor is keyed `year`,
 * a NUMBER -- not `era`, a string.
 */
export const US_CORE5_NORMALS: Record<string, NormalAnchor[]> = {
  gdpGrowth: [
    {
      year: 1953,
      value: 4.2,
    },
    {
      year: 1979,
      value: 3.4,
    },
    {
      year: 1991,
      value: 2.9,
    },
    {
      year: 2019,
      value: 2.2,
    },
    {
      year: 2040,
      value: 1.8,
    },
  ],
  unemploymentRate: [
    {
      year: 1953,
      value: 4.5,
    },
    {
      year: 1979,
      value: 6,
    },
    {
      year: 1991,
      value: 6.8,
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
      value: 68.5,
    },
    {
      year: 1979,
      value: 73.8,
    },
    {
      year: 1991,
      value: 75.5,
    },
    {
      year: 2019,
      value: 78.8,
    },
    {
      year: 2040,
      value: 82,
    },
  ],
  violentCrimeRate: [
    {
      year: 1953,
      value: 160,
    },
    {
      year: 1979,
      value: 550,
    },
    {
      year: 1991,
      value: 750,
    },
    {
      year: 2019,
      value: 380,
    },
    {
      year: 2040,
      value: 350,
    },
  ],
  povertyRate: [
    {
      year: 1953,
      value: 26,
    },
    {
      year: 1979,
      value: 11.7,
    },
    {
      year: 1991,
      value: 14.2,
    },
    {
      year: 2019,
      value: 10.5,
    },
    {
      year: 2040,
      value: 9.5,
    },
  ],
};

/**
 * Which regions border which.
 *
 * ⚠ KEYED BY REGION, AND FOR US THOSE KEYS ARE NOT COUNTRY CODES. In the
 * United States' map `CA`, `DE` and `IN` are California, Delaware and Indiana,
 * not Canada, Germany and India. A tool that reads two-letter keys as countries
 * misreads this file, which is how 5,900 lines of US state data stayed invisible
 * to the relocation guard until its rule was fixed.
 */
export const US_ADJACENCY_MAP: AdjacencyMap = {
  AL: ["FL", "GA", "MS", "TN"],
  AK: ["WA"],
  AZ: ["CA", "CO", "NM", "NV", "UT"],
  AR: ["LA", "MS", "MO", "OK", "TN", "TX"],
  CA: ["AZ", "NV", "OR"],
  CO: ["AZ", "KS", "NE", "NM", "OK", "UT", "WY"],
  CT: ["MA", "NY", "RI"],
  DE: ["MD", "NJ", "PA"],
  DC: ["MD", "VA"],
  FL: ["AL", "GA"],
  GA: ["AL", "FL", "NC", "SC", "TN"],
  HI: [],
  ID: ["MT", "NV", "OR", "UT", "WA", "WY"],
  IL: ["IN", "IA", "KY", "MO", "WI"],
  IN: ["IL", "KY", "MI", "OH"],
  IA: ["IL", "MN", "MO", "NE", "SD", "WI"],
  KS: ["CO", "MO", "NE", "OK"],
  KY: ["IL", "IN", "MO", "OH", "TN", "VA", "WV"],
  LA: ["AR", "MS", "TX"],
  ME: ["NH"],
  MD: ["DE", "DC", "PA", "VA", "WV"],
  MA: ["CT", "NH", "NY", "RI", "VT"],
  MI: ["IN", "OH", "WI"],
  MN: ["IA", "ND", "SD", "WI"],
  MS: ["AL", "AR", "LA", "TN"],
  MO: ["AR", "IL", "IA", "KS", "KY", "NE", "OK", "TN"],
  MT: ["ID", "ND", "SD", "WY"],
  NE: ["CO", "IA", "KS", "MO", "SD", "WY"],
  NV: ["AZ", "CA", "ID", "OR", "UT"],
  NH: ["ME", "MA", "VT"],
  NJ: ["DE", "NY", "PA"],
  NM: ["AZ", "CO", "OK", "TX", "UT"],
  NY: ["CT", "MA", "NJ", "PA", "VT"],
  NC: ["GA", "SC", "TN", "VA"],
  ND: ["MN", "MT", "SD"],
  OH: ["IN", "KY", "MI", "PA", "WV"],
  OK: ["AR", "CO", "KS", "MO", "NM", "TX"],
  OR: ["CA", "ID", "NV", "WA"],
  PA: ["DE", "MD", "NJ", "NY", "OH", "WV"],
  RI: ["CT", "MA"],
  SC: ["GA", "NC"],
  SD: ["IA", "MN", "MT", "NE", "ND", "WY"],
  TN: ["AL", "AR", "GA", "KY", "MS", "MO", "NC", "VA"],
  TX: ["AR", "LA", "NM", "OK"],
  UT: ["AZ", "CO", "ID", "NV", "NM", "WY"],
  VT: ["MA", "NH", "NY"],
  VA: ["DC", "KY", "MD", "NC", "TN", "WV"],
  WA: ["AK", "ID", "OR"],
  WV: ["KY", "MD", "OH", "PA", "VA"],
  WI: ["IA", "IL", "MI", "MN"],
  WY: ["CO", "ID", "MT", "NE", "SD", "UT"],
};
