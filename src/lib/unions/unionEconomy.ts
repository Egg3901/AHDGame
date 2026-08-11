/**
 * Phase 8 — Player-run unions (`labourSystemMode >= "full"`), pure economy
 * logic. A union has ONE leader (`Union.ownerId`), a treasury, and a
 * `membershipPressure` (0-100) that biases `unionizationDriftTarget()` for
 * every `CorporateSector` matching its (countryId, sectorType) — see
 * `src/lib/labour/unionization.ts`. Unowned unions leave Phase 5's NPC drift
 * completely unchanged ("conversion not reinvention," per the design doc).
 */

import type { Union } from "@/lib/db/types";

/** Personal-funds cost (₳-anchor) of one pre-leadership organize drive. */
export const ORGANIZE_PERSONAL_COST = 25_000;
/** Membership pressure required before organizers can vote for a president. */
export const LEADERSHIP_ELECTION_MIN_PRESSURE = 25;

/** True when an unowned union has been organized enough to open a leadership vote. */
export function isUnionLeadershipElectionOpen(
  union: Pick<Union, "ownerId" | "membershipPressure">
): boolean {
  return union.ownerId == null && union.membershipPressure >= LEADERSHIP_ELECTION_MIN_PRESSURE;
}

/** Treasury cost of one recruitment-drive action. */
export const RECRUIT_COST = 500;
/** Membership-pressure gain at pressure=0 from one recruitment-drive action. */
export const RECRUIT_PRESSURE_GAIN_AT_ZERO = 8;

/**
 * Diminishing-returns gain from a recruitment drive: full gain at
 * membershipPressure=0, tapering to 0 at membershipPressure=100 — organizing
 * an unorganized industry is easy, squeezing out the last few points isn't.
 */
export function recruitPressureGain(currentPressure: number): number {
  const p = Math.max(0, Math.min(100, Number.isFinite(currentPressure) ? currentPressure : 0));
  return RECRUIT_PRESSURE_GAIN_AT_ZERO * (1 - p / 100);
}

/** New membershipPressure after a recruitment drive (clamped 0-100). */
export function applyRecruit(currentPressure: number): number {
  const p = Math.max(0, Math.min(100, Number.isFinite(currentPressure) ? currentPressure : 0));
  return Math.min(100, p + recruitPressureGain(p));
}

/** Per-turn membershipPressure decay toward 0 (baseline "no active organizing") absent a recruitment drive that turn. */
export const MEMBERSHIP_PRESSURE_DECAY_PER_TURN = 0.5;

/** Steps membershipPressure down toward 0 by at most `MEMBERSHIP_PRESSURE_DECAY_PER_TURN`, clamped ≥0. */
export function decayMembershipPressure(currentPressure: number): number {
  const p = Math.max(0, Math.min(100, Number.isFinite(currentPressure) ? currentPressure : 0));
  return Math.max(0, p - MEMBERSHIP_PRESSURE_DECAY_PER_TURN);
}

/** Treasury trickle per turn per point of membershipPressure — the "dues" analog (no per-member accounting). */
export const DUES_TRICKLE_RATE_PER_PRESSURE_POINT = 2;

/** Treasury gained this turn from dues, given the current membershipPressure. */
export function duesTrickle(membershipPressure: number): number {
  const p = Math.max(
    0,
    Math.min(100, Number.isFinite(membershipPressure) ? membershipPressure : 0)
  );
  return p * DUES_TRICKLE_RATE_PER_PRESSURE_POINT;
}

/** A union can only force a strike in a sector whose organic unionization is at least this — can't manufacture a strike out of nothing. */
export const STRIKE_CALL_MIN_UNIONIZATION = 30;
/** Treasury cost per matched sector when a union calls a strike. */
/**
 * Treasury cost per matched sector when a union calls a strike.
 *
 * Lowered from 2000 to 400 because the old figure made striking arithmetically
 * unreachable, not merely expensive. Dues accrue at 2 x membershipPressure per
 * turn (~160/turn at the ~80 equilibrium) while recruiting spends 500 whenever
 * affordable, so a treasury oscillates in the low hundreds. Against a cost of
 * 2000 PER SECTOR — tens of thousands in any large country — the branch could
 * never fire: across a full 1000-turn run with 408 led unions and 144 standing
 * wage demands, ZERO strikes were called. The lever existed only on paper.
 *
 * At 400 a determined union that stops recruiting can save for a strike over
 * roughly a dozen turns, which makes it a real choice with a real cost.
 */
export const STRIKE_CALL_COST_PER_SECTOR = 400;
/** Union-level cooldown (turns) between force-called strikes — separate from each sector's own `strikeCooldownUntilTurn`, so a union can't spam every sector every turn. */
export const UNION_STRIKE_CALL_COOLDOWN_TURNS = 8;

/** Total treasury cost to force-call a strike across `sectorCount` matched sectors. */
export function strikeCallCost(sectorCount: number): number {
  return Math.max(0, Math.round(sectorCount)) * STRIKE_CALL_COST_PER_SECTOR;
}
