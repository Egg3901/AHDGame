import type { CountryGeography } from "../contract";
import { stateCensusData } from "./data/usStateCensusData";
import { stateCensusData1953 } from "./data/usStateCensusData1953";
import { stateCensusData1979 } from "./data/usStateCensusData1979";
import { stateCensusData1991 } from "./data/usStateCensusData1991";
import { stateCensusData1999 } from "./data/usStateCensusData1999";
import { stateCensusData2007 } from "./data/usStateCensusData2007";
import { stateCensusData2023 } from "./data/usStateCensusData2023";
import { stateCensusData2027 } from "./data/usStateCensusData2027";
import { usMetricPresets1953 } from "./data/usMetricPresets1953";
import { usMetricPresets1991, usMetricPresets2019 } from "./data/usMetricPresets";
import { usPopulationAnchors1991, usPopulationAnchors2019 } from "./data/usPopulationAnchors";
import { states } from "./data/usStates";
import { states1953 } from "./data/usStates1953";
import { states1979 } from "./data/usStates1979";
import { states1991 } from "./data/usStates1991";
import { states1999 } from "./data/usStates1999";
import { states2007 } from "./data/usStates2007";
import { states2023 } from "./data/usStates2023";
import { states2027 } from "./data/usStates2027";
import { stateMetrics } from "./data/usStateMetrics";
import {
  US_ADJACENCY_MAP,
  US_CONSCRIPTION,
  US_CONTINENT,
  US_CORE5_NORMALS,
  US_ISO_NUMERIC,
  US_MAP_REGISTRY,
  US_NON_PARTY_INDEPENDENT_BIAS,
  US_POPULATION_MULTIPLIERS,
  US_NPP_CAPITAL_STATE,
  US_UN_MEMBER_SINCE,
  US_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where the United States is, and who lives there.
 *
 * ⚠️ THIS MODULE IS HEAVY AND MUST NOT BE REACHED FROM A CLIENT COMPONENT. It
 * imports every era of census, metric and region data as VALUES. A registry that
 * needs one string -- a continent, an ISO code, a map anchor -- imports
 * `./geographyFacts` instead, which has no value imports at all.
 *
 * That distinction is not theoretical. `countryContinents.ts` held `JP: "Asia"`
 * at zero cost, was repointed at `JP_GEOGRAPHY.continent`, and started pulling
 * 108 KB into every client bundle that read a continent -- with typecheck, lint
 * and 38,000 tests green throughout. `clientSafeLeafModules.test.ts` exists
 * because of it.
 *
 * ⚠️ EVERY BUNDLE BELOW IS REFERENCED, NEVER INLINED. An early revision of
 * Japan's geography GENERATED copies of its census bundles from the snapshot
 * instead of importing the authored modules. Deep equality passed and Japan
 * quietly had two sources for every region. These are `import`s for that reason,
 * and `japanReachable.test.ts` uses `toBe` rather than `toEqual` to keep it so.
 */

/**
 * Region display names, derived from the state rows.
 *
 * ⚠️ DERIVED, NOT AUTHORED. `REGION_NAME_MAPS` has no US entry, and the state
 * rows already carry `name`. Writing the fifty out again here would be a second
 * source that agrees on the day it is written -- which is exactly how Japan
 * ended up with its region names in two places, in `JP_REGIONS[].name` and in
 * `JP_GEOGRAPHY.regionNames`, with nothing keeping them equal.
 */
const regionNames: Record<string, string> = Object.fromEntries(
  states.map((state) => [state._id, state.name])
);

const censusBundles = {
  "1953-default": stateCensusData1953,
  "1979-default": stateCensusData1979,
  "1991-default": stateCensusData1991,
  "1999-default": stateCensusData1999,
  "2007-default": stateCensusData2007,
  "2019-default": stateCensusData,
  "2023-default": stateCensusData2023,
  "2027-default": stateCensusData2027,
};

/**
 * ⚠️ FOUR PRESETS, NOT EIGHT, AND THE GAPS ARE REAL. `usMetricPresets` authors
 * 1953, 1991 and 2019 only; the other eras inherit. An entry invented for a
 * missing preset would be an authored value standing in for a deliberate
 * fallback.
 */
const metricPresets = {
  "1953-default": usMetricPresets1953,
  "1991-default": usMetricPresets1991,
  "2019-default": usMetricPresets2019,
};

const populationAnchors = {
  "1991-default": usPopulationAnchors1991,
  "2019-default": usPopulationAnchors2019,
};

const regionBundles = {
  "1953-default": states1953,
  "1979-default": states1979,
  "1991-default": states1991,
  "1999-default": states1999,
  "2007-default": states2007,
  "2019-default": states,
  "2023-default": states2023,
  "2027-default": states2027,
};

export const US_GEOGRAPHY: CountryGeography = {
  continent: US_CONTINENT,
  isoNumeric: US_ISO_NUMERIC,
  unMemberSince: US_UN_MEMBER_SINCE,
  worldRegion: US_WORLD_REGION,
  nppCapitalState: US_NPP_CAPITAL_STATE,
  nonPartyIndependentBias: US_NON_PARTY_INDEPENDENT_BIAS,
  adjacency: US_ADJACENCY_MAP,
  regionNames,
  conscription: US_CONSCRIPTION,
  populationMultipliers: US_POPULATION_MULTIPLIERS,
  censusBundles,
  populationAnchors,
  metricPresets,
  regionBundles,
  rawMetrics: stateMetrics,
  mapRegistry: US_MAP_REGISTRY,
  core5Normals: US_CORE5_NORMALS,
};

/**
 * ⚠️ NO `demographicCategoryIds`. `REGION_DEMOGRAPHIC_CATEGORY_IDS` is
 * `Partial<Record<CountryId, string[]>>` with entries for UK, JP, DE, IE, CN and
 * BR and none for the US, which uses every category rather than a filtered set.
 * The field is optional precisely so a country can say that by absence.
 */
