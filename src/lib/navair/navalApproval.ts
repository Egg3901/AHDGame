import { clamp, alive } from "./engineCore";
import type { NavairUnit } from "./types";

/**
 * What the naval war is worth politically.
 *
 * A navy is the most visible and most expensive thing a country owns, and losing it is a
 * public event in a way that losing an infantry brigade is not. Without this, a government
 * can have its fleet destroyed and its trade strangled and pay nothing at home, which
 * makes the naval war a private number between the admiralty and the engine.
 */

/**
 * Bound on the naval contribution to the war approval block.
 *
 * Set to 1, matching `ALLIANCE_CONTRIBUTION_BOUND` rather than the larger
 * `WAR_EFFORT_BOUND` of 2. Losing the fleet should hurt, but the ground war is still the
 * war: a country winning on land while losing at sea must not be dragged under by this
 * term alone.
 */
export const NAVAL_APPROVAL_BOUND = 1;

/**
 * Fleet condition below which the public notices, 0..100.
 *
 * Above this a navy is taking losses in the ordinary course of a war and nobody at home
 * is alarmed. Below it, ships are visibly not coming back.
 */
export const FLEET_ALARM_THRESHOLD = 70;

export interface NavalStanding {
  /** Mean integrity across the country's fleet, 0..100. 100 when it has no navy. */
  condition: number;
  /** Hulls the country has that are still combat effective. */
  effective: number;
  /** Hulls reduced to combat ineffectiveness. */
  crippled: number;
}

/**
 * A country's fleet condition.
 *
 * Weighted by nothing: a destroyer counts the same as a carrier. That is deliberate for a
 * POLITICAL signal, because the public reaction to "we are losing ships" does not scale
 * with displacement, and weighting by combat value would make the loss of one carrier
 * read as the loss of the whole navy.
 */
export function navalStanding(units: readonly NavairUnit[]): NavalStanding {
  const fleet = units.filter((u) => u.domain === "naval");
  if (!fleet.length) return { condition: 100, effective: 0, crippled: 0 };

  let total = 0;
  let effective = 0;
  let crippled = 0;
  for (const u of fleet) {
    total += clamp(u.integrity ?? 100, 0, 100);
    if (alive(u)) effective++;
    else crippled++;
  }
  return { condition: total / fleet.length, effective, crippled };
}

/**
 * The war approval effect of the naval situation, as a `WarPart` effect value.
 *
 * Returns 0 for a country with no navy, so a landlocked power is never rewarded or
 * punished for a fleet it does not have. Negative only: this term is a cost, never a
 * bonus. Holding the sea is already worth something through the battles it wins and the
 * trade it protects, and paying approval for it as well would double-count.
 */
export function navalApprovalEffect(units: readonly NavairUnit[]): number {
  const fleet = units.filter((u) => u.domain === "naval");
  if (!fleet.length) return 0;

  const { condition } = navalStanding(units);
  if (condition >= FLEET_ALARM_THRESHOLD) return 0;

  // Linear from nothing at the alarm threshold to the full bound at a destroyed fleet.
  const severity = (FLEET_ALARM_THRESHOLD - condition) / FLEET_ALARM_THRESHOLD;
  return -clamp(severity, 0, 1) * NAVAL_APPROVAL_BOUND;
}

/** Player-facing label for the breakdown row, so a government can see why. */
export function navalApprovalLabel(units: readonly NavairUnit[]): string {
  const { crippled } = navalStanding(units);
  return crippled > 0 ? "Naval losses" : "Fleet condition";
}
