import { describe, expect, it } from "vitest";
import { BG_1990_CONSTITUENCIES, BG_1990_LIST_DISTRICTS } from "../data/foundingDistricts1990";
import { buildBgFoundingSlates, type BgFoundingCampaignNominee } from "./foundingSlates1990";
import { settleBgFoundingMandates } from "./foundingMandates1990";

function fixture(): BgFoundingCampaignNominee[] {
  return [...new Set(BG_1990_LIST_DISTRICTS.map((row) => row.regionId))].map((regionId, index) => ({
    id: `campaign-${regionId}`,
    ownerId: `npc-${regionId}`,
    isNpc: true,
    partyId: "party",
    regionId,
    listOrder: index,
  }));
}

describe("Bulgarian founding campaign slates", () => {
  it("supplies400 distinct holders without creating financial actors", () => {
    const candidates = fixture();
    const { nominations } = buildBgFoundingSlates(candidates);
    expect(nominations.people).toHaveLength(400);
    expect(new Set(nominations.people.map((row) => row.ownerId)).size).toBe(5);
    expect(
      nominations.people.every((row) =>
        candidates.some(
          (candidate) => candidate.id === row.candidateId && candidate.ownerId === row.ownerId
        )
      )
    ).toBe(true);
    const result = settleBgFoundingMandates({
      nominations,
      constituencyWinners: Object.fromEntries(
        nominations.constituencies.map((row) => [row.id, row.candidateIds[0]])
      ),
      districtListSeats: Object.fromEntries(
        BG_1990_LIST_DISTRICTS.map((row) => [row.id, { party: row.seats }])
      ),
      availablePersonIds: new Set(nominations.people.map((row) => row.id)),
    });
    expect(result.mandates).toHaveLength(400);
    expect(result.vacancies).toHaveLength(0);
  });
  it("keeps a dual-filed player to one identity and one seat", () => {
    const candidates = fixture();
    const district = BG_1990_CONSTITUENCIES[0];
    candidates.push({
      id: "human",
      ownerId: "character",
      isNpc: false,
      partyId: "party",
      regionId: district.regionId,
      constituencyId: district.id,
      listOrder: 0,
    });
    const { nominations, playerListDistricts } = buildBgFoundingSlates(candidates);
    expect(nominations.people.filter((row) => !row.isNpc)).toHaveLength(1);
    expect(playerListDistricts.human).toBe(district.listDistrictId);
    const result = settleBgFoundingMandates({
      nominations,
      constituencyWinners: Object.fromEntries(
        nominations.constituencies.map((row) => [row.id, row.candidateIds[0]])
      ),
      districtListSeats: Object.fromEntries(
        BG_1990_LIST_DISTRICTS.map((row) => [row.id, { party: row.seats }])
      ),
      availablePersonIds: new Set(nominations.people.map((row) => row.id)),
    });
    expect(result.candidateSeats.human).toBe(1);
    expect(result.mandates).toHaveLength(400);
  });
  it("reserves explicit same-party filings before assigning defaults", () => {
    const candidates = fixture();
    const district = BG_1990_CONSTITUENCIES[0];
    candidates.push(
      {
        id: "default",
        ownerId: "default",
        isNpc: false,
        partyId: "party",
        regionId: district.regionId,
        listOrder: 0,
      },
      {
        id: "explicit",
        ownerId: "explicit",
        isNpc: false,
        partyId: "party",
        regionId: district.regionId,
        constituencyId: district.id,
        listOrder: 1,
      }
    );
    const result = buildBgFoundingSlates(candidates);
    expect(result.playerConstituencies.default).not.toBe(district.id);
    expect(result.playerConstituencies.explicit).toBe(district.id);
    expect(buildBgFoundingSlates([...candidates].reverse())).toEqual(result);
  });
  it("places each independent in one constituency and no list", () => {
    const candidates = fixture();
    const district = BG_1990_CONSTITUENCIES[0];
    candidates.push(
      {
        id: "ind-npc",
        ownerId: "ind-npc",
        isNpc: true,
        partyId: "independent",
        regionId: district.regionId,
        listOrder: 0,
      },
      {
        id: "ind-human",
        ownerId: "ind-human",
        isNpc: false,
        partyId: "independent",
        regionId: district.regionId,
        constituencyId: district.id,
        listOrder: 1,
      }
    );
    const { nominations } = buildBgFoundingSlates(candidates);
    const people = nominations.people.filter((row) => row.partyId === "independent");
    expect(people).toHaveLength(2);
    for (const person of people) {
      expect(
        nominations.constituencies.filter((row) => row.candidateIds.includes(person.id))
      ).toHaveLength(1);
      expect(nominations.lists.some((row) => row.candidateIds.includes(person.id))).toBe(false);
    }
  });
  it("rejects duplicate owners, cross-region filings and same-party constituency collisions", () => {
    const candidates = fixture();
    const district = BG_1990_CONSTITUENCIES[0];
    const player: BgFoundingCampaignNominee = {
      id: "player",
      ownerId: "player",
      isNpc: false,
      partyId: "party",
      regionId: district.regionId,
      constituencyId: district.id,
      listOrder: 0,
    };
    expect(() =>
      buildBgFoundingSlates([...candidates, { ...candidates[0], id: "other-campaign" }])
    ).toThrow("owner");
    expect(() =>
      buildBgFoundingSlates([...candidates, player, { ...player, id: "rival", ownerId: "rival" }])
    ).toThrow("already nominated");
    expect(() =>
      buildBgFoundingSlates([
        ...candidates,
        {
          ...player,
          constituencyId: BG_1990_CONSTITUENCIES.find((row) => row.regionId !== district.regionId)!
            .id,
        },
      ])
    ).toThrow("outside their region");
    expect(() =>
      buildBgFoundingSlates([
        ...candidates,
        { ...player, partyId: "independent", listDistrictId: district.listDistrictId },
      ])
    ).toThrow("no party list");
  });
});
