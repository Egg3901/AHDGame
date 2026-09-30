/**
 * Crisis decisions belong to their country's eligible office or party leader.
 * Cabinet portfolios and regional seats narrow authored negotiations; public
 * collective appeals remain open to foreign contributors.
 */
import type { Crisis, CrisisDecisionNode } from "@/lib/db/types/crisis";

export function crisisDecisionRegion(character: {
  currentOffice?: { type?: string; state?: string } | null;
  homeState?: string;
}): string | undefined {
  const office = character.currentOffice;
  return office?.type === "governor" || office?.type === "ministerPresident"
    ? office.state
    : character.homeState;
}

export function canRespondToCrisis(
  crisis: Pick<Crisis, "scope" | "countryIds" | "regionIds">,
  node: CrisisDecisionNode,
  countryId?: string,
  regionId?: string
): boolean {
  if (node.type === "collective" || node.type === "aid" || crisis.scope === "global") return true;
  if (crisis.scope === "country") return !!countryId && crisis.countryIds.includes(countryId);
  return !!regionId && crisis.regionIds.includes(regionId);
}

export function canCharacterInteract(
  node: CrisisDecisionNode,
  characterRoles: string[],
  countryId?: string,
  regionId?: string
): boolean {
  if (
    node.requiredCountryIds?.length &&
    (!countryId || !node.requiredCountryIds.includes(countryId))
  )
    return false;
  if (node.requiredRegionIds?.length && (!regionId || !node.requiredRegionIds.includes(regionId)))
    return false;
  return node.requiredRoles.some((role) => {
    if (role === "any") return true;
    if (!characterRoles.includes(role)) return false;
    if (role === "partyLeader" && node.requiredPartyAbbreviations?.length) {
      return node.requiredPartyAbbreviations.some((party) =>
        characterRoles.includes(`partyLeader:${party}`)
      );
    }
    if (role === "cabinet" && node.requiredCabinetPositionIds?.length) {
      return node.requiredCabinetPositionIds.some((position) =>
        characterRoles.includes(`cabinet:${position}`)
      );
    }
    return true;
  });
}
