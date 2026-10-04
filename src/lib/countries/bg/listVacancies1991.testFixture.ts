import { ObjectId } from "mongodb";
import { BG_1990_CONSTITUENCIES, BG_1990_LIST_DISTRICTS } from "./data/foundingDistricts1990";
import { settleBgFoundingMandates, type BgFoundingPerson } from "./rules/foundingMandates1990";

export function bgListVacancyFixture() {
  const ownerIds = new Map(
    BG_1990_LIST_DISTRICTS.map((row) => [row.regionId, new ObjectId().toHexString()])
  );
  const people: BgFoundingPerson[] = [];
  const constituencies = BG_1990_CONSTITUENCIES.map((row, index) => {
    const id = `direct-${index}`;
    people.push({
      id,
      candidateId: `npc-${row.regionId}`,
      ownerId: ownerIds.get(row.regionId)!,
      isNpc: true,
      partyId: "a",
      regionId: row.regionId,
    });
    return { id: row.id, candidateIds: [id] };
  });
  const lists = BG_1990_LIST_DISTRICTS.map((row) => {
    const candidateIds = Array.from({ length: row.seats + 2 }, (_, index) => `${row.id}-${index}`);
    people.push(
      ...candidateIds.map((id) => ({
        id,
        candidateId: `npc-${row.regionId}`,
        ownerId: ownerIds.get(row.regionId)!,
        isNpc: true,
        partyId: "a",
        regionId: row.regionId,
      }))
    );
    return { districtId: row.id, partyId: "a", candidateIds };
  });
  const nominations = { people, constituencies, lists };
  const settled = settleBgFoundingMandates({
    nominations,
    constituencyWinners: Object.fromEntries(
      constituencies.map((row) => [row.id, row.candidateIds[0]])
    ),
    districtListSeats: Object.fromEntries(
      BG_1990_LIST_DISTRICTS.map((row) => [row.id, { a: row.seats }])
    ),
    availablePersonIds: new Set(people.map((row) => row.id)),
  });
  return { nominations, settled, ownerIds };
}
