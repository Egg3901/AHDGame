import { describe, it, expect } from "vitest";
import { computeHouseVoteStandings } from "./contingentHouseStandings";
import { calculateHouseDelegationVotes } from "./contingentElection";
import type { ContingentCandidateProfile, ContingentHouseDelegation } from "./contingentElection";

const candidates: ContingentCandidateProfile[] = [
  { id: "a", party: "1", economic: -5, social: 0 },
  { id: "b", party: "2", economic: 5, social: 0 },
  { id: "c", party: "3", economic: 0, social: 8 },
];

function voter(id: string, party: string, economic = 0, weight?: number) {
  return { id, party, economic, social: 0, weight };
}

/** Fifty one-member delegations, `aStates` of them party 1 and the rest party 2. */
function roster(aStates: number): ContingentHouseDelegation[] {
  return Array.from({ length: 50 }, (_, i) => ({
    stateId: `S${String(i).padStart(2, "0")}`,
    voters: [i < aStates ? voter(`v${i}`, "1", -5) : voter(`v${i}`, "2", 5)],
  }));
}

describe("computeHouseVoteStandings", () => {
  it("starts at the engine's ballot when nobody has voted", () => {
    const delegations = roster(20);
    const standings = computeHouseVoteStandings({
      delegations,
      candidates,
      votes: {},
      tieSeed: "e1",
    });
    const engine = calculateHouseDelegationVotes(delegations, candidates, "e1");
    expect(standings.delegationVotes).toEqual(engine.delegationVotes);
    expect(standings.delegationTotals).toEqual({ a: 20, b: 30, c: 0 });
    expect(standings.explicitVoters).toBe(0);
  });

  it("uses the majority of the 50 delegations and reports a winner only at it", () => {
    const short = computeHouseVoteStandings({
      delegations: roster(25),
      candidates,
      votes: {},
      tieSeed: "e1",
    });
    expect(short.threshold).toBe(26);
    expect(short.majorityWinnerId).toBeNull();
    expect(short.leaderId).toBe("a");

    const enough = computeHouseVoteStandings({
      delegations: roster(26),
      candidates,
      votes: {},
      tieSeed: "e1",
    });
    expect(enough.majorityWinnerId).toBe("a");
  });

  it("lets an explicit vote override the default pick and counts re-votes once", () => {
    const delegations = roster(25);
    const base = computeHouseVoteStandings({ delegations, candidates, votes: {}, tieSeed: "e1" });
    // v30 defaults to b; backing a moves a delegation: 26 for a.
    const moved = computeHouseVoteStandings({
      delegations,
      candidates,
      votes: { v30: "a" },
      tieSeed: "e1",
    });
    expect(base.delegationTotals.a).toBe(25);
    expect(moved.delegationTotals.a).toBe(26);
    expect(moved.majorityWinnerId).toBe("a");
    expect(moved.explicitVoters).toBe(1);
  });

  it("ignores votes for ineligible candidacies", () => {
    const standings = computeHouseVoteStandings({
      delegations: roster(25),
      candidates,
      votes: { v30: "zzz" },
      tieSeed: "e1",
    });
    expect(standings.delegationTotals.a).toBe(25);
    expect(standings.explicitVoters).toBe(0);
  });

  it("weights members by seats and abstains tied delegations", () => {
    const delegations: ContingentHouseDelegation[] = [
      { stateId: "AA", voters: [voter("w1", "1", -5, 3), voter("w2", "2", 5, 1)] },
      { stateId: "BB", voters: [voter("t1", "1", -5), voter("t2", "2", 5)] },
    ];
    const standings = computeHouseVoteStandings({
      delegations,
      candidates,
      votes: {},
      tieSeed: "e1",
    });
    expect(standings.delegationVotes).toEqual({ AA: "a", BB: null });
    expect(standings.delegationsVoting).toBe(1);
    expect(standings.memberTotals).toMatchObject({ a: 4, b: 2 });
  });

  it("excludes DC even when it has members", () => {
    const standings = computeHouseVoteStandings({
      delegations: [{ stateId: "DC", voters: [voter("d1", "1", -5)] }],
      candidates,
      votes: { d1: "a" },
      tieSeed: "e1",
    });
    expect(standings.delegationVotes.DC).toBeNull();
    expect(standings.delegationTotals.a).toBe(0);
    expect(standings.leaderId).toBeNull();
  });

  it("makes a coalition partner's candidate the default pick", () => {
    const delegations: ContingentHouseDelegation[] = [
      {
        stateId: "AA",
        voters: [{ ...voter("p1", "9", 0), coalitionParties: ["3"] }],
      },
    ];
    const standings = computeHouseVoteStandings({
      delegations,
      candidates,
      votes: {},
      tieSeed: "e1",
    });
    expect(standings.delegationVotes.AA).toBe("c");
  });
});
