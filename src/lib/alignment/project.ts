/**
 * Derivations over a normalized alignment row: the bipolar axis, the lead, and
 * the status ladder. All pure; nothing here is stored.
 */
import {
  ALIGNMENT_GATES,
  joinGateForPoleCount,
  type AlignmentEra,
  type AlignmentPoleId,
} from "@/lib/constants/alignmentEras";
import { roundToShareGrid, type AlignmentShares } from "./normalize";

export type AlignmentStatus =
  "player" | "locked" | "loyal" | "defection-risk" | "eligible" | "non-aligned" | "contested";

/** Poles present in a row, largest share first. */
function ranked(shares: AlignmentShares): { id: AlignmentPoleId; value: number }[] {
  return (Object.entries(shares.shares) as [AlignmentPoleId, number][])
    .map(([id, value]) => ({ id, value }))
    .sort((a, b) => b.value - a.value);
}

/**
 * The design's -100..+100 scalar, for two-pole eras only. The sign comes from
 * `era.axisPositivePoleId` — NOT from `era.poles` ordering, which would invert
 * it silently if the list were ever reordered.
 */
export function axisFor(shares: AlignmentShares, era: AlignmentEra): number | null {
  const positive = era.axisPositivePoleId;
  if (!positive) return null;
  const present = Object.keys(shares.shares) as AlignmentPoleId[];
  if (present.length !== 2) return null;
  const other = present.find((p) => p !== positive);
  if (!other) return null;
  return (shares.shares[positive] ?? 0) - (shares.shares[other] ?? 0);
}

/**
 * The gap between the leading pole and the runner-up. This — not the top share
 * — is what the gates compare against: it is the correct generalization of the
 * design's `Math.abs(alignment)` to three and four poles.
 */
export function leadFor(shares: AlignmentShares): number {
  const order = ranked(shares);
  if (order.length === 0) return 0;
  // Snapped to the tenth grid: this is a difference of two tenth-valued shares,
  // so the true answer is a whole number of tenths, but the subtraction leaves
  // binary dust that the ledger would otherwise print verbatim.
  // Storage grid, not the display one: this number feeds the join, leave and
  // locked gates, and rounding it to a tenth first would move a boundary.
  return roundToShareGrid((order[0]?.value ?? 0) - (order[1]?.value ?? 0));
}

export interface StatusInput {
  shares: AlignmentShares;
  poleCount: number;
  isPlayer: boolean;
  /** Member of any org channelling to the leading pole. */
  isMember: boolean;
}

export interface StatusResult {
  status: AlignmentStatus;
  lead: number;
  topPoleId: AlignmentPoleId | null;
}

/**
 * First match wins. Ordering matters: Locked outranks Loyal so an immovable
 * member reads as locked, and Defection risk outranks Eligible so a member
 * below the gate is never mistaken for a candidate.
 *
 * Deliberately no "Leaning" band — the design's own ladder never consumes the
 * lean gate, and adding it would squeeze Contested into the 20–25 sliver.
 */
export function statusFor(input: StatusInput): StatusResult {
  const order = ranked(input.shares);
  const topPoleId = order[0]?.id ?? null;
  const lead = leadFor(input.shares);
  const joinGate = joinGateForPoleCount(input.poleCount);

  const status: AlignmentStatus = input.isPlayer
    ? "player"
    : lead >= ALIGNMENT_GATES.locked
      ? "locked"
      : input.isMember && lead >= joinGate
        ? "loyal"
        : input.isMember
          ? "defection-risk"
          : lead >= joinGate
            ? "eligible"
            : lead <= ALIGNMENT_GATES.nonAligned
              ? "non-aligned"
              : "contested";

  return { status, lead, topPoleId };
}
