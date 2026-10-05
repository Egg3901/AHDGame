import { describe, expect, it } from "vitest";
import { JP_SHUGIIN_1994_CONSTITUENCIES } from "../data/jpShugiinConstituencies1994";
import { accumulateJapanBallots, allocateJapanListTurnVotes } from "./shugiinBallotMath";

describe("1994 Shugiin two-ballot accumulation", () => {
  it("routes direct votes to filed districts and keeps list votes on a separate support basis", () => {
    const districts = JP_SHUGIIN_1994_CONSTITUENCIES.filter((row) => row.regionId === "KAN");
    const filedDistrict = districts[0].id;
    const followingDistrict = districts[1].id;
    const listIncrements = allocateJapanListTurnVotes(100, [
      { partyId: "party-a", registration: 3 },
      { partyId: "party-b", registration: 1 },
    ]);
    const result = accumulateJapanBallots({
      regionId: "KAN",
      candidates: [
        {
          candidateId: "player-a",
          partyId: "party-a",
          constituencyId: filedDistrict,
          votes: 20,
        },
        { candidateId: "npc-b", partyId: "party-b", isNPP: true, votes: 85 },
      ],
      listVoteIncrements: listIncrements,
      previousDistricts: {
        [filedDistrict]: { "player-a": 2, "npc-b": 1, stale: 50 },
        [followingDistrict]: { "player-a": 99 },
      },
      previousLists: { "party-a": 7, stale: 12 },
    });

    expect(result.districtSlate[filedDistrict]).toEqual({
      "direct:player-a": "player-a",
      "party-b": "npc-b",
    });
    expect(result.constituencyVotes[filedDistrict]).toEqual({ "player-a": 22, "npc-b": 2 });
    expect(result.constituencyVotes[followingDistrict]).toEqual({ "npc-b": 1 });
    expect(
      Object.values(result.constituencyVotes).reduce(
        (sum, row) => sum + Object.values(row).reduce((a, b) => a + b, 0),
        0
      )
    ).toBe(108);
    expect(result.listVotes).toEqual({ "party-a": 82, "party-b": 25 });
  });

  it("rejects a candidate filing outside the election's region", () => {
    expect(() =>
      accumulateJapanBallots({
        regionId: "KAN",
        candidates: [
          {
            candidateId: "player-a",
            partyId: "party-a",
            constituencyId: "JP-HOK-01-01",
            votes: 1,
          },
        ],
        listVoteIncrements: {},
      })
    ).toThrow("Japan candidate filed outside region");
  });

  it("allows multiple independent constituency nominees without creating an independent list", () => {
    const district = JP_SHUGIIN_1994_CONSTITUENCIES.find((row) => row.regionId === "KAN")!;
    const result = accumulateJapanBallots({
      regionId: "KAN",
      candidates: [
        {
          candidateId: "independent-one",
          partyId: "independent",
          constituencyId: district.id,
          votes: 10,
        },
        {
          candidateId: "independent-two",
          partyId: "independent",
          constituencyId: district.id,
          votes: 15,
        },
        { candidateId: "party-npp", partyId: "party-a", isNPP: true, votes: 5 },
      ],
      listVoteIncrements: { "party-a": 100 },
    });

    expect(result.districtSlate[district.id]).toMatchObject({
      "direct:independent-one": "independent-one",
      "direct:independent-two": "independent-two",
      "party-a": "party-npp",
    });
    expect(result.constituencyVotes[district.id]).toMatchObject({
      "independent-one": 10,
      "independent-two": 15,
    });
    expect(result.listVotes).toEqual({ "party-a": 100 });
  });

  it("keeps prior direct ballots for both nominees after their parties merge", () => {
    const district = JP_SHUGIIN_1994_CONSTITUENCIES.find((row) => row.regionId === "KAN")!;
    const result = accumulateJapanBallots({
      regionId: "KAN",
      candidates: [
        {
          candidateId: "candidate-from-party-a",
          partyId: "merged-party",
          constituencyId: district.id,
          votes: 4,
        },
        {
          candidateId: "candidate-from-party-b",
          partyId: "merged-party",
          constituencyId: district.id,
          votes: 7,
        },
      ],
      previousDistricts: {
        [district.id]: {
          "candidate-from-party-a": 10,
          "candidate-from-party-b": 20,
          withdrawn: 9_999,
        },
      },
      listVoteIncrements: {},
    });

    expect(result.districtSlate[district.id]).toEqual({
      "direct:candidate-from-party-a": "candidate-from-party-a",
      "direct:candidate-from-party-b": "candidate-from-party-b",
    });
    expect(result.constituencyVotes[district.id]).toEqual({
      "candidate-from-party-a": 14,
      "candidate-from-party-b": 27,
    });
  });
});
