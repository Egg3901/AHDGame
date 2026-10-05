/**
 * The "Close" race rule shared by every elections surface: the row badge, the
 * "Close races" filter, the per-office close count, and the map marker.
 *
 * A race is close when the top two general-election polling shares are within
 * {@link CLOSE_RACE_MARGIN_PTS} points. Primary shares are normalized inside
 * each party, so comparing two party primaries would make two 100% leaders
 * look tied; races still in their primary never count as close.
 *
 * Pure: no db, clock, random, or env.
 */

/** Top-two polling margin, in percentage points, at or under which a race is close. */
export const CLOSE_RACE_MARGIN_PTS = 15;

/** Human copy for tooltips and filter titles. */
export const CLOSE_RACE_RULE_TEXT = `Top two within ${CLOSE_RACE_MARGIN_PTS} points in general-election polling`;

export interface CloseRaceInput {
  inPrimary?: boolean | null;
  /** Polling shares in percentage points keyed by candidate. */
  sharesPct?: Record<string, number> | null;
}

/** Margin between the top two finite shares, or null with fewer than two. */
export function topTwoMarginPts(
  sharesPct: Record<string, number> | null | undefined
): number | null {
  const pcts = Object.values(sharesPct ?? {}).filter((v) => Number.isFinite(v));
  if (pcts.length < 2) return null;
  const sorted = [...pcts].sort((a, b) => b - a);
  return sorted[0] - sorted[1];
}

export function isCloseRace(input: CloseRaceInput): boolean {
  if (input.inPrimary) return false;
  const margin = topTwoMarginPts(input.sharesPct);
  return margin !== null && margin <= CLOSE_RACE_MARGIN_PTS;
}
