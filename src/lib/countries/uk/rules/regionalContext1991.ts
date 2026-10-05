/**
 * UK 1991 regional context offsets, calibrated to published general election
 * regional vote shares (#3076).
 *
 * The census-by-position derivation gives the twelve regions a combined spread
 * of about one point on the economic axis, against a Labour minus Conservative
 * margin that ranged over more than fifty points between regions. Composition
 * alone cannot reach that contrast, so each region carries a bounded contextual
 * economic offset proportional to how far its margin sat from the national one.
 *
 * Boundaries this keeps:
 * - Vote choice is not ideology. Only the economic axis is moved, by a fixed
 *   and deliberately small rate, and the offsets are centred so the population
 *   weighted national mean does not move. Third-party and nationalist vote does
 *   not enter, and the social axis stays composition driven because vote shares
 *   do not measure it.
 * - Northern Ireland votes on a separate party system, so its vote shares are
 *   not comparable and it receives no offset.
 *
 * Pure: published constants in, offsets out.
 */

export interface PublishedRegionVote {
  /** Conservative share of the valid vote, percent. */
  con: number;
  /** Labour share of the valid vote, percent. */
  lab: number;
}

/**
 * Published regional results. 1987: House of Commons Library general election
 * results by standard region. 1992: House of Commons Library Research Paper
 * 01/38 (General Election Results) regional tables. Standard regions of the
 * time: "South East" excludes Greater London, which is reported separately.
 */
export const PUBLISHED_REGIONAL_VOTE: Record<
  "1987" | "1992",
  Record<string, PublishedRegionVote>
> = {
  "1987": {
    scotland: { con: 24.0, lab: 42.4 },
    wales: { con: 29.5, lab: 45.1 },
    north: { con: 32.3, lab: 46.4 },
    yorkshireHumberside: { con: 37.4, lab: 40.6 },
    northWest: { con: 38.0, lab: 41.2 },
    eastMidlands: { con: 48.6, lab: 30.0 },
    westMidlands: { con: 45.5, lab: 33.3 },
    eastAnglia: { con: 52.1, lab: 21.7 },
    greaterLondon: { con: 46.5, lab: 31.5 },
    southEast: { con: 55.6, lab: 16.8 },
    southWest: { con: 50.6, lab: 15.9 },
  },
  "1992": {
    scotland: { con: 25.7, lab: 39.0 },
    wales: { con: 28.6, lab: 49.5 },
    north: { con: 33.4, lab: 50.6 },
    yorkshireHumberside: { con: 37.9, lab: 44.3 },
    northWest: { con: 37.8, lab: 44.9 },
    eastMidlands: { con: 46.6, lab: 37.4 },
    westMidlands: { con: 44.8, lab: 38.8 },
    eastAnglia: { con: 51.1, lab: 28.0 },
    greaterLondon: { con: 45.3, lab: 37.1 },
    southEast: { con: 54.5, lab: 20.8 },
    southWest: { con: 47.6, lab: 19.2 },
  },
};

/**
 * Crosswalk from the game's regions to the published standard regions, as
 * weights summing to one. The game's East of England runs past the old East
 * Anglia standard region into Bedfordshire, Hertfordshire and Essex, which the
 * published tables count in the South East, so it blends the two by their
 * approximate 1991 populations (about 2.0 and 3.9 million).
 */
export const UK_REGION_CROSSWALK_1991: Record<string, Record<string, number>> = {
  NEE: { north: 1 },
  NWE: { northWest: 1 },
  YHU: { yorkshireHumberside: 1 },
  EMI: { eastMidlands: 1 },
  WMI: { westMidlands: 1 },
  EAE: { eastAnglia: 1 / 3, southEast: 2 / 3 },
  LON: { greaterLondon: 1 },
  SEE: { southEast: 1 },
  SWE: { southWest: 1 },
  WAL: { wales: 1 },
  SCO: { scotland: 1 },
};

/** 1991 census resident population by game region, millions (rounded), used only to centre the offsets. */
export const UK_REGION_POPULATION_1991: Record<string, number> = {
  NEE: 3.1,
  NWE: 6.4,
  YHU: 5.0,
  EMI: 4.0,
  WMI: 5.1,
  EAE: 5.0,
  LON: 6.8,
  SEE: 7.7,
  SWE: 4.7,
  WAL: 2.9,
  SCO: 5.1,
};

/** Economic lean points per percentage point of regional margin away from the national margin. */
export const ECONOMIC_LEAN_PER_MARGIN_POINT = 0.04;
/** No region's contextual offset exceeds this many lean points. */
export const MAX_REGIONAL_OFFSET = 1.5;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Mean Labour minus Conservative margin over the two elections, percentage points. */
export function regionalMargin(
  weights: Record<string, number>,
  vote: typeof PUBLISHED_REGIONAL_VOTE = PUBLISHED_REGIONAL_VOTE
): number {
  const elections = Object.values(vote);
  let total = 0;
  let weightSum = 0;
  for (const [published, weight] of Object.entries(weights)) {
    for (const election of elections) {
      const row = election[published];
      if (!row) throw new Error(`No published vote for ${published}`);
      total += weight * (row.lab - row.con);
      weightSum += weight;
    }
  }
  return total / weightSum;
}

/**
 * Contextual economic offsets by game region. Labour-leaning regions move left
 * (negative), Conservative-leaning regions move right, centred on the
 * population-weighted mean so the national position is unchanged.
 */
export function ukRegionalContext1991(): Record<
  string,
  { economicLean: number; socialLean: number }
> {
  const ids = Object.keys(UK_REGION_CROSSWALK_1991);
  const margins = Object.fromEntries(
    ids.map((id) => [id, regionalMargin(UK_REGION_CROSSWALK_1991[id])])
  );
  const popTotal = ids.reduce((sum, id) => sum + UK_REGION_POPULATION_1991[id], 0);
  const mean =
    ids.reduce((sum, id) => sum + margins[id] * UK_REGION_POPULATION_1991[id], 0) / popTotal;
  const raw = Object.fromEntries(
    ids.map((id) => {
      const offset = -(margins[id] - mean) * ECONOMIC_LEAN_PER_MARGIN_POINT;
      return [id, Math.max(-MAX_REGIONAL_OFFSET, Math.min(MAX_REGIONAL_OFFSET, offset))];
    })
  );
  // Clamping can move the weighted mean, so recentre once.
  const clampedMean =
    ids.reduce((sum, id) => sum + raw[id] * UK_REGION_POPULATION_1991[id], 0) / popTotal;
  return Object.fromEntries(
    ids.map((id) => [id, { economicLean: round2(raw[id] - clampedMean), socialLean: 0 }])
  );
}
