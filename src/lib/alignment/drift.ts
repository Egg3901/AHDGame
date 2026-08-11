/**
 * Alignment drift — the tide.
 *
 * Bounded background movement derived from a nation's own circumstances, small
 * enough that a deliberate influence play always outweighs it. Plays are the
 * rudder; this is the current they steer against.
 */
import {
  ALIGNMENT_GATES,
  PER_NATION_TURN_CAP,
  type AlignmentPoleId,
} from "@/lib/constants/alignmentEras";
import { normalizeShares, type AlignmentShares } from "./normalize";
import { leadFor } from "./project";

/**
 * A nation sitting in the non-aligned band absorbs movement at half rate.
 * Genuinely uncommitted countries are hard to move, which is what makes them
 * contested rather than merely undecided.
 */
export const NON_ALIGNED_RESISTANCE = 0.5;

export interface DriftInput {
  shares: AlignmentShares;
  poles: readonly AlignmentPoleId[];
  /** Pull toward each pole this turn, before modifiers. Negative pushes away. */
  pull: Partial<Record<AlignmentPoleId, number>>;
  /**
   * Ceiling on total movement. Defaults to {@link PER_NATION_TURN_CAP}; a nation
   * with an open crisis is passed the higher {@link CRISIS_TURN_CAP}.
   */
  cap?: number;
}

export function computeDrift(input: DriftInput): AlignmentShares {
  const { shares, poles, pull } = input;
  const lead = leadFor(shares);

  // Locked: past the gate a nation is immovable by drift. Only a deliberate
  // play (plan 5) can shift one, and only by unseating it first.
  if (lead >= ALIGNMENT_GATES.locked) return shares;

  const resistance = lead <= ALIGNMENT_GATES.nonAligned ? NON_ALIGNED_RESISTANCE : 1;

  // Opposing pushes cancel BEFORE the ceiling applies, so only the margin
  // survives. Two blocs shoving equally hard leave the nation where it was —
  // which is what a stalemate should look like — while allies on the same pole
  // simply add up, because their pulls share a key and never oppose.
  //
  // Netting before the cap rather than after is the whole point: capping the
  // raw churn would let a rival's spending eat into ground you had already paid
  // for, and would let two allied organisations cannibalise each other.
  const net: Partial<Record<AlignmentPoleId, number>> = {};
  for (const pole of poles) {
    const own = pull[pole] ?? 0;
    if (own <= 0) {
      // A pole being eroded loses ground regardless of who is pushing elsewhere.
      net[pole] = own;
      continue;
    }
    const strongestRival = poles.reduce(
      (best, other) => (other === pole ? best : Math.max(best, pull[other] ?? 0)),
      0
    );
    net[pole] = Math.max(0, own - strongestRival);
  }

  // Scale what survives as one vector, so the ceiling bounds the nation's whole
  // turn rather than each pole separately.
  const requested = poles.reduce((sum, p) => sum + Math.abs(net[p] ?? 0), 0) * resistance;
  if (requested === 0) return shares;
  const cap = input.cap ?? PER_NATION_TURN_CAP;
  const scale = requested > cap ? cap / requested : 1;

  const next: Partial<Record<AlignmentPoleId, number>> = {};
  for (const pole of poles) {
    const delta = (net[pole] ?? 0) * resistance * scale;
    next[pole] = (shares.shares[pole] ?? 0) + delta;
  }

  // normalizeShares recomputes the uncommitted remainder from what is left, so
  // a gain comes out of the uncommitted pool first and only bites a rival pole
  // once that pool is exhausted and the total would exceed 100.
  return normalizeShares(next, poles);
}

/**
 * Passive pull toward a bloc, per turn, per channel org a nation belongs to.
 *
 * Roughly one share point every 24 turns — half a game year — before the
 * channel's own weight. Membership used to pull 2 points a TURN, which carried a
 * member from the join gate to locked inside half a game year and made simply
 * belonging worth more than any amount of spending: the current outran the
 * rudder it was meant to be steered against. A single play at
 * {@link PER_NATION_TURN_CAP} is now worth more than two game YEARS of drift.
 *
 * Expressible only because shares store to a hundredth. On the old tenth grid
 * this rounds to zero every turn, and the tide would have been inert while
 * looking implemented.
 */
export const MEMBERSHIP_PULL_PER_TURN = 0.04;

/**
 * Highest share membership alone will carry a nation to.
 *
 * Comfortably clear of `LEAVE_SHARE` and of the join gate, so drift keeps an
 * alliance's members securely in it — and well short of the locked gate at 85,
 * so it can never make one immovable. Anything past this has to be bought: a
 * bloc's grip becomes total only because someone worked at it, never because
 * enough turns went by.
 */
export const MEMBERSHIP_PULL_CEILING = 67;

/**
 * This turn's passive pull from one membership, in share points.
 *
 * The ceiling clamps the PASSIVE component only, and only upward. A nation
 * carried past it by deliberate plays keeps every point it was pushed to; drift
 * simply stops adding, and plays may still carry it higher.
 */
export function membershipPullForTurn(params: {
  /** The channel's weight — a half-weight channel pulls half as hard. */
  weight: number;
  /** The member's CURRENT share in that pole, for the ceiling. */
  currentShare: number;
}): number {
  const { weight, currentShare } = params;
  if (weight <= 0) return 0;
  const due = MEMBERSHIP_PULL_PER_TURN * weight;
  return Math.max(0, Math.min(due, MEMBERSHIP_PULL_CEILING - currentShare));
}
