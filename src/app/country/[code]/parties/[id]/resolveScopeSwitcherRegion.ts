import type { PartyHubScope } from "./PartyHubPage";

/**
 * Pick the region target for the National ↔ Region scope switcher.
 * 1. Viewer's home region when known (same party).
 * 2. Current region on state routes.
 * 3. First linked state from national (state-party rows or member home states).
 */
export function resolveScopeSwitcherRegionId(
  scope: PartyHubScope,
  partyId: string,
  userHomeState: string | undefined,
  userPartyId: string | undefined,
  linkedStateIds: string[]
): string | null {
  if (userHomeState && userPartyId === partyId) {
    return userHomeState.toUpperCase();
  }
  if (scope.kind === "state") {
    return scope.regionId.toUpperCase();
  }
  if (linkedStateIds.length > 0) {
    return linkedStateIds[0].toUpperCase();
  }
  return null;
}
