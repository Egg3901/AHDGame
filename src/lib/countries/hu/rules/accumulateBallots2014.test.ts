import { describe, expect, it } from "vitest";
import { accumulateHuBallots } from "./accumulateBallots2014";
import { huDistrictIds } from "./constituencies2014";

describe("Hungarian separate campaign ballots", () => {
  it("keeps a filed candidate in one district and accumulates independent list votes", () => {
    const district = huDistrictIds("HU_BUD")[0];
    const turn = accumulateHuBallots("HU_BUD", [
      { candidateId: "filed", partyId: "a", constituencyId: district, votes: 210, listAppeal: 1.1 },
      { candidateId: "legacy", partyId: "b", votes: 210, listAppeal: 0.9 },
    ]);
    expect(turn.constituencyVotes[district].filed).toBe(10);
    expect(turn.constituencyVotes[huDistrictIds("HU_BUD")[1]].filed).toBeUndefined();
    expect(turn.constituencyVotes[district].legacy).toBe(10);
    expect(turn.listVotes).toEqual({ a: 231, b: 189 });
    const next = accumulateHuBallots(
      "HU_BUD",
      [
        {
          candidateId: "filed",
          partyId: "a",
          constituencyId: district,
          votes: 210,
          listAppeal: 1.1,
        },
      ],
      turn.constituencyVotes,
      turn.listVotes
    );
    expect(next.constituencyVotes[district].filed).toBe(20);
    expect(next.listVotes.a).toBe(462);
  });
});
