import type { CountryId } from "@/lib/constants/countries";
import type { SuccessorTerritory } from "./territory";

export interface SuccessionResident {
  characterId: string;
  countryId: CountryId;
  homeState: string;
  /** Top-level federation region resolved from homeState at the live snapshot. */
  homeRegionId: string;
}

export interface PlayableResidence {
  countryId: CountryId;
  stateId: string;
}

export type SuccessionResidencePlan =
  | {
      characterId: string;
      successorEntityId: string;
      status: "pending-choice";
      formerCountryId: CountryId;
      formerHomeState: string;
    }
  | {
      characterId: string;
      successorEntityId: string;
      status: "selected";
      formerCountryId: CountryId;
      formerHomeState: string;
      destination: PlayableResidence;
    };

/** Preserve a resident's character identity when their territory becomes a
 * background country. A selected playable residence changes only their current
 * location; their starting nationality and holdings are settled separately.
 * Missing choices remain explicit instead of being silently assigned. */
export function planSuccessionResidency(input: {
  sourceCountryId: CountryId;
  territories: readonly SuccessorTerritory[];
  residents: readonly SuccessionResident[];
  playableResidences: readonly PlayableResidence[];
  choices: Readonly<Record<string, PlayableResidence>>;
}): SuccessionResidencePlan[] {
  const regionOwner = new Map<string, string>();
  for (const territory of input.territories) {
    for (const regionId of territory.regionIds) {
      if (!regionId || regionOwner.has(regionId))
        throw new Error("Residence planning needs distinct successor regions");
      regionOwner.set(regionId, territory.entityId);
    }
  }
  const allowed = new Set(
    input.playableResidences.map((residence) => `${residence.countryId}:${residence.stateId}`)
  );
  if (
    !input.sourceCountryId ||
    regionOwner.size === 0 ||
    allowed.size !== input.playableResidences.length ||
    input.playableResidences.some((residence) => !residence.countryId || !residence.stateId)
  )
    throw new Error("Residence planning needs valid playable destinations");

  const seen = new Set<string>();
  const affected = new Set<string>();
  const result: SuccessionResidencePlan[] = [];
  for (const resident of input.residents) {
    if (
      !resident.characterId ||
      seen.has(resident.characterId) ||
      resident.countryId !== input.sourceCountryId ||
      !resident.homeState
    )
      throw new Error("Residence planning has an invalid or duplicate source resident");
    seen.add(resident.characterId);
    const successorEntityId = regionOwner.get(resident.homeRegionId);
    if (!successorEntityId)
      throw new Error("A source resident is outside the approved settlement territory");
    if (successorEntityId === input.sourceCountryId) continue;
    affected.add(resident.characterId);
    const choice = input.choices[resident.characterId];
    if (choice && !allowed.has(`${choice.countryId}:${choice.stateId}`))
      throw new Error("A resident chose an unavailable playable destination");
    const common = {
      characterId: resident.characterId,
      successorEntityId,
      formerCountryId: resident.countryId,
      formerHomeState: resident.homeState,
    };
    result.push(
      choice
        ? { ...common, status: "selected", destination: choice }
        : { ...common, status: "pending-choice" }
    );
  }
  if (Object.keys(input.choices).some((id) => !affected.has(id)))
    throw new Error("A residence choice does not belong to an affected resident");
  if (affected.size > 0 && allowed.size === 0)
    throw new Error("Affected residents need at least one playable destination");
  return result.sort((a, b) => a.characterId.localeCompare(b.characterId));
}
