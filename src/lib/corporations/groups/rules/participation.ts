/**
 * Group supply participation is receiving-only, voluntary for players and effective next turn.
 * Consent applies only while the same CEO operates a member of the same group.
 */
import type { GroupReceivingPreference, GroupSupplyPolicy } from "../managementTypes";

export interface GroupOperator {
  ceoTenureKey?: string;
  id: string;
  rootId: string;
  ceoId: string;
  userId?: string;
  operator: "npp" | "player";
  vacant: boolean;
  stateOwned: boolean;
}
export function effectiveGroupReceiving(
  member: GroupOperator,
  preference: GroupReceivingPreference | undefined,
  turn: number
): boolean {
  if (member.vacant || member.stateOwned) return false;
  if (member.operator === "npp") return true;
  if (
    !preference ||
    preference.rootId !== member.rootId ||
    preference.ceoId !== member.ceoId ||
    preference.ceoTenureKey !== member.ceoTenureKey ||
    preference.userId !== member.userId
  )
    return false;
  return turn >= preference.effectiveTurn ? preference.enabled : preference.previousEnabled;
}
export function scheduleGroupReceiving(
  member: GroupOperator,
  preference: GroupReceivingPreference | undefined,
  enabled: boolean,
  turn: number
): GroupReceivingPreference {
  return {
    rootId: member.rootId,
    ceoTenureKey: member.ceoTenureKey,
    ceoId: member.ceoId,
    userId: member.userId ?? "",
    enabled,
    effectiveTurn: turn + 1,
    previousEnabled: effectiveGroupReceiving(member, preference, turn),
  };
}
export function canReceiveGroupSupply(
  member: GroupOperator,
  preference: GroupReceivingPreference | undefined,
  policy: GroupSupplyPolicy,
  turn: number
): boolean {
  return policy === "members" && effectiveGroupReceiving(member, preference, turn);
}
