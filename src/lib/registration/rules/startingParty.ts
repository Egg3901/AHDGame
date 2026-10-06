/** Starting parties must be open and within reach of the chosen home; admins bypass these gates. */
export function isStartingPartyEligible(
  party: { membershipMode?: string; frontierRegions?: string[] | null },
  homeState: string,
  isAdmin: boolean
): boolean {
  return (
    isAdmin ||
    Boolean(
      homeState &&
      party.membershipMode !== "approval" &&
      (party.frontierRegions === null || party.frontierRegions?.includes(homeState))
    )
  );
}
