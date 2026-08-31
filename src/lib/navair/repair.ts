import * as R from "./config";
import { clamp } from "./engineCore";
import { WITHDRAW_INTEGRITY } from "./missions";
import type { BasingKey } from "./config";
import type { NavairUnit } from "./types";

/**
 * Mending hulls and airframes.
 *
 * The third leg of a stool that has only ever had two. A fight costs a formation
 * personnel, readiness and integrity: `applyReinforcement` refills the first from the
 * manpower pool, `READINESS_REGEN` the second, and until now nothing at all refilled the
 * third. `engagement.ts` is the only writer of `integrity` in the codebase and it only
 * subtracts, so a hull crippled once was combat ineffective for the rest of the game.
 *
 * The rates are NOT new. `REPAIR` has sat calibrated and completely unread in `config.ts`
 * since the subsystem was written, with a docblock explaining precisely what its absence
 * costs: "a blockade that got shot at once was on a countdown and the only unbeaten
 * strategy was to never contest anything." This module is the reader it never had.
 *
 * What IS new is the ceiling ladder. Free repair alone would make the arsenal tier
 * pointless, because a fleet could simply wait anywhere and come back to full strength.
 * Capping free repair by where a formation actually is turns the last stretch into a
 * choice: rotate home, or pay for materiel and stay on station.
 */

/**
 * How far free repair can take a formation, by where it is resting.
 *
 * A home yard restores a hull completely. An allied harbour gets most of the way, because
 * basing rights are worth something but not as much as your own dockyard. Anything else
 * caps well short: a fleet at sea can patch itself up but cannot refit itself.
 */
export const FREE_REPAIR_CEILING = {
  home: 100,
  allied: 90,
  station: 80,
} as const;

/**
 * How much of the repair rate a formation's supply earns it, 0..1.
 *
 * A ramp rather than a threshold, and deliberately so: the config records that a hard
 * gate at 60 left the Arctic station one point short of qualifying, so a fleet blockading
 * Murmansk could never mend at all and every game plateaued with both navies wrecked.
 * Scaling also gives Airlift a real job, since lifting a station's supply raises what
 * every hull there recovers.
 *
 * Missing supply reads as full, matching `supplyMult`'s treatment of the same field.
 */
export function supplyScale(supply: number | undefined): number {
  const s = supply ?? 100;
  const span = 100 - R.REPAIR.minSupply;
  if (span <= 0) return 1;
  return clamp((s - R.REPAIR.minSupply) / span, 0, 1);
}

/**
 * Is this formation actually in a yard rather than doing a job?
 *
 * `PORT` for a hull and `STANDDOWN` for a wing, exactly as the `inPort` rate's own
 * comment describes. A formation with no orders is NOT resting: it is unordered, and the
 * standing-mission pass gives it a posture on this same tick.
 */
export function isResting(unit: NavairUnit): boolean {
  return unit.mission === "PORT" || unit.mission === "STANDDOWN";
}

/**
 * Is this formation being pulled back to home water to mend?
 *
 * `WITHDRAW_INTEGRITY` is the same threshold `defaultNavalMission` already uses for "save
 * the ship", so this is one doctrine rather than a second one invented here. A commander
 * who deliberately stationed a damaged formation somewhere keeps it there.
 *
 * Lives here rather than inside the turn pass because the command page has to reach the
 * same answer. A withdrawn formation mends at the in-port rate against the home ceiling
 * whatever its standing order still says, and a page reading the stored mission instead
 * would tell a commander 5% a turn toward 80% while the engine delivered 12 toward 100.
 */
export function isWithdrawing(unit: NavairUnit): boolean {
  return (unit.integrity ?? 100) < WITHDRAW_INTEGRITY && unit.stationSetByPlayer !== true;
}

/**
 * Integrity recovered this turn, before the ceiling is applied.
 *
 * Zero for a formation that fought this turn. You mend between engagements, not during
 * one, which is what makes disengaging a real decision rather than a free one.
 */
export function repairRate(unit: NavairUnit, resting: boolean): number {
  if (unit.engaged) return 0;
  const base = resting ? R.REPAIR.inPort : R.REPAIR.onStation;
  return base * supplyScale(unit.supply);
}

/** The ceiling free repair may carry a formation to, given where it is resting. */
export function freeRepairCeiling(basing: BasingKey, resting: boolean): number {
  if (!resting) return FREE_REPAIR_CEILING.station;
  if (basing === "home") return FREE_REPAIR_CEILING.home;
  if (basing === "allied") return FREE_REPAIR_CEILING.allied;
  return FREE_REPAIR_CEILING.station;
}

/**
 * What this formation's integrity should be after a turn of free repair.
 *
 * Only ever raises. A formation already above its ceiling keeps what it has, so ordering
 * a fresh hull onto station does not corrode it; the ceiling limits what mending can
 * reach, not what a formation is allowed to be.
 */
export function repairedIntegrity(unit: NavairUnit, basing: BasingKey): number {
  const current = unit.integrity ?? 100;
  const resting = isResting(unit);
  const ceiling = freeRepairCeiling(basing, resting);
  if (current >= ceiling) return current;
  return Math.min(ceiling, current + repairRate(unit, resting));
}
