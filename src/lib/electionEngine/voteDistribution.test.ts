import { describe, it, expect } from "vitest";
import { distributeVotesByGroupLevelAllocation } from "./voteDistribution";
import { ORG_WEIGHT_EXPONENT } from "./electionFormulaFactors";
import type { EnrichedCandidate, DistributeVotesOptions } from "./types";
import type { DemographicCategory, StateDemographics } from "@/lib/db/types";

// ─── Test fixtures ──────────────────────────────────────────────────────────

function makeCandidate(
  overrides: Partial<EnrichedCandidate> & { candidateId: string }
): EnrichedCandidate {
  return {
    characterId: overrides.candidateId,
    characterName: overrides.candidateId,
    party: "democrat",
    isNPP: false,
    charEP: 0,
    charSP: 0,
    favorability: 50,
    politicalInfluence: 100,
    nationalInfluence: 100,
    ...overrides,
  };
}

function makeCategory(): DemographicCategory {
  return {
    _id: "ideology",
    name: "Ideology",
    defaultWeight: 100,
    groups: [
      {
        id: "liberal",
        name: "Liberals",
        defaultEconomicLean: -3,
        defaultSocialLean: -3,
        defaultTurnout: 60,
      },
      {
        id: "conservative",
        name: "Conservatives",
        defaultEconomicLean: 3,
        defaultSocialLean: 3,
        defaultTurnout: 60,
      },
    ],
  } as DemographicCategory;
}

function makeDemographics(overrides?: Partial<StateDemographics>): StateDemographics {
  return {
    _id: "PA",
    categoryWeights: { ideology: 100 },
    groups: {
      liberal: { population: 50, turnout: 60, economicLean: -3, socialLean: -3 },
      conservative: { population: 50, turnout: 60, economicLean: 3, socialLean: 3 },
    },
    ...overrides,
  } as StateDemographics;
}

const emptyOrgMap = new Map<string, number>();

// ─── Basic distribution ─────────────────────────────────────────────────────

describe("distributeVotesByGroupLevelAllocation", () => {
  const categories = [makeCategory()];
  const demographics = makeDemographics();
  const population = 1_000_000;
  const totalPool = 600_000;
  const turnPool = 10_000;

  it("distributes all votes from the turn pool (no votes lost)", () => {
    const candidates = [
      makeCandidate({ candidateId: "alice", charEP: -2, charSP: -2 }),
      makeCandidate({ candidateId: "bob", charEP: 2, charSP: 2 }),
    ];

    const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap
    );

    const total = Object.values(votesPerCandidate).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(turnPool, -1);
  });

  it("shares sum to ~100%", () => {
    const candidates = [
      makeCandidate({ candidateId: "alice", charEP: -3, charSP: -3 }),
      makeCandidate({ candidateId: "bob", charEP: 3, charSP: 3 }),
    ];

    const { sharesPct } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap
    );

    const totalPct = Object.values(sharesPct).reduce((s, v) => s + v, 0);
    expect(totalPct).toBeCloseTo(100, 0);
  });

  it("equal candidates in symmetric demographics split evenly", () => {
    const candidates = [
      makeCandidate({ candidateId: "alice", charEP: 0, charSP: 0 }),
      makeCandidate({ candidateId: "bob", charEP: 0, charSP: 0 }),
    ];

    const { sharesPct } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap
    );

    expect(sharesPct.alice).toBeCloseTo(50, 0);
    expect(sharesPct.bob).toBeCloseTo(50, 0);
  });

  it("returns equal shares when totalPool is 0", () => {
    const candidates = [
      makeCandidate({ candidateId: "alice" }),
      makeCandidate({ candidateId: "bob" }),
    ];

    const { votesPerCandidate, sharesPct } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      0,
      population,
      demographics,
      categories,
      emptyOrgMap
    );

    expect(votesPerCandidate.alice).toBe(0);
    expect(sharesPct.alice).toBeCloseTo(50, 0);
  });

  it("L1: applyPartyFit shifts share toward the party-aligned candidate", () => {
    // Two same-party candidates: one perfectly party-aligned, one centrist
    // far from party. The lever should DIRECTIONALLY shift share toward the
    // aligned candidate when enabled, without changing any other input.
    // We don't assert a winner-flip because the magnitude depends on the
    // calibrated PRIMARY_PARTY_FIT_WEIGHT — the spec's sim-driven calibration
    // (Tasks 9-10) is what proves the value is correctly tuned.
    const aligned = makeCandidate({
      candidateId: "aligned",
      charEP: -3,
      charSP: -3,
      partyEcon: -3,
      partySocial: -3,
    });
    const centrist = makeCandidate({
      candidateId: "centrist",
      charEP: 0,
      charSP: 0,
      partyEcon: -3,
      partySocial: -3,
    });

    const baseOptions: DistributeVotesOptions = {
      useAveragedPositions: false,
      usePresidentialPartyOrg: true,
      includeInfluenceInAppeal: false,
      useNationalInfluenceForReach: true,
      presidentialPrimaryNationalReach: true,
      hasPlayerInRace: true,
    };

    const without = distributeVotesByGroupLevelAllocation(
      [aligned, centrist],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      baseOptions
    );
    const withFit = distributeVotesByGroupLevelAllocation(
      [aligned, centrist],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { ...baseOptions, applyPartyFit: true }
    );

    // Enabling applyPartyFit must shift votes AWAY from centrist and
    // TOWARD aligned, all else equal.
    expect(withFit.votesPerCandidate.aligned).toBeGreaterThan(without.votesPerCandidate.aligned);
    expect(withFit.votesPerCandidate.centrist).toBeLessThan(without.votesPerCandidate.centrist);
  });

  it("L1 (regional): stateOrgByCandidate scales the candidate's share", () => {
    // Identical Dem candidates; one has a level-10 PA org, the other has 0.
    // Total turn pool is conserved, so the org-funded candidate gains exactly
    // what the unfunded one loses.
    const funded = makeCandidate({
      candidateId: "funded",
      charEP: -3,
      charSP: -3,
      partyEcon: -3,
      partySocial: -3,
    });
    const unfunded = makeCandidate({
      candidateId: "unfunded",
      charEP: -3,
      charSP: -3,
      partyEcon: -3,
      partySocial: -3,
    });

    const baseOptions: DistributeVotesOptions = {
      useAveragedPositions: false,
      usePresidentialPartyOrg: true,
      includeInfluenceInAppeal: false,
      useNationalInfluenceForReach: true,
      presidentialPrimaryNationalReach: true,
      applyPartyFit: true,
      hasPlayerInRace: true,
      currentStateId: "PA",
    };

    const without = distributeVotesByGroupLevelAllocation(
      [funded, unfunded],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      baseOptions
    );
    const withOrg = distributeVotesByGroupLevelAllocation(
      [funded, unfunded],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { ...baseOptions, stateOrgByCandidate: new Map([["funded", 10]]) }
    );

    expect(withOrg.votesPerCandidate.funded).toBeGreaterThan(without.votesPerCandidate.funded);
    expect(withOrg.votesPerCandidate.unfunded).toBeLessThan(without.votesPerCandidate.unfunded);
  });

  it("presidential primary: partyInfluence scales the candidate's share", () => {
    const highClout = makeCandidate({
      candidateId: "highClout",
      charEP: -3,
      charSP: -3,
      partyEcon: -3,
      partySocial: -3,
      partyInfluence: 150,
    });
    const lowClout = makeCandidate({
      candidateId: "lowClout",
      charEP: -3,
      charSP: -3,
      partyEcon: -3,
      partySocial: -3,
      partyInfluence: 0,
    });

    const baseOptions: DistributeVotesOptions = {
      useAveragedPositions: false,
      usePresidentialPartyOrg: true,
      includeInfluenceInAppeal: false,
      useNationalInfluenceForReach: true,
      presidentialPrimaryNationalReach: true,
      applyPartyFit: true,
      hasPlayerInRace: true,
      currentStateId: "PA",
    };

    const result = distributeVotesByGroupLevelAllocation(
      [highClout, lowClout],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      baseOptions
    );

    expect(result.votesPerCandidate.highClout).toBeGreaterThan(result.votesPerCandidate.lowClout);
  });

  it("presidential primary: chairs get no inherent party-influence advantage (boost removed)", () => {
    // A national or state chair with the same party influence as a plain member
    // should score identically in every state — the chair multiplier was reverted.
    const chair = makeCandidate({
      candidateId: "chair",
      charEP: -3,
      charSP: -3,
      partyEcon: -3,
      partySocial: -3,
      partyInfluence: 100,
      partyChairRole: "national",
    });
    const stateChair = makeCandidate({
      candidateId: "chair",
      charEP: -3,
      charSP: -3,
      partyEcon: -3,
      partySocial: -3,
      partyInfluence: 100,
      partyChairRole: "state",
      stateChairStateIds: ["PA"],
    });
    const member = makeCandidate({
      candidateId: "member",
      charEP: -3,
      charSP: -3,
      partyEcon: -3,
      partySocial: -3,
      partyInfluence: 100,
      partyChairRole: null,
    });

    const base = {
      useAveragedPositions: false,
      usePresidentialPartyOrg: true,
      includeInfluenceInAppeal: false,
      useNationalInfluenceForReach: true,
      presidentialPrimaryNationalReach: true,
      applyPartyFit: true,
      hasPlayerInRace: true,
      countryId: "US" as const,
    };

    const run = (
      cand: ReturnType<typeof makeCandidate>,
      currentStateId: string
    ): { chair: number; member: number } => {
      const r = distributeVotesByGroupLevelAllocation(
        [cand, member],
        turnPool,
        totalPool,
        population,
        demographics,
        categories,
        emptyOrgMap,
        { ...base, currentStateId }
      );
      return { chair: r.votesPerCandidate.chair, member: r.votesPerCandidate.member };
    };

    // National chair — equal in every state (no +25%).
    const natPA = run(chair, "PA");
    expect(natPA.chair).toBeCloseTo(natPA.member, 5);
    // State chair — equal in chair state, adjacent, and far (no +15% anywhere).
    for (const st of ["PA", "NJ", "CA"]) {
      const r = run(stateChair, st);
      expect(r.chair).toBeCloseTo(r.member, 5);
    }
  });

  it("partyInfluence does not affect non-presidential-primary paths", () => {
    const highClout = makeCandidate({
      candidateId: "highClout",
      charEP: -3,
      charSP: -3,
      partyEcon: -3,
      partySocial: -3,
      partyInfluence: 150,
    });
    const lowClout = makeCandidate({
      candidateId: "lowClout",
      charEP: -3,
      charSP: -3,
      partyEcon: -3,
      partySocial: -3,
      partyInfluence: 0,
    });

    const result = distributeVotesByGroupLevelAllocation(
      [highClout, lowClout],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      {
        useAveragedPositions: false,
        useNationalInfluenceForReach: true,
        // no presidentialPrimaryNationalReach → general / non-PP path
        hasPlayerInRace: true,
      }
    );

    expect(result.votesPerCandidate.highClout).toBeCloseTo(result.votesPerCandidate.lowClout, 0);
  });

  it("L1 (regional): homeStateByCandidate fires only in the matching state", () => {
    // Two identical candidates with different home states; check that each
    // wins the state matching their home and loses the other.
    const homePa = makeCandidate({
      candidateId: "homePa",
      charEP: -3,
      charSP: -3,
      partyEcon: -3,
      partySocial: -3,
    });
    const homeCa = makeCandidate({
      candidateId: "homeCa",
      charEP: -3,
      charSP: -3,
      partyEcon: -3,
      partySocial: -3,
    });

    const baseOptions: DistributeVotesOptions = {
      useAveragedPositions: false,
      usePresidentialPartyOrg: true,
      includeInfluenceInAppeal: false,
      useNationalInfluenceForReach: true,
      presidentialPrimaryNationalReach: true,
      applyPartyFit: true,
      hasPlayerInRace: true,
      homeStateByCandidate: new Map([
        ["homePa", "PA"],
        ["homeCa", "CA"],
      ]),
    };

    const inPa = distributeVotesByGroupLevelAllocation(
      [homePa, homeCa],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { ...baseOptions, currentStateId: "PA" }
    );
    const inCa = distributeVotesByGroupLevelAllocation(
      [homePa, homeCa],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { ...baseOptions, currentStateId: "CA" }
    );

    expect(inPa.votesPerCandidate.homePa).toBeGreaterThan(inPa.votesPerCandidate.homeCa);
    expect(inCa.votesPerCandidate.homeCa).toBeGreaterThan(inCa.votesPerCandidate.homePa);
  });

  it("L1 (regional): stateOrgByCandidate caps at general bonus in general path", () => {
    // Identical Dem candidates; one has level-10 PA org. In the general path
    // (applyPartyFit: false, isGeneralElection: true) the cap is
    // MAX_STATE_ORG_BONUS_GENERAL (0.10) — so the lift is roughly ⅖ the
    // primary equivalent.
    const funded = makeCandidate({
      candidateId: "funded",
      charEP: -3,
      charSP: -3,
      partyEcon: -3,
      partySocial: -3,
    });
    const unfunded = makeCandidate({
      candidateId: "unfunded",
      charEP: -3,
      charSP: -3,
      partyEcon: -3,
      partySocial: -3,
    });

    const primaryOptions: DistributeVotesOptions = {
      useAveragedPositions: false,
      usePresidentialPartyOrg: true,
      includeInfluenceInAppeal: false,
      useNationalInfluenceForReach: true,
      presidentialPrimaryNationalReach: true,
      applyPartyFit: true,
      hasPlayerInRace: true,
      currentStateId: "PA",
      stateOrgByCandidate: new Map([["funded", 10]]),
    };
    const generalOptions: DistributeVotesOptions = {
      useAveragedPositions: true,
      usePresidentialPartyOrg: true,
      includeInfluenceInAppeal: false,
      useNationalInfluenceForReach: true,
      hasPlayerInRace: true,
      isGeneralElection: true,
      countryId: "US",
      currentStateId: "PA",
      stateOrgByCandidate: new Map([["funded", 10]]),
    };

    const primaryResult = distributeVotesByGroupLevelAllocation(
      [funded, unfunded],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      primaryOptions
    );
    const generalResult = distributeVotesByGroupLevelAllocation(
      [funded, unfunded],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      generalOptions
    );

    const primaryFundedShare =
      primaryResult.votesPerCandidate.funded /
      (primaryResult.votesPerCandidate.funded + primaryResult.votesPerCandidate.unfunded);
    const generalFundedShare =
      generalResult.votesPerCandidate.funded /
      (generalResult.votesPerCandidate.funded + generalResult.votesPerCandidate.unfunded);

    // General lift is smaller than primary lift but still > 50%.
    expect(generalFundedShare).toBeGreaterThan(0.5);
    expect(generalFundedShare).toBeLessThan(primaryFundedShare);
  });

  it("L1 (regional): homeStateByCandidate caps at general bonus in general path", () => {
    const homePa = makeCandidate({
      candidateId: "homePa",
      charEP: -3,
      charSP: -3,
      partyEcon: -3,
      partySocial: -3,
    });
    const homeCa = makeCandidate({
      candidateId: "homeCa",
      charEP: -3,
      charSP: -3,
      partyEcon: -3,
      partySocial: -3,
    });

    const baseOptions: DistributeVotesOptions = {
      useAveragedPositions: true,
      usePresidentialPartyOrg: true,
      includeInfluenceInAppeal: false,
      useNationalInfluenceForReach: true,
      hasPlayerInRace: true,
      isGeneralElection: true,
      countryId: "US",
      homeStateByCandidate: new Map([
        ["homePa", "PA"],
        ["homeCa", "CA"],
      ]),
    };

    const inPa = distributeVotesByGroupLevelAllocation(
      [homePa, homeCa],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { ...baseOptions, currentStateId: "PA" }
    );

    const paShare =
      inPa.votesPerCandidate.homePa /
      (inPa.votesPerCandidate.homePa + inPa.votesPerCandidate.homeCa);
    // General home cap is 0.05 → expected share ~ 1.05 / 2.05 ≈ 51.2%.
    expect(paShare).toBeGreaterThan(0.5);
    expect(paShare).toBeLessThan(0.53);
  });
});

// ─── Balance: candidate positioning ─────────────────────────────────────────

describe("balance: candidate positioning determines vote share", () => {
  const categories = [makeCategory()];
  const demographics = makeDemographics();
  const population = 1_000_000;
  const totalPool = 600_000;
  const turnPool = 10_000;

  it("left candidate wins liberal voters, right candidate wins conservative voters", () => {
    const candidates = [
      makeCandidate({ candidateId: "left", charEP: -3, charSP: -3 }),
      makeCandidate({ candidateId: "right", charEP: 3, charSP: 3 }),
    ];

    const { sharesPct } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap
    );

    // Symmetric demographics → roughly 50/50 but each dominates their base
    expect(sharesPct.left).toBeGreaterThan(40);
    expect(sharesPct.right).toBeGreaterThan(40);
    expect(Math.abs(sharesPct.left - sharesPct.right)).toBeLessThan(10);
  });

  it("centrist beats extremist in symmetric demographics", () => {
    const candidates = [
      makeCandidate({ candidateId: "centrist", charEP: 0, charSP: 0 }),
      makeCandidate({ candidateId: "extreme", charEP: 5, charSP: 5 }),
    ];

    const { sharesPct } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap
    );

    expect(sharesPct.centrist).toBeGreaterThan(sharesPct.extreme);
  });

  it("candidate aligned with majority demographic wins", () => {
    const leftLeaningState = makeDemographics({
      groups: {
        liberal: { population: 65, turnout: 60, economicLean: -3, socialLean: -3 },
        conservative: { population: 35, turnout: 60, economicLean: 3, socialLean: 3 },
      },
    });

    const candidates = [
      makeCandidate({ candidateId: "left", charEP: -3, charSP: -3 }),
      makeCandidate({ candidateId: "right", charEP: 3, charSP: 3 }),
    ];

    const { sharesPct } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      leftLeaningState,
      categories,
      emptyOrgMap
    );

    expect(sharesPct.left).toBeGreaterThan(sharesPct.right);
    // The margin should be meaningful — 65/35 population split
    expect(sharesPct.left - sharesPct.right).toBeGreaterThan(10);
  });

  it("higher turnout for one group shifts the outcome", () => {
    const highConservativeTurnout = makeDemographics({
      groups: {
        liberal: { population: 55, turnout: 40, economicLean: -3, socialLean: -3 },
        conservative: { population: 45, turnout: 80, economicLean: 3, socialLean: 3 },
      },
    });

    const candidates = [
      makeCandidate({ candidateId: "left", charEP: -3, charSP: -3 }),
      makeCandidate({ candidateId: "right", charEP: 3, charSP: 3 }),
    ];

    const { sharesPct } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      highConservativeTurnout,
      categories,
      emptyOrgMap
    );

    // Despite having fewer people, conservatives vote more → right should win
    expect(sharesPct.right).toBeGreaterThan(sharesPct.left);
  });
});

// ─── Reg% wire-through (Phase F) ────────────────────────────────────────────

describe("regByParty entrenchment multiplier", () => {
  const categories = [makeCategory()];
  const demographics = makeDemographics();
  const population = 1_000_000;
  const totalPool = 600_000;
  const turnPool = 10_000;

  it("higher own-Reg shifts share toward the entrenched party in general elections", () => {
    const candidates = [
      makeCandidate({ candidateId: "alice", party: "dem", charEP: 0, charSP: 0 }),
      makeCandidate({ candidateId: "bob", party: "gop", charEP: 0, charSP: 0 }),
    ];
    // Equal Org so the formula's other factors are neutralized.
    const orgMap = new Map([
      ["dem", 30],
      ["gop", 30],
    ]);

    const baseline = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      orgMap,
      { isGeneralElection: true } as DistributeVotesOptions
    );

    const withRegTilt = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      orgMap,
      {
        isGeneralElection: true,
        regByParty: new Map([
          ["dem", 60], // 1.18× resistance multiplier
          ["gop", 20], // 1.06× resistance multiplier
        ]),
      } as DistributeVotesOptions
    );

    // Baseline: roughly even (orgs equal). Tilt: alice (DEM) gains share.
    expect(withRegTilt.sharesPct.alice).toBeGreaterThan(baseline.sharesPct.alice);
    expect(withRegTilt.sharesPct.bob).toBeLessThan(baseline.sharesPct.bob);
  });

  it("Reg% has no effect in primary elections", () => {
    const candidates = [
      makeCandidate({ candidateId: "alice", party: "dem", charEP: 0, charSP: 0 }),
      makeCandidate({ candidateId: "bob", party: "dem", charEP: 0, charSP: 0 }),
    ];
    const orgMap = new Map([["dem", 30]]);
    // Setting regByParty in a primary should not change shares.
    const withReg = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      orgMap,
      {
        isGeneralElection: false,
        regByParty: new Map([["dem", 100]]),
      } as DistributeVotesOptions
    );
    const withoutReg = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      orgMap,
      { isGeneralElection: false } as DistributeVotesOptions
    );
    expect(withReg.sharesPct.alice).toBeCloseTo(withoutReg.sharesPct.alice, 1);
    expect(withReg.sharesPct.bob).toBeCloseTo(withoutReg.sharesPct.bob, 1);
  });

  it("undefined / missing entries fall back to neutral 1.0× (no crash, no skew)", () => {
    const candidates = [
      makeCandidate({ candidateId: "alice", party: "dem", charEP: 0, charSP: 0 }),
      makeCandidate({ candidateId: "bob", party: "gop", charEP: 0, charSP: 0 }),
    ];
    const orgMap = new Map([
      ["dem", 30],
      ["gop", 30],
    ]);
    // regByParty omitted entirely → both candidates get 1.0× resistance.
    const result = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      orgMap,
      { isGeneralElection: true } as DistributeVotesOptions
    );
    expect(Math.abs(result.sharesPct.alice - result.sharesPct.bob)).toBeLessThan(2);
  });
});

// ─── Balance: favorability ──────────────────────────────────────────────────

describe("balance: favorability impacts vote share", () => {
  const categories = [makeCategory()];
  const demographics = makeDemographics();
  const population = 1_000_000;
  const totalPool = 600_000;
  const turnPool = 10_000;

  it("high favorability candidate outperforms low favorability at same position", () => {
    const candidates = [
      makeCandidate({ candidateId: "popular", charEP: 0, charSP: 0, favorability: 80 }),
      makeCandidate({ candidateId: "unpopular", charEP: 0, charSP: 0, favorability: 20 }),
    ];

    const { sharesPct } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap
    );

    expect(sharesPct.popular).toBeGreaterThan(sharesPct.unpopular);
    // 80 vs 20 favorability → approval scalars 0.8 vs 0.2 → should be ~4:1 ratio
    expect(sharesPct.popular / sharesPct.unpopular).toBeGreaterThan(2.5);
  });

  it("zero favorability candidate gets effectively no votes", () => {
    const candidates = [
      makeCandidate({ candidateId: "popular", charEP: 0, charSP: 0, favorability: 50 }),
      makeCandidate({ candidateId: "hated", charEP: 0, charSP: 0, favorability: 0 }),
    ];

    const { sharesPct } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap
    );

    expect(sharesPct.hated).toBeLessThan(1);
  });

  it("favorability advantage can overcome position disadvantage in balanced state", () => {
    // In balanced state, huge favorability gap should overcome moderate position gap
    const balancedState = makeDemographics({
      groups: {
        liberal: { population: 50, turnout: 60, economicLean: -2, socialLean: -2 },
        conservative: { population: 50, turnout: 60, economicLean: 2, socialLean: 2 },
      },
    });

    const candidates = [
      makeCandidate({ candidateId: "popular_left", charEP: -1, charSP: -1, favorability: 90 }),
      makeCandidate({ candidateId: "hated_right", charEP: 2, charSP: 2, favorability: 10 }),
    ];

    const { sharesPct } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      balancedState,
      categories,
      emptyOrgMap
    );

    // 90 vs 10 favorability → approval scalar 0.9 vs 0.1 → ~9:1 advantage overcomes position
    expect(sharesPct.popular_left).toBeGreaterThan(sharesPct.hated_right);
  });

  it("position advantage can overcome moderate favorability gap in skewed state", () => {
    // In a heavily right-leaning state, position dominance can beat a favorability edge
    const rightLeaningState = makeDemographics({
      groups: {
        liberal: { population: 30, turnout: 60, economicLean: -2, socialLean: -2 },
        conservative: { population: 70, turnout: 60, economicLean: 3, socialLean: 3 },
      },
    });

    const candidates = [
      makeCandidate({ candidateId: "popular_left", charEP: -3, charSP: -3, favorability: 70 }),
      makeCandidate({ candidateId: "okay_right", charEP: 3, charSP: 3, favorability: 40 }),
    ];

    const { sharesPct } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      rightLeaningState,
      categories,
      emptyOrgMap
    );

    // Even with lower favorability, the right candidate should win in a 70/30 right state
    expect(sharesPct.okay_right).toBeGreaterThan(sharesPct.popular_left);
  });
});

// ─── Balance: political influence (NPI/reach) ───────────────────────────────

describe("balance: political influence provides meaningful but bounded advantage", () => {
  const categories = [makeCategory()];
  const demographics = makeDemographics();
  const population = 1_000_000;
  const totalPool = 600_000;
  const turnPool = 10_000;

  it("higher NPI candidate gets more votes", () => {
    const candidates = [
      makeCandidate({ candidateId: "famous", charEP: 0, charSP: 0, politicalInfluence: 300 }),
      makeCandidate({ candidateId: "unknown", charEP: 0, charSP: 0, politicalInfluence: 20 }),
    ];

    const { sharesPct } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap
    );

    expect(sharesPct.famous).toBeGreaterThan(sharesPct.unknown);
  });

  it("NPI advantage saturates — 10x NPI is not 10x votes (sqrt clamp at PI=100)", () => {
    const candidates = [
      makeCandidate({ candidateId: "high", charEP: 0, charSP: 0, politicalInfluence: 500 }),
      makeCandidate({ candidateId: "low", charEP: 0, charSP: 0, politicalInfluence: 50 }),
    ];

    const { sharesPct } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap
    );

    // 10x NPI difference should NOT result in 10x vote share
    expect(sharesPct.high / sharesPct.low).toBeLessThan(5);
  });

  it("good positioning can overcome NPI disadvantage", () => {
    const leftLeaningState = makeDemographics({
      groups: {
        liberal: { population: 70, turnout: 65, economicLean: -4, socialLean: -3 },
        conservative: { population: 30, turnout: 55, economicLean: 2, socialLean: 2 },
      },
    });

    const candidates = [
      makeCandidate({
        candidateId: "aligned_weak",
        charEP: -3,
        charSP: -3,
        politicalInfluence: 30,
      }),
      makeCandidate({
        candidateId: "misaligned_famous",
        charEP: 5,
        charSP: 5,
        politicalInfluence: 500,
      }),
    ];

    const { sharesPct } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      leftLeaningState,
      categories,
      emptyOrgMap
    );

    // Despite much lower NPI, the aligned candidate should win in a heavily liberal state
    expect(sharesPct.aligned_weak).toBeGreaterThan(sharesPct.misaligned_famous);
  });
});

// ─── Balance: party organization ────────────────────────────────────────────

describe("balance: party organization scales vote share", () => {
  const categories = [makeCategory()];
  const demographics = makeDemographics();
  const population = 1_000_000;
  const totalPool = 600_000;
  const turnPool = 10_000;

  it("party with high org outperforms party with low org (general election)", () => {
    // Org is a general-election driver: normalizedOrgShare → dem 90/120 = 0.75,
    // gop 30/120 = 0.25.
    const orgMap = new Map([
      ["democrat", 90],
      ["republican", 30],
    ]);

    const candidates = [
      makeCandidate({ candidateId: "dem", party: "democrat", charEP: 0, charSP: 0 }),
      makeCandidate({ candidateId: "gop", party: "republican", charEP: 0, charSP: 0 }),
    ];

    const { sharesPct } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      orgMap,
      { isGeneralElection: true }
    );

    expect(sharesPct.dem).toBeGreaterThan(sharesPct.gop);
  });

  it("Org does not differentiate candidates in a primary (intra-party, org-neutral)", () => {
    // Primaries are intra-party: every candidate shares the same party Org, so
    // the engine applies a uniform neutral 1× and Org never tilts the result.
    // (Retired 2026-06-18: the legacy partyOrgScalar used to tilt this path.)
    const orgMap = new Map([["democrat", 50]]);

    const candidates = [
      makeCandidate({ candidateId: "dem", party: "democrat", charEP: 0, charSP: 0 }),
      makeCandidate({ candidateId: "ind", party: "independent", charEP: 0, charSP: 0 }),
    ];

    const { sharesPct } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      orgMap
      // no isGeneralElection → primary path
    );

    expect(sharesPct.dem).toBe(sharesPct.ind);
  });
});

// ─── FPTP spoiler effect ────────────────────────────────────────────────────

describe("FPTP spoiler effect", () => {
  const categories = [makeCategory()];
  const demographics = makeDemographics();
  const population = 1_000_000;
  const totalPool = 600_000;
  const turnPool = 10_000;
  const generalOpts: DistributeVotesOptions = {
    isGeneralElection: true,
    votingSystem: "fptp",
    countryId: "US",
  };

  it("third party draws votes from ideologically nearest major party", () => {
    const candidates = [
      makeCandidate({ candidateId: "dem", party: "democrat", charEP: -3, charSP: -3 }),
      makeCandidate({ candidateId: "gop", party: "republican", charEP: 3, charSP: 3 }),
      makeCandidate({ candidateId: "green", party: "green", charEP: -4, charSP: -4 }),
    ];

    const withSpoiler = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      generalOpts
    );

    const withoutSpoiler = distributeVotesByGroupLevelAllocation(
      [candidates[0], candidates[1]],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      generalOpts
    );

    // Democrat should lose votes when Green is present (spoiler)
    expect(withSpoiler.votesPerCandidate.dem).toBeLessThan(withoutSpoiler.votesPerCandidate.dem);
    // Republican should be mostly unaffected (Green is far from GOP)
    // Green takes from Dem, not GOP
    expect(withSpoiler.votesPerCandidate.green).toBeGreaterThan(0);
  });

  it("no spoiler effect in primaries", () => {
    const candidates = [
      makeCandidate({ candidateId: "dem", party: "democrat", charEP: -3, charSP: -3 }),
      makeCandidate({ candidateId: "gop", party: "republican", charEP: 3, charSP: 3 }),
      makeCandidate({ candidateId: "green", party: "green", charEP: -4, charSP: -4 }),
    ];

    const primaryResult = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { isGeneralElection: false, votingSystem: "fptp", countryId: "US" }
    );

    const noFlagsResult = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap
    );

    // Both should be identical — no spoiler in primaries or when flag not set
    expect(primaryResult.votesPerCandidate.dem).toBeCloseTo(noFlagsResult.votesPerCandidate.dem, 2);
  });

  it("no spoiler effect under RCV", () => {
    const candidates = [
      makeCandidate({ candidateId: "dem", party: "democrat", charEP: -3, charSP: -3 }),
      makeCandidate({ candidateId: "gop", party: "republican", charEP: 3, charSP: 3 }),
      makeCandidate({ candidateId: "green", party: "green", charEP: -4, charSP: -4 }),
    ];

    const rcvResult = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { isGeneralElection: true, votingSystem: "rcv", countryId: "US" }
    );

    const fptpResult = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { isGeneralElection: true, votingSystem: "fptp", countryId: "US" }
    );

    // Under RCV, Dem should retain more votes (no spoiler drain)
    expect(rcvResult.votesPerCandidate.dem).toBeGreaterThan(fptpResult.votesPerCandidate.dem);
  });

  it("recognizes sequential US major-party IDs", () => {
    const candidates = [
      makeCandidate({ candidateId: "dem", party: "1", charEP: -3, charSP: -3 }),
      makeCandidate({ candidateId: "gop", party: "2", charEP: 3, charSP: 3 }),
      makeCandidate({ candidateId: "green", party: "3", charEP: -4, charSP: -4 }),
    ];

    const withSpoiler = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      generalOpts
    );

    const withoutSpoiler = distributeVotesByGroupLevelAllocation(
      [candidates[0], candidates[1]],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      generalOpts
    );

    expect(withSpoiler.votesPerCandidate.dem).toBeLessThan(withoutSpoiler.votesPerCandidate.dem);
  });

  it("org-aware spoiler scales with local third-party organization", () => {
    const candidates = [
      makeCandidate({ candidateId: "dem", party: "1", charEP: -3, charSP: -3 }),
      makeCandidate({ candidateId: "gop", party: "2", charEP: 3, charSP: 3 }),
      makeCandidate({ candidateId: "green", party: "3", charEP: -4, charSP: -4 }),
    ];

    const protectedMajor = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      new Map([
        ["1", 90],
        ["2", 50],
        ["3", 0],
      ]),
      { ...generalOpts, useOrgAwareSpoiler: true }
    );

    const strongThirdParty = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      new Map([
        ["1", 0],
        ["2", 50],
        ["3", 90],
      ]),
      { ...generalOpts, useOrgAwareSpoiler: true }
    );

    expect(strongThirdParty.votesPerCandidate.dem).toBeLessThan(
      protectedMajor.votesPerCandidate.dem
    );
    expect(strongThirdParty.votesPerCandidate.green).toBeGreaterThan(
      protectedMajor.votesPerCandidate.green
    );
  });

  it("stronger third party causes more spoiling", () => {
    const weakThird = [
      makeCandidate({ candidateId: "dem", party: "democrat", charEP: -3, charSP: -3 }),
      makeCandidate({ candidateId: "gop", party: "republican", charEP: 3, charSP: 3 }),
      makeCandidate({
        candidateId: "green",
        party: "green",
        charEP: -4,
        charSP: -4,
        politicalInfluence: 20,
        favorability: 20,
      }),
    ];

    const strongThird = [
      makeCandidate({ candidateId: "dem", party: "democrat", charEP: -3, charSP: -3 }),
      makeCandidate({ candidateId: "gop", party: "republican", charEP: 3, charSP: 3 }),
      makeCandidate({
        candidateId: "green",
        party: "green",
        charEP: -4,
        charSP: -4,
        politicalInfluence: 200,
        favorability: 70,
      }),
    ];

    const weakResult = distributeVotesByGroupLevelAllocation(
      weakThird,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      generalOpts
    );

    const strongResult = distributeVotesByGroupLevelAllocation(
      strongThird,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      generalOpts
    );

    // Dem loses more votes to a stronger Green party
    expect(strongResult.votesPerCandidate.dem).toBeLessThan(weakResult.votesPerCandidate.dem);
  });
});

// ─── Balance: three-way and multi-candidate races ───────────────────────────

describe("balance: multi-candidate races", () => {
  const categories = [makeCategory()];
  const demographics = makeDemographics();
  const population = 1_000_000;
  const totalPool = 600_000;
  const turnPool = 10_000;

  it("three equally positioned candidates split evenly", () => {
    const candidates = [
      makeCandidate({ candidateId: "a", charEP: 0, charSP: 0 }),
      makeCandidate({ candidateId: "b", charEP: 0, charSP: 0 }),
      makeCandidate({ candidateId: "c", charEP: 0, charSP: 0 }),
    ];

    const { sharesPct } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap
    );

    expect(sharesPct.a).toBeCloseTo(33.3, 0);
    expect(sharesPct.b).toBeCloseTo(33.3, 0);
    expect(sharesPct.c).toBeCloseTo(33.3, 0);
  });

  it("adding a fourth candidate compresses everyone else's share", () => {
    const three = [
      makeCandidate({ candidateId: "a", charEP: -2, charSP: -2 }),
      makeCandidate({ candidateId: "b", charEP: 0, charSP: 0 }),
      makeCandidate({ candidateId: "c", charEP: 2, charSP: 2 }),
    ];

    const four = [...three, makeCandidate({ candidateId: "d", charEP: 1, charSP: 1 })];

    const threeResult = distributeVotesByGroupLevelAllocation(
      three,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap
    );
    const fourResult = distributeVotesByGroupLevelAllocation(
      four,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap
    );

    // Everyone's share should drop (or stay same if d is stealing from others)
    const totalShareThree =
      threeResult.sharesPct.a + threeResult.sharesPct.b + threeResult.sharesPct.c;
    const totalShareFourExD =
      fourResult.sharesPct.a + fourResult.sharesPct.b + fourResult.sharesPct.c;
    expect(totalShareFourExD).toBeLessThan(totalShareThree);
  });

  it("single candidate gets 100% of votes", () => {
    const candidates = [makeCandidate({ candidateId: "solo", charEP: 0, charSP: 0 })];

    const { sharesPct, votesPerCandidate } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap
    );

    expect(sharesPct.solo).toBe(100);
    expect(votesPerCandidate.solo).toBeCloseTo(turnPool, -1);
  });
});

// ─── NPP general-election weight penalty ────────────────────────────────────

describe("NPP_GENERAL_WEIGHT_MULTIPLIER: NPP handicap when player is in race", () => {
  const categories = [makeCategory()];
  const demographics = makeDemographics();
  const population = 1_000_000;
  const totalPool = 600_000;
  const turnPool = 10_000;

  it("NPP gets fewer votes when hasPlayerInRace=true vs false (same position)", () => {
    // Player and NPP at identical position and favorability — only the flag changes.
    const playerCandidate = makeCandidate({
      candidateId: "player",
      charEP: 0,
      charSP: 0,
      favorability: 50,
      isNPP: false,
    });
    const nppCandidate = makeCandidate({
      candidateId: "npp",
      charEP: 0,
      charSP: 0,
      favorability: 50,
      isNPP: true,
    });

    const withPenalty = distributeVotesByGroupLevelAllocation(
      [playerCandidate, nppCandidate],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { hasPlayerInRace: true }
    );

    const withoutPenalty = distributeVotesByGroupLevelAllocation(
      [playerCandidate, nppCandidate],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { hasPlayerInRace: false }
    );

    // NPP should get fewer votes when the player flag is active
    expect(withPenalty.votesPerCandidate.npp).toBeLessThan(withoutPenalty.votesPerCandidate.npp);
    // Player gets correspondingly more
    expect(withPenalty.votesPerCandidate.player).toBeGreaterThan(
      withoutPenalty.votesPerCandidate.player
    );
  });

  it("NPP penalty is approximately 0.8× (NPP_GENERAL_WEIGHT_MULTIPLIER)", () => {
    // Isolate the penalty: single NPP vs single player, no org, identical positions.
    // Because weight = appeal * reach * approval * org * nppPenalty,
    // the NPP share should be ~0.8 / (1 + 0.8) ≈ 44.4%, player ~55.6%.
    const player = makeCandidate({ candidateId: "player", isNPP: false, charEP: 0, charSP: 0 });
    const npp = makeCandidate({ candidateId: "npp", isNPP: true, charEP: 0, charSP: 0 });

    const { sharesPct } = distributeVotesByGroupLevelAllocation(
      [player, npp],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { hasPlayerInRace: true }
    );

    // NPP_GENERAL_WEIGHT_MULTIPLIER = 0.8 → NPP gets 0.8/(1+0.8)=44.4%
    expect(sharesPct.npp).toBeCloseTo(44.4, 0);
    expect(sharesPct.player).toBeCloseTo(55.6, 0);
  });

  it("NPP penalty does not apply when hasPlayerInRace=false (NPP vs NPP race)", () => {
    const npp1 = makeCandidate({ candidateId: "npp1", isNPP: true, charEP: 0, charSP: 0 });
    const npp2 = makeCandidate({ candidateId: "npp2", isNPP: true, charEP: 0, charSP: 0 });

    const { sharesPct } = distributeVotesByGroupLevelAllocation(
      [npp1, npp2],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { hasPlayerInRace: false }
    );

    // Both NPPs at same position with no penalty → equal split
    expect(sharesPct.npp1).toBeCloseTo(50, 0);
    expect(sharesPct.npp2).toBeCloseTo(50, 0);
  });

  it("multiple NPPs all receive the 0.8× penalty against a single player", () => {
    const player = makeCandidate({ candidateId: "player", isNPP: false, charEP: 0, charSP: 0 });
    const npp1 = makeCandidate({ candidateId: "npp1", isNPP: true, charEP: 0, charSP: 0 });
    const npp2 = makeCandidate({ candidateId: "npp2", isNPP: true, charEP: 0, charSP: 0 });

    const { sharesPct } = distributeVotesByGroupLevelAllocation(
      [player, npp1, npp2],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { hasPlayerInRace: true }
    );

    // player weight=1, each NPP weight=0.8 → total=2.6
    // player=1/2.6≈38.5%, each NPP=0.8/2.6≈30.8%
    expect(sharesPct.player).toBeGreaterThan(sharesPct.npp1);
    expect(sharesPct.player).toBeGreaterThan(sharesPct.npp2);
    expect(sharesPct.npp1).toBeCloseTo(sharesPct.npp2, 0);
  });
});

// ─── Live turnout overrides ──────────────────────────────────────────────────

describe("liveTurnouts: dynamic turnout overrides stored demographic values", () => {
  const categories = [makeCategory()];
  const population = 1_000_000;
  const totalPool = 600_000;
  const turnPool = 10_000;

  it("liveTurnouts override stored turnout rates", () => {
    // Demographics store 60% turnout for both groups.
    // liveTurnouts sets liberals to 90%, conservatives to 30%.
    // In a balanced state this should shift votes toward the left candidate.
    const balancedDemographics = makeDemographics({
      groups: {
        liberal: { population: 50, turnout: 60, economicLean: -3, socialLean: -3 },
        conservative: { population: 50, turnout: 60, economicLean: 3, socialLean: 3 },
      },
    });

    const leftCandidate = makeCandidate({ candidateId: "left", charEP: -3, charSP: -3 });
    const rightCandidate = makeCandidate({ candidateId: "right", charEP: 3, charSP: 3 });

    // Without live turnouts: balanced → roughly 50/50
    const withoutOverride = distributeVotesByGroupLevelAllocation(
      [leftCandidate, rightCandidate],
      turnPool,
      totalPool,
      population,
      balancedDemographics,
      categories,
      emptyOrgMap
    );

    // With live turnouts boosting liberals: left should gain votes
    const withOverride = distributeVotesByGroupLevelAllocation(
      [leftCandidate, rightCandidate],
      turnPool,
      totalPool,
      population,
      balancedDemographics,
      categories,
      emptyOrgMap,
      { liveTurnouts: { liberal: 90, conservative: 30 } }
    );

    expect(withOverride.sharesPct.left).toBeGreaterThan(withoutOverride.sharesPct.left);
    expect(withOverride.sharesPct.right).toBeLessThan(withoutOverride.sharesPct.right);
  });

  it("liveTurnouts of 0 for a group effectively removes that group's votes", () => {
    // Suppress conservative turnout entirely — left should get near 100%
    const demographics = makeDemographics({
      groups: {
        liberal: { population: 50, turnout: 60, economicLean: -3, socialLean: -3 },
        conservative: { population: 50, turnout: 60, economicLean: 3, socialLean: 3 },
      },
    });

    const { sharesPct } = distributeVotesByGroupLevelAllocation(
      [
        makeCandidate({ candidateId: "left", charEP: -3, charSP: -3 }),
        makeCandidate({ candidateId: "right", charEP: 3, charSP: 3 }),
      ],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { liveTurnouts: { liberal: 60, conservative: 0 } }
    );

    // With conservatives suppressed to 0, right candidate gets ~0 votes
    expect(sharesPct.left).toBeGreaterThan(90);
    expect(sharesPct.right).toBeLessThan(10);
  });

  it("liveTurnouts for only one group leaves the other group at stored rate", () => {
    // Override only the liberal group; conservatives should use stored 60%
    const demographics = makeDemographics({
      groups: {
        liberal: { population: 50, turnout: 60, economicLean: -3, socialLean: -3 },
        conservative: { population: 50, turnout: 60, economicLean: 3, socialLean: 3 },
      },
    });

    const withLibBoost = distributeVotesByGroupLevelAllocation(
      [
        makeCandidate({ candidateId: "left", charEP: -3, charSP: -3 }),
        makeCandidate({ candidateId: "right", charEP: 3, charSP: 3 }),
      ],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { liveTurnouts: { liberal: 90 } } // conservatives fall through to stored 60%
    );

    // Liberal boost → left should lead
    expect(withLibBoost.sharesPct.left).toBeGreaterThan(50);
  });
});

// ─── Averaged positions (party + candidate blend) ───────────────────────────

describe("useAveragedPositions: party-candidate position blending", () => {
  const categories = [makeCategory()];
  const demographics = makeDemographics();
  const population = 1_000_000;
  const totalPool = 600_000;
  const turnPool = 10_000;

  it("candidate with moderate personal position inherits party extreme when averaged", () => {
    // Candidate is at 0,0 but party is at 5,5 (far right).
    // Averaged with default weight (1): position = (5+0)/(1+1) = 2.5,2.5.
    // Without averaging: candidate at 0 appeals equally to both groups.
    // With averaging: candidate pulled right → right wins in balanced state.
    const candidates = [
      makeCandidate({
        candidateId: "moderate_right_party",
        charEP: 0,
        charSP: 0,
        partyEcon: 5,
        partySocial: 5,
      }),
      makeCandidate({
        candidateId: "centrist",
        charEP: 0,
        charSP: 0,
        // No partyEcon/partySocial → not averaged
      }),
    ];

    const withoutAveraging = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { useAveragedPositions: false }
    );

    const withAveraging = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { useAveragedPositions: true, partyPositionWeight: 1 }
    );

    // Without averaging: both candidates at 0,0 → ~50/50
    expect(withoutAveraging.sharesPct.moderate_right_party).toBeCloseTo(50, 0);

    // With averaging: moderate_right_party pulled to 2.5,2.5 — conservative bloc
    // should shift toward them, but in balanced state it adjusts the split from 50/50
    // The averaged candidate is no longer centered → less symmetric result
    expect(withAveraging.sharesPct.moderate_right_party).not.toBeCloseTo(50, 0);
  });

  it("higher partyPositionWeight makes party position dominate", () => {
    // Same setup: candidate at 0,0, party at -5,-5 (far left).
    // partyWeight=1: pos = (-5+0)/2 = -2.5 (pulls moderately left)
    // partyWeight=4: pos = (4*-5+0)/5 = -4.0 (pulls strongly left)
    const candidatesWeightOne = [
      makeCandidate({
        candidateId: "target",
        charEP: 0,
        charSP: 0,
        partyEcon: -5,
        partySocial: -5,
      }),
      makeCandidate({ candidateId: "right", charEP: 3, charSP: 3 }),
    ];
    const candidatesWeightFour = [
      makeCandidate({
        candidateId: "target",
        charEP: 0,
        charSP: 0,
        partyEcon: -5,
        partySocial: -5,
      }),
      makeCandidate({ candidateId: "right", charEP: 3, charSP: 3 }),
    ];

    const weight1Result = distributeVotesByGroupLevelAllocation(
      candidatesWeightOne,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { useAveragedPositions: true, partyPositionWeight: 1 }
    );

    const weight4Result = distributeVotesByGroupLevelAllocation(
      candidatesWeightFour,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { useAveragedPositions: true, partyPositionWeight: 4 }
    );

    // With a heavier party weight, the candidate is pulled further left.
    // In a balanced state, more extreme left position is slightly worse → target gets fewer votes
    // (balanced state has equal liberal+conservative; centrist is optimal)
    // A stronger left pull means appeal to conservatives drops more.
    // Note: sharesPct is integer-rounded so small differences may not register.
    expect(weight4Result.sharesPct.target).toBeLessThanOrEqual(weight1Result.sharesPct.target);
  });

  it("averaged positions with no partyEcon/partySocial fallback to candidate-only", () => {
    // Even with useAveragedPositions=true, if partyEcon/partySocial are absent,
    // the candidate's own position is used unchanged.
    const candidates = [
      makeCandidate({ candidateId: "a", charEP: -3, charSP: -3 }), // no partyEcon
      makeCandidate({ candidateId: "b", charEP: 3, charSP: 3 }),
    ];

    const withFlag = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { useAveragedPositions: true }
    );

    const withoutFlag = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { useAveragedPositions: false }
    );

    // No party positions set → both modes should produce identical results
    expect(withFlag.sharesPct.a).toBeCloseTo(withoutFlag.sharesPct.a, 0);
    expect(withFlag.sharesPct.b).toBeCloseTo(withoutFlag.sharesPct.b, 0);
  });
});

// ─── useNationalInfluenceForReach ────────────────────────────────────────────

describe("useNationalInfluenceForReach: national vs state-level reach", () => {
  const categories = [makeCategory()];
  const demographics = makeDemographics();
  const population = 1_000_000;
  const totalPool = 600_000;
  const turnPool = 10_000;

  it("nationally famous but state-obscure candidate benefits from national reach flag", () => {
    // Candidate A: high nationalInfluence (100), low politicalInfluence (20)
    // Candidate B: high politicalInfluence (100), low nationalInfluence (20)
    // Without flag: state-level reach → B wins on reach
    // With flag: national reach → A wins on reach
    const candidateA = makeCandidate({
      candidateId: "national_star",
      charEP: 0,
      charSP: 0,
      nationalInfluence: 500,
      politicalInfluence: 20,
    });
    const candidateB = makeCandidate({
      candidateId: "local_star",
      charEP: 0,
      charSP: 0,
      nationalInfluence: 20,
      politicalInfluence: 500,
    });

    const stateResult = distributeVotesByGroupLevelAllocation(
      [candidateA, candidateB],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { useNationalInfluenceForReach: false }
    );

    const nationalResult = distributeVotesByGroupLevelAllocation(
      [candidateA, candidateB],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { useNationalInfluenceForReach: true }
    );

    // State reach: local_star dominates
    expect(stateResult.sharesPct.local_star).toBeGreaterThan(stateResult.sharesPct.national_star);
    // National reach: national_star dominates
    expect(nationalResult.sharesPct.national_star).toBeGreaterThan(
      nationalResult.sharesPct.local_star
    );
  });
});

// ─── UK region-specific major-party set ─────────────────────────────────────

describe("FPTP spoiler: UK region-specific major party sets", () => {
  const categories = [makeCategory()];
  const demographics = makeDemographics();
  const population = 1_000_000;
  const totalPool = 600_000;
  const turnPool = 10_000;

  it("in Scotland (SCO), SNP and Labour are majors — Tory is a third party (spoiler)", () => {
    // SNP and Labour are major parties in SCO.
    // uk_conservative is a third party → should spoil the nearest major (Labour).
    const candidates = [
      makeCandidate({ candidateId: "snp", party: "uk_snp", charEP: -2, charSP: -3 }),
      makeCandidate({ candidateId: "labour", party: "uk_labour", charEP: -1, charSP: -2 }),
      makeCandidate({ candidateId: "tory", party: "uk_conservative", charEP: 3, charSP: 3 }),
    ];

    const withSpoiler = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      {
        isGeneralElection: true,
        votingSystem: "fptp",
        countryId: "UK",
        parentRegionId: "SCO",
      }
    );

    const withoutTory = distributeVotesByGroupLevelAllocation(
      [candidates[0], candidates[1]],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      {
        isGeneralElection: true,
        votingSystem: "fptp",
        countryId: "UK",
        parentRegionId: "SCO",
      }
    );

    // Tory (third party) should gain votes via spoiler transfer from nearest major
    expect(withSpoiler.votesPerCandidate.tory).toBeGreaterThan(0);
    // SNP or Labour should lose some votes compared to the 2-candidate race
    const majorLossWithSpoiler =
      withoutTory.votesPerCandidate.snp +
      withoutTory.votesPerCandidate.labour -
      (withSpoiler.votesPerCandidate.snp + withSpoiler.votesPerCandidate.labour);
    expect(majorLossWithSpoiler).toBeGreaterThan(0);
  });

  it("in England (default UK), Labour and Conservative are majors — Lib Dem spoils", () => {
    // In England, uk_labour and uk_conservative are major parties.
    // A uk_libdem candidate in the middle would spoil whoever is nearest.
    const candidates = [
      makeCandidate({ candidateId: "labour", party: "uk_labour", charEP: -2, charSP: -2 }),
      makeCandidate({ candidateId: "tory", party: "uk_conservative", charEP: 2, charSP: 2 }),
      makeCandidate({ candidateId: "libdem", party: "uk_libdem", charEP: -1, charSP: -1 }),
    ];

    const withLibDem = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      {
        isGeneralElection: true,
        votingSystem: "fptp",
        countryId: "UK",
        // No parentRegionId → defaults to England: labour + tory are majors
      }
    );

    const withoutLibDem = distributeVotesByGroupLevelAllocation(
      [candidates[0], candidates[1]],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      {
        isGeneralElection: true,
        votingSystem: "fptp",
        countryId: "UK",
      }
    );

    // Lib Dem (third party) draws from nearest major (Labour, since libdem is closer to -2,-2)
    expect(withLibDem.votesPerCandidate.libdem).toBeGreaterThan(0);
    // Labour loses votes to Lib Dem
    expect(withLibDem.votesPerCandidate.labour).toBeLessThan(
      withoutLibDem.votesPerCandidate.labour
    );
    // Tory barely affected
    expect(withLibDem.votesPerCandidate.tory).toBeGreaterThan(
      withLibDem.votesPerCandidate.labour * 0.9
    );
  });
});

// ─── FPTP: multiple third parties ───────────────────────────────────────────

describe("FPTP spoiler: multiple simultaneous third parties", () => {
  const categories = [makeCategory()];
  const demographics = makeDemographics();
  const population = 1_000_000;
  const totalPool = 600_000;
  const turnPool = 10_000;
  const generalOpts: DistributeVotesOptions = {
    isGeneralElection: true,
    votingSystem: "fptp",
    countryId: "US",
  };

  it("two third parties on opposite sides each drain from their nearest major", () => {
    // Green (far left) drains from Democrat; Libertarian (far right) drains from Republican.
    const candidates = [
      makeCandidate({ candidateId: "dem", party: "democrat", charEP: -3, charSP: -3 }),
      makeCandidate({ candidateId: "gop", party: "republican", charEP: 3, charSP: 3 }),
      makeCandidate({ candidateId: "green", party: "green", charEP: -4, charSP: -4 }),
      makeCandidate({ candidateId: "libertarian", party: "libertarian", charEP: 4, charSP: 4 }),
    ];

    const withBothThird = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      generalOpts
    );

    const withoutThird = distributeVotesByGroupLevelAllocation(
      [candidates[0], candidates[1]],
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      generalOpts
    );

    // Democrat loses votes to Green
    expect(withBothThird.votesPerCandidate.dem).toBeLessThan(withoutThird.votesPerCandidate.dem);
    // Republican loses votes to Libertarian
    expect(withBothThird.votesPerCandidate.gop).toBeLessThan(withoutThird.votesPerCandidate.gop);
    // Both third parties get positive votes
    expect(withBothThird.votesPerCandidate.green).toBeGreaterThan(0);
    expect(withBothThird.votesPerCandidate.libertarian).toBeGreaterThan(0);
  });

  it("both left-leaning third parties drain from the Democrat only", () => {
    // Green AND Progressive (both far left) both find Democrat as nearest major.
    // Each independently drains from Democrat.
    const candidates = [
      makeCandidate({ candidateId: "dem", party: "democrat", charEP: -3, charSP: -3 }),
      makeCandidate({ candidateId: "gop", party: "republican", charEP: 3, charSP: 3 }),
      makeCandidate({ candidateId: "green", party: "green", charEP: -4, charSP: -4 }),
      makeCandidate({ candidateId: "progressive", party: "progressive", charEP: -5, charSP: -4 }),
    ];

    const withTwoLeftThird = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      generalOpts
    );

    const withOneLeftThird = distributeVotesByGroupLevelAllocation(
      [candidates[0], candidates[1], candidates[2]], // dem + gop + green only
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      generalOpts
    );

    // With two left third parties, Democrat loses more votes than with just one
    expect(withTwoLeftThird.votesPerCandidate.dem).toBeLessThan(
      withOneLeftThird.votesPerCandidate.dem
    );
    // Republican is less affected with two left-wing spoilers vs one
    // (both primarily drain from Democrat; floor gives them a tiny GOP bleed too)
    expect(withTwoLeftThird.votesPerCandidate.gop).toBeGreaterThanOrEqual(
      withOneLeftThird.votesPerCandidate.gop * 0.95 // gop barely changes
    );
  });

  it("spoiler capped at major party's available votes — never goes negative", () => {
    // Place a very strong third party (high favorability and influence) that could
    // theoretically drain more votes than the nearest major actually has.
    // The spoiled amount should be capped at available, keeping votes non-negative.
    const candidates = [
      makeCandidate({
        candidateId: "dem",
        party: "democrat",
        charEP: -1,
        charSP: -1,
        favorability: 10, // very weak major
        politicalInfluence: 10,
      }),
      makeCandidate({ candidateId: "gop", party: "republican", charEP: 3, charSP: 3 }),
      makeCandidate({
        candidateId: "green",
        party: "green",
        charEP: -2,
        charSP: -2,
        favorability: 90, // very strong third party
        politicalInfluence: 500,
      }),
    ];

    const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      generalOpts
    );

    // No candidate should have negative votes
    expect(votesPerCandidate.dem).toBeGreaterThanOrEqual(0);
    expect(votesPerCandidate.gop).toBeGreaterThanOrEqual(0);
    expect(votesPerCandidate.green).toBeGreaterThanOrEqual(0);
  });
});

// ─── Balance: archetype approvals ───────────────────────────────────────────

describe("balance: archetype approvals modify effective favorability", () => {
  const categories = [makeCategory()];
  const demographics = makeDemographics();
  const population = 1_000_000;
  const totalPool = 600_000;
  const turnPool = 10_000;

  it("positive archetype approval boosts votes from that group", () => {
    const withBoost = [
      makeCandidate({
        candidateId: "boosted",
        charEP: 0,
        charSP: 0,
        favorability: 50,
        archetypeApprovals: { liberal: 40, conservative: 40 },
      }),
      makeCandidate({ candidateId: "normal", charEP: 0, charSP: 0, favorability: 50 }),
    ];

    const { sharesPct } = distributeVotesByGroupLevelAllocation(
      withBoost,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap
    );

    expect(sharesPct.boosted).toBeGreaterThan(sharesPct.normal);
  });

  it("negative archetype approval reduces votes from that group", () => {
    const candidates = [
      makeCandidate({
        candidateId: "disliked",
        charEP: 0,
        charSP: 0,
        favorability: 50,
        archetypeApprovals: { liberal: -60, conservative: -60 },
      }),
      makeCandidate({ candidateId: "neutral", charEP: 0, charSP: 0, favorability: 50 }),
    ];

    const { sharesPct } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap
    );

    expect(sharesPct.disliked).toBeLessThan(sharesPct.neutral);
  });

  describe("infamy effect on vote weight", () => {
    it("a 100-infamy candidate loses ~5% relative weight against an identical 0-infamy candidate", () => {
      const cleanId = "clean";
      const infamousId = "infamous";
      const candidates: EnrichedCandidate[] = [
        makeCandidate({ candidateId: cleanId, infamy: 0 }),
        makeCandidate({ candidateId: infamousId, infamy: 100 }),
      ];
      const partyOrgs = new Map<string, number>([["democrat", 50]]);
      const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
        candidates,
        1_000_000,
        1_000_000,
        1_000_000,
        makeDemographics(),
        [makeCategory()],
        partyOrgs,
        {}
      );
      const cleanVotes = votesPerCandidate[cleanId];
      const infamousVotes = votesPerCandidate[infamousId];
      // With identical stats but infamy=100, infamous candidate should get ~5% fewer votes
      const ratio = infamousVotes / cleanVotes;
      expect(ratio).toBeGreaterThan(0.94);
      expect(ratio).toBeLessThan(0.96);
    });

    it("undefined infamy applies no penalty (NPPs are unaffected)", () => {
      const aId = "a";
      const bId = "b";
      const candidates: EnrichedCandidate[] = [
        makeCandidate({ candidateId: aId }), // infamy not set → undefined
        makeCandidate({ candidateId: bId }), // infamy not set → undefined
      ];
      const partyOrgs = new Map<string, number>([["democrat", 50]]);
      const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
        candidates,
        1_000_000,
        1_000_000,
        1_000_000,
        makeDemographics(),
        [makeCategory()],
        partyOrgs,
        {}
      );
      expect(votesPerCandidate[aId]).toBeCloseTo(votesPerCandidate[bId], 0);
    });
  });
});

// ─── Phase 5a — Org normalization, Reg resistance, Support mood ─────────────

describe("Phase 5a general-election formula", () => {
  const categories = [makeCategory()];
  const demographics = makeDemographics();
  const population = 1_000_000;
  const totalPool = 600_000;
  const turnPool = 10_000;
  const generalOpts: DistributeVotesOptions = {
    isGeneralElection: true,
    countryId: "US",
    votingSystem: "rcv", // disable FPTP spoiler so we can isolate the Org/Reg/Support pathways
  };

  it("Org as normalized share — party with 2x the state Org gets meaningfully more votes", () => {
    // Use moderate (not polar) candidate positions so both candidates have
    // non-zero appeal in BOTH demographic groups. With perfectly polar
    // candidates against mirror demographics, the Org factor cancels out
    // because each candidate captures 100% of "their" group; relative Org
    // only differentiates when there's overlap in appeal.
    const candidates = [
      makeCandidate({ candidateId: "dem", party: "democrat", charEP: -1, charSP: -1 }),
      makeCandidate({ candidateId: "gop", party: "republican", charEP: 1, charSP: 1 }),
    ];
    const orgs = new Map([
      ["democrat", 60],
      ["republican", 30],
    ]);
    const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      orgs,
      generalOpts
    );
    // Dem has 60 / (60+30) = 2/3 of the state Org pool; with overlapping
    // appeal across groups, the Org normalization meaningfully shifts share
    // toward Dem. Don't pin a tight ratio here — demographic splitting
    // doesn't yield exactly 2x because appeal already tilts toward whichever
    // candidate matches each group's lean. Just verify Dem outperforms GOP.
    expect(votesPerCandidate.dem).toBeGreaterThan(votesPerCandidate.gop);
  });

  it("Org normalization — three-party state with shares 30/40/30 produces 30/40/30 weight ratio", () => {
    const candidates = [
      makeCandidate({ candidateId: "a", party: "a", charEP: 0, charSP: 0 }),
      makeCandidate({ candidateId: "b", party: "b", charEP: 0, charSP: 0 }),
      makeCandidate({ candidateId: "c", party: "c", charEP: 0, charSP: 0 }),
    ];
    const orgs = new Map([
      ["a", 30],
      ["b", 40],
      ["c", 30],
    ]);
    const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      orgs,
      generalOpts
    );
    const total = votesPerCandidate.a + votesPerCandidate.b + votesPerCandidate.c;
    // With identical appeal/reach/approval, Org share drives the split via the
    // diminishing-returns curve (share^ORG_WEIGHT_EXPONENT, renormalized) —
    // flatter than raw share since the 2026-07-09 exponent recalibration.
    const w = (s: number) => Math.pow(s, ORG_WEIGHT_EXPONENT);
    const wTotal = w(0.3) + w(0.4) + w(0.3);
    expect(votesPerCandidate.a / total).toBeCloseTo(w(0.3) / wTotal, 2);
    expect(votesPerCandidate.b / total).toBeCloseTo(w(0.4) / wTotal, 2);
    expect(votesPerCandidate.c / total).toBeCloseTo(w(0.3) / wTotal, 2);
  });

  it("Reg resistance — high own-Reg gives this party a meaningful weight bump", () => {
    // Moderate positions so both candidates compete in both groups (see
    // notes in the Org-share test about polar candidate setups canceling
    // out the multiplicative factors).
    const candidates = [
      makeCandidate({ candidateId: "dem", party: "democrat", charEP: -1, charSP: -1 }),
      makeCandidate({ candidateId: "gop", party: "republican", charEP: 1, charSP: 1 }),
    ];
    const orgs = new Map([
      ["democrat", 50],
      ["republican", 50],
    ]);
    const baseOpts: DistributeVotesOptions = { ...generalOpts };
    const regOpts: DistributeVotesOptions = {
      ...generalOpts,
      regByParty: new Map([["democrat", 100]]),
    };
    const { votesPerCandidate: noReg } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      orgs,
      baseOpts
    );
    const { votesPerCandidate: highDemReg } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      orgs,
      regOpts
    );
    // High Dem Reg should make Dem more competitive (higher weight via 1.3×
    // multiplier). Pool is fixed → Dem gain comes from GOP share.
    expect(highDemReg.dem).toBeGreaterThan(noReg.dem);
    expect(highDemReg.gop).toBeLessThan(noReg.gop);
  });

  it("Support multiplier — candidate with support=100 outperforms support=0 mirror", () => {
    const orgs = new Map([
      ["democrat", 50],
      ["republican", 50],
    ]);
    // Moderate positions so the multiplicative factors actually
    // differentiate (see notes on polar setups).
    const goodMood = [
      makeCandidate({
        candidateId: "dem-up",
        party: "democrat",
        charEP: -1,
        charSP: -1,
        support: 100,
      }),
      makeCandidate({ candidateId: "gop", party: "republican", charEP: 1, charSP: 1 }),
    ];
    const badMood = [
      makeCandidate({
        candidateId: "dem-down",
        party: "democrat",
        charEP: -1,
        charSP: -1,
        support: 0,
      }),
      makeCandidate({ candidateId: "gop", party: "republican", charEP: 1, charSP: 1 }),
    ];
    const upResult = distributeVotesByGroupLevelAllocation(
      goodMood,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      orgs,
      generalOpts
    );
    const downResult = distributeVotesByGroupLevelAllocation(
      badMood,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      orgs,
      generalOpts
    );
    // Dem with support=100 should clearly outperform dem with support=0
    // (1.4× vs 0.6× = ~2.3× weight ratio in own slot). Tolerance generous.
    expect(upResult.votesPerCandidate["dem-up"]).toBeGreaterThan(
      downResult.votesPerCandidate["dem-down"]
    );
  });

  it("Support neutral default — undefined support behaves like support=50", () => {
    const orgs = new Map([
      ["democrat", 50],
      ["republican", 50],
    ]);
    const undefinedSup = [
      makeCandidate({ candidateId: "dem", party: "democrat", charEP: -3, charSP: -3 }),
      makeCandidate({ candidateId: "gop", party: "republican", charEP: 3, charSP: 3 }),
    ];
    const explicit50 = [
      makeCandidate({
        candidateId: "dem",
        party: "democrat",
        charEP: -3,
        charSP: -3,
        support: 50,
      }),
      makeCandidate({
        candidateId: "gop",
        party: "republican",
        charEP: 3,
        charSP: 3,
        support: 50,
      }),
    ];
    const undefRes = distributeVotesByGroupLevelAllocation(
      undefinedSup,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      orgs,
      generalOpts
    );
    const exRes = distributeVotesByGroupLevelAllocation(
      explicit50,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      orgs,
      generalOpts
    );
    expect(undefRes.votesPerCandidate.dem).toBeCloseTo(exRes.votesPerCandidate.dem, 0);
    expect(undefRes.votesPerCandidate.gop).toBeCloseTo(exRes.votesPerCandidate.gop, 0);
  });

  it("Backward-compat — empty Org map falls back to legacy partyOrgScalar (1.0× neutral)", () => {
    // When no Org data is in the map, the fallback path uses partyOrgScalar
    // which returns 1.0 for undefined org. Both candidates get the same
    // baseline; relative ordering driven entirely by appeal.
    const candidates = [
      makeCandidate({ candidateId: "dem", party: "democrat", charEP: -3, charSP: -3 }),
      makeCandidate({ candidateId: "gop", party: "republican", charEP: 3, charSP: 3 }),
    ];
    const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      generalOpts
    );
    // Symmetric demographics + symmetric candidates → roughly equal votes.
    expect(votesPerCandidate.dem).toBeCloseTo(votesPerCandidate.gop, -2);
  });

  it("Phase 5a invariant — Reg/Support unset behaves identically to legacy ordering", () => {
    // With Org-only data and no Reg/Support, the Phase 5a formula produces
    // weights proportional to normalized Org share. The relative ordering
    // (winner = larger share) is the same as the legacy partyOrgScalar
    // formula (where larger raw Org → larger 1.0–1.6× scalar). Moderate
    // positions so the Org differentiation actually surfaces.
    const candidates = [
      makeCandidate({ candidateId: "dem", party: "democrat", charEP: -1, charSP: -1 }),
      makeCandidate({ candidateId: "gop", party: "republican", charEP: 1, charSP: 1 }),
    ];
    const orgs = new Map([
      ["democrat", 60],
      ["republican", 30],
    ]);
    const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      orgs,
      generalOpts
    );
    // Dem (larger Org) wins under both legacy and Phase 5a formulas — this
    // is the relative-ordering preservation guaranteed by Phase 5a D5.
    expect(votesPerCandidate.dem).toBeGreaterThan(votesPerCandidate.gop);
  });

  it("Primary path — Phase 5a does NOT change primary behavior (intra-party, no normalization)", () => {
    // When isGeneralElection is false/undefined (primary), the legacy
    // partyOrgScalar formula remains in effect and Reg/Support are NOT
    // consumed. Verifies the new pathway is gated correctly.
    const candidates = [
      makeCandidate({
        candidateId: "dem-a",
        party: "democrat",
        charEP: -3,
        charSP: -3,
        support: 100, // ignored in primary
      }),
      makeCandidate({
        candidateId: "dem-b",
        party: "democrat",
        charEP: -3,
        charSP: -3,
        support: 0, // also ignored
      }),
    ];
    const orgs = new Map([["democrat", 60]]);
    const primaryOpts: DistributeVotesOptions = {
      // No isGeneralElection → primary path
      regByParty: new Map([["democrat", 100]]), // ignored in primary
    };
    const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      orgs,
      primaryOpts
    );
    // Both candidates are intra-party mirrors with identical appeal — Support
    // doesn't flow through, so they tie despite the 100 vs 0 support gap.
    expect(votesPerCandidate["dem-a"]).toBeCloseTo(votesPerCandidate["dem-b"], 0);
  });
});

// ─── OPS regime weighting ────────────────────────────────────────────────────

describe("distributeVotesByGroupLevelAllocation — OPS regime weighting", () => {
  const categories = [makeCategory()];
  const demographics = makeDemographics();
  const population = 1_000_000;
  const totalPool = 600_000;
  const turnPool = 10_000;

  it("ruling-party candidate dominates one-on-one against equally-skilled approved party", () => {
    // 1-vs-1 with regimeMult 3.0 / 0.375: ruling share ≈ 3 / (3 + 0.375) = 89%.
    // The design target of ~80% is for the 7-vs-14 cycle-end scenario; unit
    // tests verify the per-candidate weight ratio holds.
    const candidates = [
      makeCandidate({
        candidateId: "ccp",
        party: "1",
        charEP: 0,
        charSP: 0,
        regimeMult: 3.0,
        regimeStatus: "ruling",
      }),
      makeCandidate({
        candidateId: "cdl",
        party: "2",
        charEP: 0,
        charSP: 0,
        regimeMult: 0.375,
        regimeStatus: "approved",
      }),
    ];
    const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { countryId: "CN", isGeneralElection: true }
    );
    const ccp = votesPerCandidate["ccp"];
    const cdl = votesPerCandidate["cdl"];
    const total = ccp + cdl;
    expect(ccp / total).toBeGreaterThan(0.85);
    expect(ccp / total).toBeLessThan(0.93);
  });

  it("banned candidate (regimeMult=0) receives 0 votes", () => {
    const candidates = [
      makeCandidate({ candidateId: "ccp", regimeMult: 3.0, regimeStatus: "ruling" }),
      makeCandidate({ candidateId: "banned", regimeMult: 0.0, regimeStatus: "banned" }),
    ];
    const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { countryId: "CN", isGeneralElection: true }
    );
    expect(votesPerCandidate["banned"]).toBe(0);
  });

  it("independent candidate (regimeMult=0) receives 0 votes in OPS", () => {
    const candidates = [
      makeCandidate({ candidateId: "ccp", regimeMult: 3.0, regimeStatus: "ruling" }),
      makeCandidate({ candidateId: "indep", regimeMult: 0.0 }),
    ];
    const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { countryId: "CN", isGeneralElection: true }
    );
    expect(votesPerCandidate["indep"]).toBe(0);
  });

  it("does NOT change non-OPS results — regimeMult=1.0 everywhere yields baseline behavior", () => {
    const candidates = [
      makeCandidate({ candidateId: "dem", charEP: -2, charSP: -2, regimeMult: 1.0 }),
      makeCandidate({ candidateId: "rep", charEP: 2, charSP: 2, regimeMult: 1.0 }),
    ];
    const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { countryId: "US", isGeneralElection: true }
    );
    const dem = votesPerCandidate["dem"];
    const rep = votesPerCandidate["rep"];
    expect(Math.abs(dem - rep) / (dem + rep)).toBeLessThan(0.1);
  });

  it("exceptional approved-party candidate (high favorability) takes meaningful share vs average ruling", () => {
    const candidates = [
      makeCandidate({
        candidateId: "ccp-avg",
        charEP: 0,
        charSP: 0,
        favorability: 50,
        regimeMult: 3.0,
        regimeStatus: "ruling",
      }),
      makeCandidate({
        candidateId: "cdl-star",
        charEP: 0,
        charSP: 0,
        favorability: 95,
        regimeMult: 0.375,
        regimeStatus: "approved",
      }),
    ];
    const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { countryId: "CN", isGeneralElection: true }
    );
    const star = votesPerCandidate["cdl-star"];
    const avg = votesPerCandidate["ccp-avg"];
    const total = star + avg;
    // Predicted weight ratio: (50 * 3.0) / (95 * 0.375) ≈ 4.21; approved share ≈ 0.19.
    expect(star / total).toBeGreaterThan(0.15);
    expect(star / total).toBeLessThan(0.3);
  });
});

describe("distributeVotesByGroupLevelAllocation — FPTP spoiler skip for OPS", () => {
  const categories = [makeCategory()];
  const demographics = makeDemographics();
  const population = 1_000_000;
  const totalPool = 600_000;
  const turnPool = 10_000;

  it("does not apply FPTP spoiler transfer when governmentType === 'onePartyState'", () => {
    const candidates = [
      makeCandidate({
        candidateId: "ccp",
        party: "1",
        charEP: 0,
        charSP: 0,
        regimeMult: 3.0,
        regimeStatus: "ruling",
      }),
      makeCandidate({
        candidateId: "cdl",
        party: "2",
        charEP: 0,
        charSP: 0,
        regimeMult: 0.375,
        regimeStatus: "approved",
      }),
    ];
    const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
      candidates,
      turnPool,
      totalPool,
      population,
      demographics,
      categories,
      emptyOrgMap,
      { countryId: "CN", isGeneralElection: true, votingSystem: "fptp" }
    );
    // Approved share should reflect regimeMult math only (1-vs-1 gives ~11%),
    // with no spoiler steal driving it lower toward the 7% it would hit if
    // FPTP transferred from approved → ruling.
    const total = votesPerCandidate["ccp"] + votesPerCandidate["cdl"];
    expect(votesPerCandidate["cdl"] / total).toBeGreaterThan(0.1);
  });
});
