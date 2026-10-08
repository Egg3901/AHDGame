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

describe("computeHouseVoteStandings whips", () => {
  /** Ten delegations: five party 1 members (lean a) and five party 2 members (lean b), one voter each. */
  function split(): ContingentHouseDelegation[] {
    return Array.from({ length: 10 }, (_, i) => ({
      stateId: `S${i}`,
      voters: [i < 5 ? voter(`n${i}`, "1", -5) : voter(`npp_${i}`, "2", 5)],
    }));
  }
  const run = (extra: Partial<Parameters<typeof computeHouseVoteStandings>[0]>) =>
    computeHouseVoteStandings({
      delegations: split(),
      candidates,
      votes: {},
      tieSeed: "e1",
      ...extra,
    });

  it("makes NPP members follow their party whip over preference", () => {
    const standings = run({ whips: { "party:2": { candidateId: "c" } } });
    expect(standings.delegationTotals).toEqual({ a: 5, b: 0, c: 5 });
  });

  it("applies a coalition whip to member parties without their own party whip", () => {
    const standings = run({
      whips: {
        "coalition:7": { candidateId: "c" },
        "party:1": { candidateId: "a" },
      },
      partyCoalition: { "1": "7", "2": "7" },
    });
    // Party 1 keeps its own whip; party 2 takes the coalition whip.
    expect(standings.delegationTotals).toEqual({ a: 5, b: 0, c: 5 });
  });

  it("lets a party free vote stand against the coalition whip", () => {
    const standings = run({
      whips: { "coalition:7": { candidateId: "c" }, "party:2": { candidateId: "free" } },
      partyCoalition: { "1": "7", "2": "7" },
    });
    expect(standings.delegationTotals).toEqual({ a: 0, b: 5, c: 5 });
  });

  it("ignores a whip for a candidacy that left the ballot", () => {
    const standings = run({
      candidates: candidates.filter((c) => c.id !== "c"),
      whips: { "party:2": { candidateId: "c" } },
    });
    expect(standings.delegationTotals).toEqual({ a: 5, b: 5 });
  });

  it("does not force a player: an explicit vote beats the whip and is reported as defiance", () => {
    const delegations: ContingentHouseDelegation[] = [
      { stateId: "AA", voters: [voter("p1", "1", -5)] },
      { stateId: "BB", voters: [voter("p2", "1", -5)] },
    ];
    const standings = computeHouseVoteStandings({
      delegations,
      candidates,
      votes: { p1: "b" },
      whips: { "party:1": { candidateId: "c" } },
      tieSeed: "e1",
    });
    // p1 defied the whip for c; p2 has not voted and follows it.
    expect(standings.delegationVotes).toEqual({ AA: "b", BB: "c" });
    expect(standings.defiances).toEqual([
      { voterId: "p1", stateId: "AA", candidateId: "b", whipCandidateId: "c", whipKey: "party:1" },
    ]);
  });

  it("does not report a player who votes with the whip or under a free vote", () => {
    const delegations: ContingentHouseDelegation[] = [
      { stateId: "AA", voters: [voter("p1", "1", -5)] },
    ];
    const withWhip = computeHouseVoteStandings({
      delegations,
      candidates,
      votes: { p1: "c" },
      whips: { "party:1": { candidateId: "c" } },
      tieSeed: "e1",
    });
    expect(withWhip.defiances).toEqual([]);
    const free = computeHouseVoteStandings({
      delegations,
      candidates,
      votes: { p1: "b" },
      whips: { "party:1": { candidateId: "free" } },
      tieSeed: "e1",
    });
    expect(free.defiances).toEqual([]);
  });

  it("ignores explicit votes keyed to NPP ids", () => {
    const standings = run({ votes: { npp_5: "a" } });
    expect(standings.explicitVoters).toBe(0);
  });

  it("lets a lone remaining candidate win only with a majority of delegations", () => {
    const only = candidates.filter((c) => c.id === "a");
    const tied: ContingentHouseDelegation[] = roster(0).map((d, i) =>
      i < 24 ? { ...d, voters: [] } : d
    );
    const thin = computeHouseVoteStandings({
      delegations: tied,
      candidates: only,
      votes: {},
      tieSeed: "e1",
    });
    expect(thin.delegationTotals).toEqual({ a: 26 });
    expect(thin.majorityWinnerId).toBe("a");
    const empty = computeHouseVoteStandings({
      delegations: roster(0).map((d, i) => (i < 25 ? { ...d, voters: [] } : d)),
      candidates: only,
      votes: {},
      tieSeed: "e1",
    });
    expect(empty.delegationTotals).toEqual({ a: 25 });
    expect(empty.majorityWinnerId).toBeNull();
  });

  it("reports tied delegations in the state rows", () => {
    const standings = computeHouseVoteStandings({
      delegations: [
        { stateId: "AA", voters: [voter("t1", "1", -5), voter("t2", "2", 5)] },
        { stateId: "BB", voters: [voter("t3", "1", -5)] },
      ],
      candidates,
      votes: {},
      tieSeed: "e1",
    });
    expect(standings.delegations).toEqual([
      { stateId: "AA", backing: null, tied: true, weights: { a: 1, b: 1 } },
      { stateId: "BB", backing: "a", tied: false, weights: { a: 1 } },
    ]);
  });
});
