/**
 * Grand Assembly list vacancies pass to the next available original nominee.
 * Direct mandates never pass through a list, players hold one seat, and an
 * exhausted list leaves its original party's mandate vacant.
 */
import { BG_1990_LIST_DISTRICTS } from "../data/foundingDistricts1990";
import {
  validateBgFoundingNominations,
  type BgFoundingNominations,
  type BgFoundingMandate,
} from "./foundingMandates1990";

export interface Bg1991ListReplacement {
  slotId: string;
  personId: string;
}
export interface Bg1991ListPlacement {
  slotId: string;
  previousPersonId: string | null;
  mandate: BgFoundingMandate;
}

export function planBg1991ListReplacements(input: {
  nominations: BgFoundingNominations;
  settled: {
    mandates: readonly BgFoundingMandate[];
    vacancies: readonly {
      tier: "list" | "constituency";
      districtId: string;
      partyId: string | null;
    }[];
  };
  replacements: readonly Bg1991ListReplacement[];
  heldPersonIds: ReadonlySet<string>;
  heldPlayerOwnerIds: ReadonlySet<string>;
  unavailablePersonIds: ReadonlySet<string>;
}): Bg1991ListPlacement[] {
  validateBgFoundingNominations(input.nominations);
  const people = new Map(input.nominations.people.map((row) => [row.id, row]));
  const slots = input.settled.mandates
    .filter((row) => row.tier === "list")
    .map((row) => ({
      slotId: row.personId,
      previousPersonId: row.personId as string | null,
      partyId: row.partyId,
      districtId: row.districtId,
      regionId: row.regionId,
    }));
  input.settled.vacancies.forEach((row, index) => {
    if (row.tier !== "list") return;
    const district = BG_1990_LIST_DISTRICTS.find((district) => district.id === row.districtId);
    if (!district || !row.partyId) throw new Error("Invalid Bulgarian original list vacancy");
    slots.push({
      slotId: `initial-vacancy:${index}`,
      previousPersonId: null,
      partyId: row.partyId,
      districtId: row.districtId,
      regionId: district.regionId,
    });
  });
  if (slots.length !== 200 || new Set(slots.map((row) => row.slotId)).size !== slots.length)
    throw new Error("Bulgarian list succession must preserve 200 physical mandates");
  const bySlot = new Map(slots.map((row) => [row.slotId, row]));
  const consumed = new Set(input.settled.mandates.map((row) => row.personId));
  for (const replacement of input.replacements) {
    const slot = bySlot.get(replacement.slotId),
      person = people.get(replacement.personId);
    const list =
      slot &&
      input.nominations.lists.find(
        (row) => row.districtId === slot.districtId && row.partyId === slot.partyId
      );
    if (
      !slot ||
      !person ||
      person.partyId !== slot.partyId ||
      !list?.candidateIds.includes(person.id) ||
      consumed.has(person.id)
    )
      throw new Error("Invalid Bulgarian list replacement history");
    consumed.add(person.id);
    slot.previousPersonId = person.id;
  }
  const players = new Set(input.heldPlayerOwnerIds);
  const placements: Bg1991ListPlacement[] = [];
  for (const slot of slots) {
    if (slot.previousPersonId && input.heldPersonIds.has(slot.previousPersonId)) continue;
    const list = input.nominations.lists.find(
      (row) => row.districtId === slot.districtId && row.partyId === slot.partyId
    );
    const id = list?.candidateIds.find((id) => {
      const person = people.get(id)!;
      return (
        !consumed.has(id) &&
        !input.heldPersonIds.has(id) &&
        !input.unavailablePersonIds.has(id) &&
        (person.isNpc || !players.has(person.ownerId))
      );
    });
    if (!id) continue;
    const person = people.get(id)!;
    consumed.add(id);
    if (!person.isNpc) players.add(person.ownerId);
    placements.push({
      slotId: slot.slotId,
      previousPersonId: slot.previousPersonId,
      mandate: {
        personId: person.id,
        candidateId: person.candidateId,
        ownerId: person.ownerId,
        isNpc: person.isNpc,
        partyId: slot.partyId,
        regionId: slot.regionId,
        tier: "list",
        districtId: slot.districtId,
      },
    });
  }
  return placements;
}
