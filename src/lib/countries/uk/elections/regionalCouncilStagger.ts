import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  CANONICAL_REAL_ELECTION_YEARS_BY_PRESET,
  getCycleAnchors,
  type CycleAnchorContext,
} from "@/lib/elections/cycleAnchorContext";

export type UKRegionalCouncilCohort = 1 | 2 | 3 | 4 | 5;

/**
 * UK regional councils vote in five annual cohorts while retaining five-year
 * terms. The cohorts are balanced by council seats (105-129 seats each), not
 * by region count, so no single year recreates the old nationwide wipe.
 *
 * Cohort 5 resolves with the next Commons general election. Cohorts 1-4 are
 * off-cycle local elections and receive the opposition-party midterm boost.
 */
export const UK_REGIONAL_COUNCIL_COHORT_BY_REGION: Readonly<
  Record<string, UKRegionalCouncilCohort>
> = {
  SCO: 1, // 129 seats
  NIR: 2, // 90 + 17 = 107
  NEE: 2,
  SEE: 3, // 67 + 60 = 127
  WAL: 3,
  SWE: 4, // 39 + 39 + 32 = 110
  EAE: 4,
  LON: 4,
  EMI: 5, // 39 + 27 + 21 + 18 = 105
  NWE: 5,
  YHU: 5,
  WMI: 5,
};

export const UK_REGIONAL_COUNCIL_COHORT_COUNT = 5;

export function getUKRegionalCouncilCohort(
  regionId: string | null | undefined
): UKRegionalCouncilCohort | undefined {
  if (!regionId) return undefined;
  return UK_REGIONAL_COUNCIL_COHORT_BY_REGION[regionId.toUpperCase()];
}

/** Cycle-1 close for a region: one to five years after the Commons anchor. */
export function getUKRegionalCouncilCycle1EndTurn(
  regionId: string,
  ctx: CycleAnchorContext
): number | undefined {
  const cohort = getUKRegionalCouncilCohort(regionId);
  if (!cohort) return undefined;
  return getCycleAnchors(ctx).ukCommons + cohort * TURNS_PER_YEAR;
}

/** Baked LARP year for a staggered regional-council election. */
export function getUKRegionalCouncilElectionYear(
  regionId: string,
  cycle: number,
  ctx: CycleAnchorContext
): number {
  if (cycle === 0) return ctx.startingYear;
  const cohort = getUKRegionalCouncilCohort(regionId) ?? UK_REGIONAL_COUNCIL_COHORT_COUNT;
  const years =
    CANONICAL_REAL_ELECTION_YEARS_BY_PRESET[ctx.preset] ??
    CANONICAL_REAL_ELECTION_YEARS_BY_PRESET["2019-default"];
  return years.ukCommons + cohort + (cycle - 1) * UK_REGIONAL_COUNCIL_COHORT_COUNT;
}

/**
 * Transition/founding elections use cycle 0 and stay neutral. Thereafter,
 * cohorts 1-4 are UK regional midterms; cohort 5 is on-cycle with Commons.
 */
export function isUKRegionalCouncilMidterm(input: {
  countryId: string | null | undefined;
  electionType: string;
  state: string | null | undefined;
  cycle: number;
}): boolean {
  if (input.countryId !== "UK" || input.electionType !== "regionalCouncil") return false;
  if (input.cycle <= 0) return false;
  const cohort = getUKRegionalCouncilCohort(input.state);
  return cohort != null && cohort < UK_REGIONAL_COUNCIL_COHORT_COUNT;
}
