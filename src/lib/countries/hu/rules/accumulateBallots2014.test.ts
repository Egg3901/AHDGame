import { describe, expect, it } from "vitest";
import { accumulateHuBallots } from "./accumulateBallots2014";
import { huDistrictIds } from "./constituencies2014";

describe("Hungarian district slate and second ballots", () => {
  it("files a regional NPP slate in every district and restricts a player to one", () => {
    const districts = huDistrictIds("HU_BUD");
    const candidates = [
      { candidateId: "player", partyId: "a", constituencyId: districts[0], votes: 210 },
      { candidateId: "npp-a", partyId: "a", isNPP: true, votes: 210 },
      { candidateId: "npp-b", partyId: "b", isNPP: true, votes: 210 },
    ];
    const turn = accumulateHuBallots("HU_BUD", candidates, { a: 90, b: 120 });
    expect(Object.keys(turn.districtSlate)).toHaveLength(21);
    expect(turn.districtSlate[districts[0]].a).toBe("player");
    expect(turn.districtSlate[districts[1]].a).toBe("npp-a");
    expect(turn.constituencyVotes[districts[1]].player).toBeUndefined();
    expect(turn.listVotes).toEqual({ a: 90, b: 120 });
    const next = accumulateHuBallots(
      "HU_BUD",
      candidates.slice(1),
      { a: 90, b: 120 },
      turn.constituencyVotes,
      turn.listVotes
    );
    expect(next.constituencyVotes[districts[0]].player).toBeUndefined();
    expect(next.constituencyVotes[districts[0]]["npp-a"]).toBeGreaterThan(0);
    expect(next.listVotes).toEqual({ a: 180, b: 240 });
  });

  it("rejects duplicate party nominees in one district", () => {
    const district = huDistrictIds("HU_BUD")[0];
    expect(() =>
      accumulateHuBallots(
        "HU_BUD",
        [
          { candidateId: "a", partyId: "p", constituencyId: district, votes: 1 },
          { candidateId: "b", partyId: "p", constituencyId: district, votes: 1 },
        ],
        { p: 1 }
      )
    ).toThrow("multiple district nominees");
  });
});
