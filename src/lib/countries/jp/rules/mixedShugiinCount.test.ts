import { describe, expect, it } from "vitest";
import { JP_SHUGIIN_1994_CONSTITUENCIES } from "../data/jpShugiinConstituencies1994";
import { JP_SHUGIIN_1994_LIST_SEATS } from "./shugiinElectoralLaw";
import {
  buildJapanMixedRegionalList,
  countJapanMixedShugiin,
  remapJapanShugiinListVotes,
  type ShugiinDistrictCandidate,
  type ShugiinListCandidate,
} from "./mixedShugiinCount";

function fullBallot() {
  const districtVotes: Record<string, ShugiinDistrictCandidate[]> = Object.fromEntries(
    JP_SHUGIIN_1994_CONSTITUENCIES.map((district) => [
      district.id,
      [{ candidateId: `direct:${district.id}`, partyId: "party-a", votes: 100 }],
    ])
  );
  const listVotesByRegion: Record<string, Record<string, number>> = {};
  const regionalLists: Record<string, ShugiinListCandidate[]> = {};
  for (const [regionId, seats] of Object.entries(JP_SHUGIIN_1994_LIST_SEATS)) {
    const firstDirect = JP_SHUGIIN_1994_CONSTITUENCIES.find(
      (district) => district.regionId === regionId
    )!;
    listVotesByRegion[regionId] = { "party-a": 200 };
    regionalLists[regionId] = [
      { candidateId: `direct:${firstDirect.id}`, partyId: "party-a", listOrder: 1 },
      ...Array.from({ length: seats }, (_, index) => ({
        candidateId: `list:${regionId}:${index + 1}`,
        partyId: "party-a",
        listOrder: index + 2,
      })),
    ];
  }
  return { districtVotes, listVotesByRegion, regionalLists };
}

describe("Japan mixed Shūgiin count", () => {
  it("counts district winners separately from regional lists and prevents double seats", () => {
    const result = countJapanMixedShugiin(fullBallot());
    expect(Object.values(result.directWinners).filter(Boolean)).toHaveLength(300);
    expect(Object.values(result.listWinners).flat()).toHaveLength(200);
    expect(Object.values(result.seatsByCandidate).reduce((sum, count) => sum + count, 0)).toBe(500);
    for (const candidateId of Object.values(result.directWinners)) {
      if (candidateId) expect(result.seatsByCandidate[candidateId]).toBe(1);
    }
    expect(result.vacancies).toEqual([]);
  });

  it("requires actual ballot rows for all 300 statutory constituencies", () => {
    const input = fullBallot();
    const { [JP_SHUGIIN_1994_CONSTITUENCIES[0].id]: _removed, ...districtVotes } =
      input.districtVotes;
    expect(() => countJapanMixedShugiin({ ...input, districtVotes })).toThrow(
      "complete statutory 300-district ballot map"
    );
  });

  it("rejects a candidate filed in two districts", () => {
    const input = fullBallot();
    const first = JP_SHUGIIN_1994_CONSTITUENCIES[0];
    const second = JP_SHUGIIN_1994_CONSTITUENCIES[1];
    input.districtVotes[second.id] = [
      { candidateId: `direct:${first.id}`, partyId: "party-a", votes: 100 },
    ];
    expect(() => countJapanMixedShugiin(input)).toThrow("only one Shugiin constituency");
  });

  it("rejects duplicate party-list ranks within a regional slate", () => {
    const input = fullBallot();
    const region = Object.keys(input.regionalLists)[0];
    input.regionalLists[region] = [
      { candidateId: "list:first", partyId: "party-a", listOrder: 1 },
      { candidateId: "list:second", partyId: "party-a", listOrder: 1 },
    ];
    expect(() => countJapanMixedShugiin(input)).toThrow("Duplicate party-list rank");
  });

  it("rejects one player identity filed on multiple regional lists", () => {
    const input = fullBallot();
    const [first, second] = Object.keys(input.regionalLists);
    input.regionalLists[first] = [{ candidateId: "same-player", partyId: "party-a", listOrder: 1 }];
    input.regionalLists[second] = [
      { candidateId: "same-player", partyId: "party-a", listOrder: 1 },
    ];
    expect(() => countJapanMixedShugiin(input)).toThrow("only one Shugiin regional list");
  });

  it("rejects a candidate whose party differs between direct and list ballots", () => {
    const input = fullBallot();
    const district = JP_SHUGIIN_1994_CONSTITUENCIES[0];
    input.regionalLists[district.regionId][0] = {
      candidateId: `direct:${district.id}`,
      partyId: "party-b",
      listOrder: 1,
    };
    expect(() => countJapanMixedShugiin(input)).toThrow("cannot change party");
  });

  it("lets one bounded NPC representative absorb its party's full list entitlement after direct wins", () => {
    const input = fullBallot();
    const region = "KAN";
    const districts = JP_SHUGIIN_1994_CONSTITUENCIES.filter((row) => row.regionId === region);
    input.districtVotes = Object.fromEntries(
      districts.map((district) => [
        district.id,
        [{ candidateId: "npp-a", partyId: "party-a", votes: 10, isNPP: true }],
      ])
    );
    input.listVotesByRegion[region] = { "party-a": 1000 };
    input.regionalLists[region] = [
      { candidateId: "player-list", partyId: "party-a", listOrder: 1 },
      { candidateId: "npp-a", partyId: "party-a", listOrder: 2, isNPP: true },
    ];

    const result = countJapanMixedShugiin(input, region);
    expect(districts).toHaveLength(85);
    expect(result.seatsByCandidate["npp-a"]).toBe(85 + 62);
    expect(result.seatsByCandidate["player-list"]).toBe(1);
    expect(result.listWinners[region]).toHaveLength(63);
    expect(result.listWinners[region].filter((id) => id === "npp-a")).toHaveLength(62);
    expect(result.vacancies).toEqual([]);
  });

  it("reconciles merged party list ranks and second-vote totals deterministically", () => {
    const rows = buildJapanMixedRegionalList([
      { candidateId: "old-rank-1", partyId: "survivor", listOrder: 1 },
      { candidateId: "new-rank-1", partyId: "survivor", listOrder: 1 },
      { candidateId: "npc", partyId: "survivor", isNPP: true },
    ]);
    expect(rows.map(({ candidateId, listOrder }) => [candidateId, listOrder])).toEqual([
      ["new-rank-1", 1],
      ["old-rank-1", 2],
      ["npc", 3],
    ]);
    expect(
      remapJapanShugiinListVotes({ absorbed: 10, survivor: 20 }, (id) =>
        id === "absorbed" ? "survivor" : id
      )
    ).toEqual({ survivor: 30 });
  });

  it("never creates a party-list row for an independent candidate", () => {
    expect(
      buildJapanMixedRegionalList([
        { candidateId: "independent", partyId: "independent", listOrder: 1 },
      ])
    ).toEqual([]);
    const input = fullBallot();
    const region = Object.keys(input.regionalLists)[0];
    input.regionalLists[region] = [
      { candidateId: "independent", partyId: "independent", listOrder: 1 },
    ];
    expect(() => countJapanMixedShugiin(input)).toThrow("Invalid party-list nominee");
  });

  it("does not append a ranked NPP nominee a second time as the bounded slate representative", () => {
    expect(
      buildJapanMixedRegionalList([
        { candidateId: "npc", partyId: "party-a", listOrder: 1, isNPP: true },
      ])
    ).toEqual([{ candidateId: "npc", partyId: "party-a", listOrder: 1, isNPP: true }]);
  });
});
