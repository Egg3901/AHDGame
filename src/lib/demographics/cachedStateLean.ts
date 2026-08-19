import type {
  DemographicCategory,
  StateDemographics,
  StateDemographicTurnout,
} from "@/lib/db/types";
import { buildGranularElectorateSubstrate } from "@/lib/demographics/granularElectorate";
import { calculateStateLean, type CalculatedLean } from "@/lib/utils/demographics";

export interface CachedStateLeanContext {
  countryId: string;
  stateId: string;
  preset?: string | null;
  turnoutDoc?: StateDemographicTurnout | null;
  demographicDefaults?: StateDemographics | null;
  year?: number | null;
  startingYear?: number | null;
}

/**
 * Derive the lean persisted on state cache documents.
 *
 * The calibrated US electorate lives in the granular substrate, which is
 * era-aware: `DEMOGRAPHIC_POSITIONS` authors a position table per era and
 * `STATE_POSITION_OVERRIDES` layers a regional map on the anchor eras, with
 * `getEraPositionsForYear` blending forward for the eras between anchors.
 *
 * This used to run for `1953-default` only. Every other US world fell back to
 * `calculateStateLean`, which reads the era-INVARIANT `defaultEconomicLean` /
 * `defaultSocialLean` constants on the 12 demographic groups. Those constants
 * are modern-calibrated and their two axes are ~0.88 collinear, so any weighted
 * mix of them is collinear too: measured state leans came out at r=0.9956 in
 * 2019 and r=0.972 in 1953, with only 2 of 51 states showing opposite-sign
 * economic and social leans in either era. The social axis carried no
 * independent information anywhere.
 *
 * It also disagrees with the game: `presidentialElectionEngine` and
 * `electionEngine/tallyManagement` already build this substrate for EVERY
 * preset, so votes are decided by era-aware positions while the cached lean
 * driving the map and `candidateEnrichment`'s primary scoring comes from modern
 * group defaults.
 *
 * Extending the substrate to every US preset was tried and reverted. It did not
 * fix the collinearity it was aimed at (2019 measured r=0.9956 before, 0.9911
 * after) because 2019's own authored tables are collinear, and it moved 2019's
 * lean magnitudes materially (Mississippi 2.08 -> 0.55), which risks the
 * per-state calibration `stateCensusData` carries against real 2020 two-party
 * margins. The collinearity is fixed in the authored position tables instead —
 * see `leanAxisIndependence.test.ts`. Unifying the cache and engine paths is
 * still worth doing, but it needs its own calibration audit rather than riding
 * along with a data fix.
 */
export function calculateStateLeanForCache(
  demographics: StateDemographics,
  categories: DemographicCategory[],
  context: CachedStateLeanContext
): CalculatedLean {
  if (context.countryId !== "US" || context.preset !== "1953-default") {
    return calculateStateLean(demographics, categories);
  }

  const substrate = buildGranularElectorateSubstrate({
    countryId: context.countryId,
    stateId: context.stateId,
    preset: context.preset,
    turnoutDoc: context.turnoutDoc,
    statePopulation: 1,
    demographics,
    categories,
    demographicDefaults: context.demographicDefaults,
    year: context.year,
    startingYear: context.startingYear,
    enriched: [],
  });

  if (!substrate) return calculateStateLean(demographics, categories);
  return calculateStateLean(substrate.demographics, substrate.categories);
}
