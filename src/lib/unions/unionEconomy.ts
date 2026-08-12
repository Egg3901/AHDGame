/**
 * Phase 8 — Player-run unions (`labourSystemMode >= "full"`), pure economy
 * logic. A union has ONE leader (`Union.ownerId`), a treasury, and a
 * `membershipPressure` (0-100) that biases `unionizationDriftTarget()` for
 * every `CorporateSector` matching its (countryId, sectorType) — see
 * `src/lib/labour/unionization.ts`. Unowned unions leave Phase 5's NPC drift
 * completely unchanged ("conversion not reinvention," per the design doc).
 */

import type { CorporateSector, Union } from "@/lib/db/types";

/** Action points one organize drive costs the character who runs it. */
export const ORGANIZE_ACTION_COST = 5;
/** Union strength one organize drive adds, both to the union pool and to the organizer's own banked total. */
export const ORGANIZE_STRENGTH_GAIN = 10;
/** Union strength required before organizers can vote for a president. */
export const LEADERSHIP_ELECTION_MIN_STRENGTH = 100;
/**
 * Fraction of union strength lost every turn, applied to the union pool AND to
 * each organizer's banked strength. Organizing is a treadmill: a union that
 * stops recruiting bleeds power, and an organizer who stops showing up loses
 * their say over who runs it.
 */
export const UNION_STRENGTH_DECAY_PER_TURN = 0.005;

/** Strength as stored, treating a missing field on pre-existing documents as zero. */
export function unionStrength(union: Pick<Union, "strength">): number {
  const s = union.strength;
  return typeof s === "number" && Number.isFinite(s) && s > 0 ? s : 0;
}

/** Membership pressure required before organizers can vote for a president. */
export const LEADERSHIP_ELECTION_MIN_PRESSURE = 25;

/**
 * True when organizers can contest the presidency. Mirrors corporation CEO
 * votes: the race stays open once the union is strong enough, whether or not
 * a president already sits. A seated NPP or player can be displaced by a
 * challenger who out-organizes them and accepts the offer.
 */
export function isUnionLeadershipElectionOpen(union: Pick<Union, "strength">): boolean {
  return unionStrength(union) >= LEADERSHIP_ELECTION_MIN_STRENGTH;
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

export type UnionStrikeSector = Pick<
  CorporateSector,
  "_id" | "unionization" | "strikeStartedAtTurn" | "strikeCooldownUntilTurn"
>;

export type UnionStrikeBlockReason =
  "underorganized" | "already_striking" | "sector_cooldown" | "collective_agreement";

/**
 * Explain why one local cannot join a union-called strike this turn.
 * Returning a reason instead of a boolean lets the command and every UI use
 * the same rules without separately reconstructing them.
 */
export function unionStrikeBlockReason(
  sector: UnionStrikeSector,
  currentTurn: number,
  noStrikeProtectedSectorIds: ReadonlySet<string> = new Set()
): UnionStrikeBlockReason | null {
  if (noStrikeProtectedSectorIds.has(sector._id.toString())) return "collective_agreement";
  if ((sector.unionization ?? 0) < STRIKE_CALL_MIN_UNIONIZATION) return "underorganized";
  if (sector.strikeStartedAtTurn != null) return "already_striking";
  if (sector.strikeCooldownUntilTurn != null && sector.strikeCooldownUntilTurn > currentTurn) {
    return "sector_cooldown";
  }
  return null;
}

export interface UnionStrikePreview<T extends UnionStrikeSector = UnionStrikeSector> {
  eligibleSectors: T[];
  cost: number;
  unionCooldownTurnsRemaining: number;
  blocked: Record<UnionStrikeBlockReason, number>;
}

/** Server-authoritative strike preview shared by the dashboard and command. */
export function buildUnionStrikePreview<T extends UnionStrikeSector>(
  union: Pick<Union, "lastCalledStrikeTurn">,
  sectors: T[],
  currentTurn: number,
  noStrikeProtectedSectorIds: ReadonlySet<string> = new Set()
): UnionStrikePreview<T> {
  const blocked: UnionStrikePreview<T>["blocked"] = {
    underorganized: 0,
    already_striking: 0,
    sector_cooldown: 0,
    collective_agreement: 0,
  };
  const eligibleSectors: T[] = [];
  for (const sector of sectors) {
    const reason = unionStrikeBlockReason(sector, currentTurn, noStrikeProtectedSectorIds);
    if (reason) blocked[reason]++;
    else eligibleSectors.push(sector);
  }

  const availableTurn =
    union.lastCalledStrikeTurn == null
      ? currentTurn
      : union.lastCalledStrikeTurn + UNION_STRIKE_CALL_COOLDOWN_TURNS;

  return {
    eligibleSectors,
    cost: strikeCallCost(eligibleSectors.length),
    unionCooldownTurnsRemaining: Math.max(0, availableTurn - currentTurn),
    blocked,
  };
}
