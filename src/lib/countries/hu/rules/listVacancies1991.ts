/**
 * A vacant Hungarian list mandate stays with its certified party and list.
 * The party designates an available originally filed person; former deputies
 * and current mandate holders cannot acquire another mandate through this path.
 */
import type { Hu1991Mandate, Hu1991Nominations } from "./mandates1991";

export interface Hu1991ListReplacement {
  slotPersonId: string;
  personId: string;
}
export interface Hu1991ListVacancy {
  slotPersonId: string;
  previousPersonId: string;
  mandate: Hu1991Mandate;
  eligiblePersonIds: string[];
}

export function findHu1991ListVacancies(input: {
  nominations: Hu1991Nominations;
  certifiedMandates: readonly Hu1991Mandate[];
  replacements: readonly Hu1991ListReplacement[];
  heldPersonIds: ReadonlySet<string>;
  heldPlayerOwnerIds: ReadonlySet<string>;
  unavailablePersonIds: ReadonlySet<string>;
}): Hu1991ListVacancy[] {
  const people = new Map(input.nominations.people.map((person) => [person.id, person]));
  const consumed = new Set(input.certifiedMandates.map((row) => row.personId));
  for (const replacement of input.replacements) consumed.add(replacement.personId);
  const latest = new Map(input.replacements.map((row) => [row.slotPersonId, row.personId]));
  return input.certifiedMandates.flatMap((mandate) => {
    if (mandate.tier === "constituency") return [];
    const previousPersonId = latest.get(mandate.personId) ?? mandate.personId;
    if (input.heldPersonIds.has(previousPersonId)) return [];
    const list =
      mandate.tier === "national"
        ? input.nominations.national.find((row) => row.partyId === mandate.partyId)
        : input.nominations.territorial
            .find((row) => row.id === mandate.districtId)
            ?.lists.find((row) => row.partyId === mandate.partyId);
    if (!list) throw new Error("Certified Hungarian mandate has no original party list");
    const eligiblePersonIds = list.candidateIds.filter((id) => {
      const person = people.get(id);
      return (
        person &&
        person.partyId === mandate.partyId &&
        !consumed.has(id) &&
        !input.heldPersonIds.has(id) &&
        !input.unavailablePersonIds.has(id) &&
        (person.isNpc || !input.heldPlayerOwnerIds.has(person.ownerId))
      );
    });
    return [{ slotPersonId: mandate.personId, previousPersonId, mandate, eligiblePersonIds }];
  });
}

/** Party choice is explicit. Exhaustion leaves the mandate vacant. */
export function designateHu1991ListReplacement(
  vacancy: Hu1991ListVacancy,
  nominations: Hu1991Nominations,
  personId: string
): Hu1991Mandate {
  if (!vacancy.eligiblePersonIds.includes(personId))
    throw new Error("Hungarian replacement must be an available person on the original list");
  const person = nominations.people.find((row) => row.id === personId);
  if (!person || person.partyId !== vacancy.mandate.partyId)
    throw new Error("Hungarian replacement changes its certified party");
  return {
    ...vacancy.mandate,
    personId,
    candidateId: person.candidateId,
    ownerId: person.ownerId,
    isNpc: person.isNpc,
    // Keep this physical mandate's regional capacity and original term.
    regionId: vacancy.mandate.regionId,
  };
}
