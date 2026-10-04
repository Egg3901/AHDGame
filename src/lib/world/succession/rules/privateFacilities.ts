import type { CountryId } from "@/lib/constants/countries";
import type { PlayableResidence } from "./residency";
import type { SuccessorTerritory } from "./territory";

export interface PrivateSuccessionFirm {
  corporationId: string;
  countryId: CountryId;
  headquartersState: string;
  headquartersRegionId: string;
  facilities: readonly {
    sectorId: string;
    regionId: string;
    /** Existing paid book basis in the shared accounting unit. */
    bookValueAnchor: number;
  }[];
}

export interface PrivateFacilityClaim {
  claimId: string;
  corporationId: string;
  sectorId: string;
  debtorEntityId: string;
  /** Null until the owner selects a playable headquarters. */
  creditorCountryId: CountryId | null;
  amountAnchor: number;
}

export interface PrivateFirmSuccessionPlan {
  corporationId: string;
  status: "continuing" | "pending-headquarters" | "relocating";
  destination?: PlayableResidence;
  claims: PrivateFacilityClaim[];
}

/** Preserve each private firm and its owners. Facilities assigned to a
 * background successor become claims at their existing book basis. A missing
 * headquarters choice stays pending; it never silently winds down the firm. */
export function planPrivateFirmSuccession(input: {
  settlementId: string;
  sourceCountryId: CountryId;
  territories: readonly SuccessorTerritory[];
  firms: readonly PrivateSuccessionFirm[];
  playableHeadquarters: readonly PlayableResidence[];
  choices: Readonly<Record<string, PlayableResidence>>;
}): PrivateFirmSuccessionPlan[] {
  if (!input.settlementId.trim() || !input.sourceCountryId)
    throw new Error("Private firm settlement needs an identity and source country");
  const owner = new Map<string, string>();
  for (const territory of input.territories) {
    for (const regionId of territory.regionIds) {
      if (!regionId || owner.has(regionId))
        throw new Error("Private firm settlement has duplicate or empty regions");
      owner.set(regionId, territory.entityId);
    }
  }
  const destinations = new Set(
    input.playableHeadquarters.map((place) => `${place.countryId}:${place.stateId}`)
  );
  if (
    !owner.size ||
    destinations.size !== input.playableHeadquarters.length ||
    input.playableHeadquarters.some((place) => !place.countryId || !place.stateId)
  )
    throw new Error("Private firm settlement has invalid territory or destinations");

  const seenFirms = new Set<string>();
  const seenSectors = new Set<string>();
  const eligibleChoices = new Set<string>();
  const plans = input.firms.map((firm) => {
    if (
      !firm.corporationId ||
      seenFirms.has(firm.corporationId) ||
      firm.countryId !== input.sourceCountryId ||
      !owner.has(firm.headquartersRegionId)
    )
      throw new Error("Private firm has invalid identity or headquarters");
    seenFirms.add(firm.corporationId);
    const headquartersSuccessor = owner.get(firm.headquartersRegionId);
    const affected = headquartersSuccessor !== input.sourceCountryId;
    if (affected) eligibleChoices.add(firm.corporationId);
    const choice = input.choices[firm.corporationId];
    if (choice && (!affected || !destinations.has(`${choice.countryId}:${choice.stateId}`)))
      throw new Error("Private firm chose an unavailable headquarters");
    const claims = firm.facilities.flatMap((facility) => {
      if (
        !facility.sectorId ||
        seenSectors.has(facility.sectorId) ||
        !owner.has(facility.regionId) ||
        !Number.isFinite(facility.bookValueAnchor) ||
        facility.bookValueAnchor < 0
      )
        throw new Error("Private facility has invalid identity, region or book value");
      seenSectors.add(facility.sectorId);
      const successor = owner.get(facility.regionId)!;
      if (successor === input.sourceCountryId) return [];
      return [
        {
          claimId: `${input.settlementId}:facility:${facility.sectorId}`,
          corporationId: firm.corporationId,
          sectorId: facility.sectorId,
          debtorEntityId: successor,
          creditorCountryId: choice?.countryId ?? (affected ? null : firm.countryId),
          amountAnchor: facility.bookValueAnchor,
        },
      ];
    });
    return {
      corporationId: firm.corporationId,
      status: affected ? (choice ? "relocating" : "pending-headquarters") : "continuing",
      ...(choice ? { destination: choice } : {}),
      claims: claims.sort((a, b) => a.claimId.localeCompare(b.claimId)),
    } satisfies PrivateFirmSuccessionPlan;
  });
  if (Object.keys(input.choices).some((id) => !eligibleChoices.has(id)))
    throw new Error("Headquarters choice does not belong to an affected firm");
  return plans.sort((a, b) => a.corporationId.localeCompare(b.corporationId));
}
