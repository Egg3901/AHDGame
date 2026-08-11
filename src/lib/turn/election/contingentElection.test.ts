import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  calculateHouseDelegationVote,
  calculateSenateVpVotes,
  getTopContingentPresidentCandidates,
  getTopContingentVicePresidentCandidateIds,
  resolveContingentElection,
  scoreContingentPreference,
  HOUSE_CONTINGENT_THRESHOLD,
  SENATE_CONTINGENT_THRESHOLD,
  CONTINGENT_EXCLUDED_HOUSE_STATE,
  type ContingentCandidateProfile,
  type ContingentHouseDelegation,
  type ContingentVoterProfile,
} from "./contingentElection";

const demPresident: ContingentCandidateProfile = {
  id: "dem",
  party: "1",
  economic: -2,
  social: -2,
};
const gopPresident: ContingentCandidateProfile = {
  id: "gop",
  party: "2",
  economic: 2,
  social: 2,
};
const indPresident: ContingentCandidateProfile = {
  id: "ind",
  party: "3",
  economic: 0,
  social: 0,
};

const demVp: ContingentCandidateProfile = {
  id: "vp-dem",
  party: "1",
  economic: -2,
  social: -2,
};
const gopVp: ContingentCandidateProfile = {
  id: "vp-gop",
  party: "2",
  economic: 2,
  social: 2,
};

function demRep(id: string, weight = 1): ContingentVoterProfile {
  return { id, party: "1", economic: -2, social: -2, weight };
}

function gopRep(id: string, weight = 1): ContingentVoterProfile {
  return { id, party: "2", economic: 2, social: 2, weight };
}

describe("getTopContingentPresidentCandidates", () => {
  it("returns top three by EV", () => {
    expect(getTopContingentPresidentCandidates({ a: 200, b: 180, c: 100, d: 58 }, 3)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("getTopContingentVicePresidentCandidateIds", () => {
  it("maps top two presidential tickets to running mates", () => {
    expect(
      getTopContingentVicePresidentCandidateIds(
        { dem: 269, gop: 269 },
        { dem: "vp-dem", gop: "vp-gop" },
        2
      )
    ).toEqual(["vp-dem", "vp-gop"]);
  });
});

describe("scoreContingentPreference", () => {
  it("prefers same-party candidates", () => {
    const voter = demRep("v1");
    expect(scoreContingentPreference(voter, demPresident)).toBeGreaterThan(
      scoreContingentPreference(voter, gopPresident)
    );
  });
});

describe("calculateHouseDelegationVote", () => {
  it("awards delegation to party plurality of representatives", () => {
    const delegation: ContingentHouseDelegation = {
      stateId: "CA",
      voters: [demRep("d1"), demRep("d2"), gopRep("r1")],
    };
    expect(calculateHouseDelegationVote(delegation, [demPresident, gopPresident], "seed")).toBe(
      "dem"
    );
  });

  it("abstains when delegation representatives tie", () => {
    const delegation: ContingentHouseDelegation = {
      stateId: "OH",
      voters: [demRep("d1"), gopRep("r1")],
    };
    expect(
      calculateHouseDelegationVote(delegation, [demPresident, gopPresident], "seed")
    ).toBeNull();
  });

  it("excludes DC delegations", () => {
    const delegation: ContingentHouseDelegation = {
      stateId: CONTINGENT_EXCLUDED_HOUSE_STATE,
      voters: [demRep("d1")],
    };
    expect(
      calculateHouseDelegationVote(delegation, [demPresident, gopPresident], "seed")
    ).toBeNull();
  });

  it("weights bloc NPP seat counts", () => {
    const delegation: ContingentHouseDelegation = {
      stateId: "TX",
      voters: [gopRep("bloc", 3), demRep("solo")],
    };
    expect(calculateHouseDelegationVote(delegation, [demPresident, gopPresident], "seed")).toBe(
      "gop"
    );
  });
});

describe("calculateSenateVpVotes", () => {
  it("counts one vote per senator", () => {
    const { totals } = calculateSenateVpVotes(
      [demRep("s1"), demRep("s2"), gopRep("s3")],
      [demVp, gopVp],
      "seed"
    );
    expect(totals["vp-dem"]).toBe(2);
    expect(totals["vp-gop"]).toBe(1);
  });
});

describe("resolveContingentElection", () => {
  const electionId = new ObjectId();

  function buildDelegations(demStates: string[], gopStates: string[]): ContingentHouseDelegation[] {
    return [
      ...demStates.map((stateId) => ({ stateId, voters: [demRep(`${stateId}-d`)] })),
      ...gopStates.map((stateId) => ({ stateId, voters: [gopRep(`${stateId}-r`)] })),
    ];
  }

  it("elects president via House and VP via Senate", () => {
    const demStates = Array.from({ length: 28 }, (_, i) => `D${i}`);
    const gopStates = Array.from({ length: 22 }, (_, i) => `R${i}`);
    const senators = Array.from({ length: 52 }, (_, i) => demRep(`sen-${i}`));

    const result = resolveContingentElection({
      electionId,
      electoralVotesByCandidate: { dem: 269, gop: 269 },
      presidentCandidates: [demPresident, gopPresident],
      vicePresidentCandidates: [demVp, gopVp],
      houseDelegations: buildDelegations(demStates, gopStates),
      senators,
    });

    expect(result.presidentWinnerId).toBe("dem");
    expect(result.vicePresidentWinnerId).toBe("vp-dem");
    expect(result.houseVoteTotals.dem).toBe(28);
    expect(result.resolutionMode).toBe("contingent");
    expect(result.deadlockBreakerUsed).toBe(false);
  });

  it("limits House ballot to top three EV candidates", () => {
    const delegations: ContingentHouseDelegation[] = [{ stateId: "NY", voters: [demRep("only")] }];
    const result = resolveContingentElection({
      electionId: new ObjectId(),
      electoralVotesByCandidate: { dem: 200, gop: 180, ind: 158 },
      presidentCandidates: [demPresident, gopPresident, indPresident],
      vicePresidentCandidates: [demVp, gopVp],
      houseDelegations: delegations,
      senators: [demRep("s1")],
    });
    expect(result.eligiblePresidentCandidateIds).toEqual(["dem", "gop", "ind"]);
    expect(result.eligiblePresidentCandidateIds).not.toContain("fourth");
  });

  it("uses deadlock breaker when House does not reach 26 states", () => {
    const demStates = Array.from({ length: 13 }, (_, i) => `D${i}`);
    const gopStates = Array.from({ length: 12 }, (_, i) => `R${i}`);
    const result = resolveContingentElection({
      electionId: new ObjectId(),
      electoralVotesByCandidate: { dem: 260, gop: 200, ind: 78 },
      presidentCandidates: [demPresident, gopPresident, indPresident],
      vicePresidentCandidates: [demVp],
      houseDelegations: buildDelegations(demStates, gopStates),
      senators: [demRep("s1")],
    });

    expect(result.deadlockBreakerUsed).toBe(true);
    expect(result.resolutionMode).toBe("contingent_deadlock");
    expect(["dem", "gop"]).toContain(result.presidentWinnerId);
  });

  it("auto-seats sole eligible VP without a Senate ballot", () => {
    const result = resolveContingentElection({
      electionId: new ObjectId(),
      electoralVotesByCandidate: { dem: 269, gop: 269 },
      presidentCandidates: [demPresident, gopPresident],
      vicePresidentCandidates: [demVp],
      houseDelegations: [{ stateId: "CA", voters: [demRep("d1")] }],
      senators: [],
    });
    expect(result.vicePresidentWinnerId).toBe("vp-dem");
    expect(Object.keys(result.senateVoteTotals)).toHaveLength(0);
  });

  it("uses EV-order fallback when House produces no delegation votes", () => {
    const result = resolveContingentElection({
      electionId: new ObjectId(),
      electoralVotesByCandidate: { dem: 260, gop: 200, ind: 78 },
      presidentCandidates: [demPresident, gopPresident, indPresident],
      vicePresidentCandidates: [demVp],
      houseDelegations: [],
      senators: [demRep("s1")],
      evByEligibleId: { dem: 260, gop: 200, ind: 78, "vp-dem": 260 },
    });

    expect(result.deadlockBreakerUsed).toBe(true);
    expect(result.resolutionMode).toBe("contingent_deadlock");
    expect(result.presidentWinnerId).toBe("dem");
    expect(result.deadlockBreakerReason).toMatch(/no house votes cast/i);
  });

  it("uses EV-order fallback when Senate produces no VP votes", () => {
    const result = resolveContingentElection({
      electionId: new ObjectId(),
      electoralVotesByCandidate: { dem: 269, gop: 269 },
      presidentCandidates: [demPresident, gopPresident],
      vicePresidentCandidates: [demVp, gopVp],
      houseDelegations: [{ stateId: "CA", voters: [demRep("d1")] }],
      senators: [],
      evByEligibleId: { dem: 269, gop: 269, "vp-dem": 269, "vp-gop": 269 },
    });

    expect(result.vicePresidentWinnerId).toBeTruthy();
    expect(result.deadlockBreakerUsed).toBe(true);
    expect(result.deadlockBreakerReason).toMatch(/no senate votes cast/i);
  });

  it("rejects ineligible presidential candidates on the ballot", () => {
    expect(() =>
      resolveContingentElection({
        electionId: new ObjectId(),
        electoralVotesByCandidate: { dem: 200, gop: 180, ind: 158 },
        presidentCandidates: [demPresident, gopPresident, indPresident],
        vicePresidentCandidates: [],
        houseDelegations: [{ stateId: "CA", voters: [demRep("d1")] }],
        senators: [],
      })
    ).not.toThrow();

    const fourth: ContingentCandidateProfile = {
      id: "fourth",
      party: "4",
      economic: 0,
      social: 0,
    };
    expect(() =>
      resolveContingentElection({
        electionId: new ObjectId(),
        electoralVotesByCandidate: { dem: 200, gop: 180, ind: 158 },
        presidentCandidates: [demPresident, gopPresident, indPresident, fourth],
        vicePresidentCandidates: [],
        houseDelegations: [{ stateId: "CA", voters: [demRep("d1")] }],
        senators: [],
      })
    ).toThrow(/ineligible presidential candidates/);
  });

  it("is deterministic for identical inputs", () => {
    const input = {
      electionId,
      electoralVotesByCandidate: { dem: 269, gop: 269 },
      presidentCandidates: [demPresident, gopPresident],
      vicePresidentCandidates: [demVp, gopVp],
      houseDelegations: buildDelegations(["CA", "NY"], ["TX"]),
      senators: [demRep("s1"), gopRep("s2")],
    };
    const a = resolveContingentElection(input);
    const b = resolveContingentElection(input);
    expect(a).toEqual(b);
  });
});

describe("threshold constants", () => {
  it("uses 26 House states and 51 Senate votes", () => {
    expect(HOUSE_CONTINGENT_THRESHOLD).toBe(26);
    expect(SENATE_CONTINGENT_THRESHOLD).toBe(51);
  });
});
