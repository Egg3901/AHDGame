/** Own routes may reclaim local market fill only after a haul succeeds. */
export function ownRouteAvailable(spare: number, localFill: number, ownFirst: boolean): number {
  return Math.max(0, spare) + (ownFirst ? Math.max(0, localFill) : 0);
}
export function reclaimedLocalUnits(dispatch: number, spare: number): number {
  return Math.max(0, dispatch - Math.max(0, spare));
}
