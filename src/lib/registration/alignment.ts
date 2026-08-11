/**
 * Compass maths for the character creator.
 *
 * Everything here works in the shared −5..+5 policy space that
 * `POLICY_INTEGER_AXIS_RANGE` defines: `economic` runs left(−) → right(+) and
 * `social` runs liberal(−) → traditional(+). Party `economicPosition` /
 * `socialPosition` and a region's `cachedEconomicLean` / `cachedSocialLean` are
 * already stored on that same ruler, so candidate, party, and electorate are
 * directly comparable without any rescaling.
 */

import { getCompassPositionLabel, POLICY_INTEGER_AXIS_RANGE } from "@/lib/utils/politics";

export interface CompassPoint {
  economic: number;
  social: number;
}

/** Longest possible separation on the plane — corner to corner. */
export const MAX_COMPASS_DISTANCE = Math.hypot(
  POLICY_INTEGER_AXIS_RANGE * 2,
  POLICY_INTEGER_AXIS_RANGE * 2
);

/** Euclidean distance between two points in policy space. */
export function compassDistance(a: CompassPoint, b: CompassPoint): number {
  return Math.hypot(a.economic - b.economic, a.social - b.social);
}

export type AlignmentBand = "aligned" | "close" | "daylight" | "at-odds";

/**
 * Bucket a policy distance into a band. Thresholds are tuned to the ±5 ruler:
 * one full step on a single axis still reads as "aligned", a two-step gap on
 * both axes is where real friction starts.
 */
export function alignmentBand(distance: number): AlignmentBand {
  if (distance < 1.5) return "aligned";
  if (distance < 3) return "close";
  if (distance < 5.5) return "daylight";
  return "at-odds";
}

export const ALIGNMENT_META: Record<
  AlignmentBand,
  { label: string; toneClass: string; dotClass: string }
> = {
  aligned: {
    label: "Aligned",
    toneClass: "text-success border-success/30 bg-success/10",
    dotClass: "bg-success",
  },
  close: {
    label: "Close",
    toneClass: "text-primary border-primary/30 bg-primary/10",
    dotClass: "bg-primary",
  },
  daylight: {
    label: "Some daylight",
    toneClass: "text-warning border-warning/30 bg-warning/10",
    dotClass: "bg-warning",
  },
  "at-odds": {
    label: "At odds",
    toneClass: "text-error border-error/30 bg-error/10",
    dotClass: "bg-error",
  },
};

/**
 * Name the candidate's quadrant using the game's own archetype table.
 *
 * `getCompassPositionLabel` documents its second axis as −5 authoritarian →
 * +5 libertarian, which is the INVERSE of the `socialPosition` ruler used by
 * characters, parties, and regions (−5 liberal → +5 traditional). The sign flip
 * below reconciles the two; without it a traditionalist gets labelled as a
 * social liberal.
 */
export function ideologyLabel(point: CompassPoint): string {
  return getCompassPositionLabel(point.economic, -point.social);
}

export interface NearestParty<T extends CompassPoint> {
  party: T;
  distance: number;
  band: AlignmentBand;
}

/**
 * The party whose platform sits closest to the candidate. Returns null when the
 * country has no parties carrying positions yet, so callers show nothing rather
 * than inventing a match.
 */
export function nearestParty<T extends CompassPoint>(
  point: CompassPoint,
  parties: T[]
): NearestParty<T> | null {
  let best: NearestParty<T> | null = null;
  for (const party of parties) {
    const distance = compassDistance(point, party);
    if (!best || distance < best.distance) {
      best = { party, distance, band: alignmentBand(distance) };
    }
  }
  return best;
}
