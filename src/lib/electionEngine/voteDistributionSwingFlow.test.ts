import { describe, expect, it } from "vitest";
import { distributeVotesBySwingFlow } from "./voteDistributionSwingFlow";
import { distributeVotesByGroupLevelAllocation } from "./voteDistribution";
import {
  transferableShare,
  persuasionResistance,
  TRANSFERABLE_SHARE_NO_REG,
  TRANSFERABLE_SHARE_FULL_REG,
  PERSUASION_RESISTANCE_NO_REG,
  PERSUASION_RESISTANCE_FULL_REG,
  personalStatTenureRetention,
  PERSONAL_STAT_TENURE_EROSION_PER_TERM,
  PERSONAL_STAT_TENURE_EROSION_MAX,
} from "./electionFormulaFactors";
import type { DistributeVotesOptions } from "./types";
import {
  persuasionDrivers,
  getPersuasionDriverBreakdown,
  SUPPORT_DELTA_BUDGET,
  POLICY_DISTANCE_BUDGET,
  MONEY_BUDGET,
  INCUMBENCY_BUDGET,
} from "./persuasionDrivers";
import type { EnrichedCandidate } from "./types";
import type { DemographicCategory, StateDemographics } from "@/lib/db/types";

// Two-party FPTP fixture: Dem vs Rep in a single state with two
// demographic groups. Identical position / Support / influence — only
// the party differs — so the legacy engine's weight loop awards equal
// shares, giving us a clean baseline for the swing-flow comparison.
function fixtureCandidates(): EnrichedCandidate[] {
  return [
    {
      candidateId: "c1",
      party: "dem",
      isNPP: false,
      politicalInfluence: 60,
      nationalInfluence: 60,
      favorability: 50,
      support: 50,
      charEP: -1,
      charSP: -1,
      partyEcon: -1,
      partySocial: -1,
      archetypeApprovals: {},
      infamy: 0,
    } as EnrichedCandidate,
    {
      candidateId: "c2",
      party: "rep",
      isNPP: false,
      politicalInfluence: 60,
      nationalInfluence: 60,
      favorability: 50,
      support: 50,
      charEP: 1,
      charSP: 1,
      partyEcon: 1,
      partySocial: 1,
      archetypeApprovals: {},
      infamy: 0,
    } as EnrichedCandidate,
  ];
}

function fixtureCategories(): DemographicCategory[] {
  return [
    {
      _id: "income",
      name: "Income",
      groups: [
        {
          id: "low",
          name: "Low income",
          defaultEconomicLean: -1,
          defaultSocialLean: 0,
          defaultTurnout: 60,
        },
        {
          id: "high",
          name: "High income",
          defaultEconomicLean: 1,
          defaultSocialLean: 0,
          defaultTurnout: 60,
        },
      ],
    } as unknown as DemographicCategory,
  ];
}

function fixtureDemographics(): StateDemographics {
  // Equal turnout + mirror leans across the two groups so symmetric
  // (Dem at (-1,-1), Rep at (+1,+1)) candidates net to identical
  // statewide appeal. Asymmetric turnout would bias toward whichever
  // group's higher turnout aligns with one candidate's position.
  return {
    _id: "TS",
    categoryWeights: { income: 100 },
    groups: {
      low: { population: 50, turnout: 60, economicLean: -1, socialLean: 0 },
      high: { population: 50, turnout: 60, economicLean: 1, socialLean: 0 },
    },
  } as unknown as StateDemographics;
}

describe("transferableShare curve", () => {
  it("returns the no-Reg baseline when Reg is undefined / NaN / negative", () => {
    expect(transferableShare(undefined)).toBe(TRANSFERABLE_SHARE_NO_REG);
    expect(transferableShare(NaN)).toBe(TRANSFERABLE_SHARE_NO_REG);
    expect(transferableShare(-10)).toBe(TRANSFERABLE_SHARE_NO_REG);
  });

  it("hits the documented endpoints at Reg=0 and Reg=100", () => {
    expect(transferableShare(0)).toBe(TRANSFERABLE_SHARE_NO_REG);
    // toBeCloseTo (not toBe) because the t=1 path computes
    // `noReg + (fullReg - noReg) * 1` which carries float imprecision
    // when the constants don't have clean binary representations.
    expect(transferableShare(100)).toBeCloseTo(TRANSFERABLE_SHARE_FULL_REG);
  });

  it("interpolates monotonically (concave-down quadratic) between endpoints", () => {
    // Quadratic concave-down: most peelability drop concentrated at high Reg,
    // because Reg buys defense at an accelerating rate. So mid-Reg should
    // stay closer to the no-Reg endpoint than a linear interpolation would.
    const linearMidpoint = (TRANSFERABLE_SHARE_NO_REG + TRANSFERABLE_SHARE_FULL_REG) / 2;
    expect(transferableShare(50)).toBeGreaterThan(linearMidpoint);
    expect(transferableShare(50)).toBeLessThan(TRANSFERABLE_SHARE_NO_REG);
    // Monotonic decrease.
    expect(transferableShare(20)).toBeGreaterThan(transferableShare(60));
  });

  it("clamps Reg > 100 to the full-Reg value", () => {
    expect(transferableShare(150)).toBeCloseTo(TRANSFERABLE_SHARE_FULL_REG);
  });
});

describe("persuasionResistance curve", () => {
  it("returns the no-Reg baseline when Reg is undefined / NaN / negative", () => {
    expect(persuasionResistance(undefined)).toBe(PERSUASION_RESISTANCE_NO_REG);
    expect(persuasionResistance(NaN)).toBe(PERSUASION_RESISTANCE_NO_REG);
    expect(persuasionResistance(-5)).toBe(PERSUASION_RESISTANCE_NO_REG);
  });

  it("hits the documented endpoints at Reg=0 and Reg=100", () => {
    expect(persuasionResistance(0)).toBe(PERSUASION_RESISTANCE_NO_REG);
    expect(persuasionResistance(100)).toBe(PERSUASION_RESISTANCE_FULL_REG);
  });

  it("interpolates monotonically (concave-up quadratic) between endpoints", () => {
    // Quadratic concave-up: resistance ramps up slowly at low Reg, then
    // accelerates — sustained Reg investment matters more late than early.
    // T3 calibration: 0.50 × (50/100)^2 = 0.125 (was 0.175 at 0.70 cap).
    expect(persuasionResistance(50)).toBeCloseTo(0.125);
    // Monotonic increase.
    expect(persuasionResistance(20)).toBeLessThan(persuasionResistance(80));
  });
});

describe("combined effective-peel curve", () => {
  // The product transferable_share × (1 − persuasionResistance) is what
  // the engine actually consumes. Pin the documented calibration values
  // so future curve tweaks have to acknowledge the targets.
  function effPeel(reg: number): number {
    return transferableShare(reg) * (1 - persuasionResistance(reg));
  }
  it("matches the T3 calibration points", () => {
    // T3 (2026-05-23): softened from T2's ~13× peel-rate cliff after
    // sim G5 showed high-Reg incumbents flipping the EV while losing
    // the popular vote. Newcomer ~20%, entrenched ~5% — ~4× falloff.
    expect(effPeel(0)).toBeCloseTo(0.2);
    // 50: ~0.165 × 0.875 ≈ 0.144
    expect(effPeel(50)).toBeGreaterThan(0.13);
    expect(effPeel(50)).toBeLessThan(0.16);
    // 100: 0.10 × 0.50 = 0.05
    expect(effPeel(100)).toBeCloseTo(0.05);
  });
  it("is monotonically decreasing in Reg (entrenched parties are harder to peel)", () => {
    expect(effPeel(0)).toBeGreaterThan(effPeel(20));
    expect(effPeel(20)).toBeGreaterThan(effPeel(50));
    expect(effPeel(50)).toBeGreaterThan(effPeel(80));
    expect(effPeel(80)).toBeGreaterThan(effPeel(100));
  });
});

describe("persuasionDrivers", () => {
  it("returns 0 when both parties have identical representatives", () => {
    const enriched = fixtureCandidates();
    // Symmetric fixture: same Support, mirror-image positions. Policy
    // distance from origin is identical, so both components net out.
    const driver = persuasionDrivers("dem", "rep", enriched);
    expect(Math.abs(driver)).toBeLessThan(1e-6);
  });

  it("returns positive when P_j has higher Support than P_i", () => {
    const enriched = fixtureCandidates();
    enriched[0].support = 90;
    enriched[1].support = 30;
    const driver = persuasionDrivers("dem", "rep", enriched);
    expect(driver).toBeGreaterThan(0);
  });

  it("returns 0 when either party has no representative candidate", () => {
    const enriched = fixtureCandidates();
    expect(persuasionDrivers("ghost", "rep", enriched)).toBe(0);
    expect(persuasionDrivers("dem", "ghost", enriched)).toBe(0);
  });

  it("is clamped to [-1, +1]", () => {
    const enriched = fixtureCandidates();
    enriched[0].support = 100;
    enriched[1].support = 0;
    enriched[0].charEP = 0;
    enriched[0].charSP = 0;
    enriched[1].charEP = 4;
    enriched[1].charSP = 4;
    const driver = persuasionDrivers("dem", "rep", enriched);
    expect(driver).toBeLessThanOrEqual(1);
    expect(driver).toBeGreaterThanOrEqual(-1);
  });

  it("money: positive driver when P_j has materially more funds", () => {
    const enriched = fixtureCandidates();
    const withMoney = persuasionDrivers("dem", "rep", enriched, {
      fundsByParty: new Map([
        ["dem", 10_000_000],
        ["rep", 1_000_000],
      ]),
    });
    const baseline = persuasionDrivers("dem", "rep", enriched);
    expect(withMoney).toBeGreaterThan(baseline);
  });

  it("money: zero contribution when both parties have zero funds recorded", () => {
    const enriched = fixtureCandidates();
    const baseline = persuasionDrivers("dem", "rep", enriched);
    const zeroFunds = persuasionDrivers("dem", "rep", enriched, {
      fundsByParty: new Map([
        ["dem", 0],
        ["rep", 0],
      ]),
    });
    expect(zeroFunds).toBeCloseTo(baseline);
  });

  it("incumbency: positive when P_j has higher prior seat-share than P_i", () => {
    const enriched = fixtureCandidates();
    const incumbent = persuasionDrivers("dem", "rep", enriched, {
      incumbentSeatShareByParty: new Map([
        ["dem", 1.0],
        ["rep", 0.0],
      ]),
    });
    const challenger = persuasionDrivers("dem", "rep", enriched, {
      incumbentSeatShareByParty: new Map([
        ["dem", 0.0],
        ["rep", 1.0],
      ]),
    });
    const openSeat = persuasionDrivers("dem", "rep", enriched);
    expect(incumbent).toBeGreaterThan(openSeat);
    expect(challenger).toBeLessThan(openSeat);
  });

  it("incumbency: single-seat fixture produces the full INCUMBENCY_BUDGET magnitude", () => {
    const enriched = fixtureCandidates();
    const driver = persuasionDrivers("dem", "rep", enriched, {
      incumbentSeatShareByParty: new Map([
        ["dem", 1.0],
        ["rep", 0.0],
      ]),
    });
    // T1 tuning re-pass: (1.0 − 0.0) × INCUMBENCY_BUDGET(0.10) = 0.10
    expect(driver).toBeCloseTo(0.1);
  });

  it("incumbency: multi-seat fixture scales lift by share differential", () => {
    const enriched = fixtureCandidates();
    // Prior cycle: Dem held 60% of seats, Rep held 30%, residual 10% to
    // some other (un-modeled) party.
    const driver = persuasionDrivers("dem", "rep", enriched, {
      incumbentSeatShareByParty: new Map([
        ["dem", 0.6],
        ["rep", 0.3],
      ]),
    });
    // (0.6 − 0.3) × INCUMBENCY_BUDGET(0.10) = 0.030 — smaller than the
    // single-seat ±0.10 because each party has a smaller stake to defend.
    expect(driver).toBeCloseTo(0.03);
  });

  it("incumbency: empty map degrades to 0 (no prior cycle / open seat)", () => {
    const enriched = fixtureCandidates();
    const driver = persuasionDrivers("dem", "rep", enriched, {
      incumbentSeatShareByParty: new Map(),
    });
    expect(driver).toBe(0);
  });

  describe("getPersuasionDriverBreakdown", () => {
    it("returns one row per documented component, even when each value is zero", () => {
      const enriched = fixtureCandidates();
      const rows = getPersuasionDriverBreakdown("dem", "rep", enriched);
      // Four components: Candidate Support, Policy alignment, Money,
      // Incumbency. Each present so the UI can render an explicit zero
      // rather than omitting. (Presidential coattails are a nominal-share
      // multiplier now, not a persuasion driver.)
      expect(rows.map((r) => r.label)).toEqual([
        "Candidate Support",
        "Policy alignment",
        "Money",
        "Incumbency",
      ]);
    });

    it("scales each component to percentage-point units", () => {
      const enriched = fixtureCandidates();
      enriched[0].support = 100; // Dem max Support
      enriched[1].support = 0; // Rep min Support
      const rows = getPersuasionDriverBreakdown("dem", "rep", enriched);
      const support = rows.find((r) => r.label === "Candidate Support");
      // T1 tuning re-pass: Max Support delta (100-0)/100 = 1.0 ×
      // SUPPORT_DELTA_BUDGET (0.30) × scale (100) = 30 pp.
      expect(support?.contributionPct).toBeCloseTo(30);
    });
  });

  it("aggregate stays clamped when every component is maxed in the same direction", () => {
    const enriched = fixtureCandidates();
    enriched[0].support = 100;
    enriched[1].support = 0;
    enriched[0].charEP = 0;
    enriched[0].charSP = 0;
    enriched[1].charEP = 4;
    enriched[1].charSP = 4;
    const driver = persuasionDrivers("dem", "rep", enriched, {
      fundsByParty: new Map([
        ["dem", 100_000_000],
        ["rep", 100],
      ]),
      incumbentSeatShareByParty: new Map([
        ["dem", 1.0],
        ["rep", 0.0],
      ]),
    });
    expect(driver).toBeLessThanOrEqual(1);
    expect(driver).toBeGreaterThanOrEqual(-1);
  });

  it("T3 — per-driver budgets sum to ≤ 1.0 (aggregate clamp invariant)", () => {
    // The aggregate `[-1, +1]` clamp in persuasionDrivers() is the safety
    // rail. With budgets summing to 1.0 the rail activates only when
    // every driver saturates in the same direction — the natural design
    // target. If the budgets ever sum > 1.0 the rail becomes a
    // hard cap that clips otherwise-valid driver combinations, and the
    // tuning intent is broken. Guard the invariant here.
    const sum = SUPPORT_DELTA_BUDGET + POLICY_DISTANCE_BUDGET + MONEY_BUDGET + INCUMBENCY_BUDGET;
    expect(sum).toBeLessThanOrEqual(1.0);
    // Also assert non-degeneracy — sum shouldn't be near 0.
    expect(sum).toBeGreaterThan(0.5);
  });
});

describe("distributeVotesBySwingFlow — Step 1 reproduces the appeal kernel", () => {
  it("conserves total votes across all candidates", () => {
    const out = distributeVotesBySwingFlow(
      fixtureCandidates(),
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      {
        isGeneralElection: true,
        countryId: "US",
        votingSystem: "fptp",
      }
    );
    const total = Object.values(out.votesPerCandidate).reduce((s, v) => s + v, 0);
    // §7.3.2 swing-flow is conservative by construction (every peeled vote
    // is gained by a peeler). Conservation here = total before swings ≈
    // total after swings within a rounding tolerance.
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(1_000_000);
  });

  it("gives SNP real weight in a London general now that geography is not a gate", () => {
    const lab: EnrichedCandidate = {
      ...fixtureCandidates()[0]!,
      candidateId: "lab",
      party: "1",
      partyAbbr: "LAB",
      charEP: -2,
      charSP: -3,
      partyEcon: -2,
      partySocial: -3,
    };
    const con: EnrichedCandidate = {
      ...fixtureCandidates()[1]!,
      candidateId: "con",
      party: "2",
      partyAbbr: "CON",
    };
    const snp: EnrichedCandidate = {
      ...fixtureCandidates()[0]!,
      candidateId: "snp",
      party: "3",
      partyAbbr: "SNP",
      isNPP: true,
      charEP: -2,
      charSP: -2,
      partyEcon: -2,
      partySocial: -2,
    };
    const out = distributeVotesBySwingFlow(
      [lab, con, snp],
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map([
        ["1", 70],
        ["2", 60],
        ["3", 5],
      ]),
      {
        isGeneralElection: true,
        countryId: "UK",
        currentStateId: "LON",
        votingSystem: "fptp",
      }
    );
    expect(out.votesPerCandidate.snp).toBeGreaterThan(0);
    expect(out.votesPerCandidate.lab).toBeGreaterThan(0);
    expect(out.votesPerCandidate.con).toBeGreaterThan(0);
    // Org 5 against Labour's 70 keeps them a fringe presence, not a threat:
    // geography stops being a wall and becomes a disadvantage.
    expect(out.votesPerCandidate.snp).toBeLessThan(out.votesPerCandidate.lab!);
  });

  it("still awards SNP votes in a Scotland general", () => {
    const snp: EnrichedCandidate = {
      ...fixtureCandidates()[0]!,
      candidateId: "snp",
      party: "3",
      partyAbbr: "SNP",
      isNPP: true,
      charEP: -2,
      charSP: -2,
      partyEcon: -2,
      partySocial: -2,
    };
    const lab: EnrichedCandidate = {
      ...fixtureCandidates()[0]!,
      candidateId: "lab",
      party: "1",
      partyAbbr: "LAB",
    };
    const out = distributeVotesBySwingFlow(
      [lab, snp],
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map([
        ["1", 50],
        ["3", 40],
      ]),
      {
        isGeneralElection: true,
        countryId: "UK",
        currentStateId: "SCO",
        votingSystem: "fptp",
      }
    );
    expect(out.votesPerCandidate.snp).toBeGreaterThan(0);
    expect(out.votesPerCandidate.lab).toBeGreaterThan(0);
  });

  it("returns equal shares to symmetric candidates with neutral Reg + drivers", () => {
    const out = distributeVotesBySwingFlow(
      fixtureCandidates(),
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      {
        isGeneralElection: true,
        countryId: "US",
        votingSystem: "fptp",
      }
    );
    // Symmetric fixture (mirror positions, equal Support / approval) →
    // persuasionDrivers ≈ 0, so swings ≈ 0, so final ≈ nominal. The
    // nominal computation is the same per-group appeal-weighted split
    // the legacy engine uses, so symmetric inputs give equal shares.
    expect(out.sharesPct.c1).toBeCloseTo(out.sharesPct.c2, 0);
  });

  it("returns the empty-pool default when totalPool <= 0", () => {
    const out = distributeVotesBySwingFlow(
      fixtureCandidates(),
      0,
      0,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      {
        isGeneralElection: true,
        countryId: "US",
        votingSystem: "fptp",
      }
    );
    expect(out.votesPerCandidate.c1).toBe(0);
    expect(out.votesPerCandidate.c2).toBe(0);
    // Empty-pool falls back to "even split for share display" — same as
    // the legacy engine — so the percentage shown to the user isn't an
    // arbitrary 100% / 0%.
    expect(out.sharesPct.c1).toBeCloseTo(out.sharesPct.c2, 0);
  });
});

describe("distributeVotesBySwingFlow — produces a plausible final distribution", () => {
  it("when Dem has materially higher Support, Dem ends up with a higher share", () => {
    const enriched = fixtureCandidates();
    enriched[0].support = 90; // Dem
    enriched[1].support = 30; // Rep
    const out = distributeVotesBySwingFlow(
      enriched,
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      {
        isGeneralElection: true,
        countryId: "US",
        votingSystem: "fptp",
      }
    );
    expect(out.sharesPct.c1).toBeGreaterThan(out.sharesPct.c2);
  });

  it("matches the order (winner / loser) of the legacy engine for clearly-leaning inputs", () => {
    const enriched = fixtureCandidates();
    enriched[0].support = 80;
    enriched[1].support = 20;
    const orgs = new Map([
      ["dem", 60],
      ["rep", 40],
    ]);
    const swing = distributeVotesBySwingFlow(
      enriched,
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      orgs,
      {
        isGeneralElection: true,
        countryId: "US",
        votingSystem: "fptp",
      }
    );
    const legacy = distributeVotesByGroupLevelAllocation(
      enriched,
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      orgs,
      {
        isGeneralElection: true,
        countryId: "US",
        votingSystem: "fptp",
      }
    );
    // Both engines should call the same winner. Margins may differ
    // (calibration is #4D's job) but the order must agree for the
    // dual-path period to be safe.
    const swingWinner = swing.votesPerCandidate.c1 >= swing.votesPerCandidate.c2 ? "c1" : "c2";
    const legacyWinner = legacy.votesPerCandidate.c1 >= legacy.votesPerCandidate.c2 ? "c1" : "c2";
    expect(swingWinner).toBe(legacyWinner);
  });
});

describe("distributeVotesBySwingFlow — OPS regime weighting", () => {
  function opsCandidates(): EnrichedCandidate[] {
    return [
      {
        candidateId: "ccp",
        party: "1",
        isNPP: false,
        politicalInfluence: 60,
        nationalInfluence: 60,
        favorability: 50,
        support: 50,
        charEP: 0,
        charSP: 0,
        archetypeApprovals: {},
        infamy: 0,
        regimeMult: 3.0,
        regimeStatus: "ruling",
      } as EnrichedCandidate,
      {
        candidateId: "cdl",
        party: "2",
        isNPP: false,
        politicalInfluence: 60,
        nationalInfluence: 60,
        favorability: 50,
        support: 50,
        charEP: 0,
        charSP: 0,
        archetypeApprovals: {},
        infamy: 0,
        regimeMult: 0.375,
        regimeStatus: "approved",
      } as EnrichedCandidate,
    ];
  }

  it("ruling-party candidate dominates one-on-one against approved-party in CN", () => {
    const out = distributeVotesBySwingFlow(
      opsCandidates(),
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      {
        isGeneralElection: true,
        countryId: "CN",
        votingSystem: "fptp",
      }
    );
    const total = out.votesPerCandidate["ccp"] + out.votesPerCandidate["cdl"];
    // 3.0 / (3.0 + 0.375) = 88.9% ruling share before swings.
    expect(out.votesPerCandidate["ccp"] / total).toBeGreaterThan(0.85);
    expect(out.votesPerCandidate["ccp"] / total).toBeLessThan(0.93);
  });

  it("banned candidate (regimeMult=0) receives 0 votes", () => {
    const candidates: EnrichedCandidate[] = [
      ...opsCandidates(),
      {
        candidateId: "banned",
        party: "3",
        isNPP: false,
        politicalInfluence: 60,
        nationalInfluence: 60,
        favorability: 50,
        support: 50,
        charEP: 0,
        charSP: 0,
        archetypeApprovals: {},
        infamy: 0,
        regimeMult: 0,
        regimeStatus: "banned",
      } as EnrichedCandidate,
    ];
    const out = distributeVotesBySwingFlow(
      candidates,
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      {
        isGeneralElection: true,
        countryId: "CN",
        votingSystem: "fptp",
      }
    );
    expect(out.votesPerCandidate["banned"]).toBe(0);
  });

  it("non-OPS results unchanged when regimeMult is 1.0 (or omitted)", () => {
    // Baseline guard: the swing-flow engine must behave identically for
    // non-OPS races regardless of the new multiplier.
    const out = distributeVotesBySwingFlow(
      fixtureCandidates(), // no regimeMult set (undefined → 1.0)
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      {
        isGeneralElection: true,
        countryId: "US",
        votingSystem: "fptp",
      }
    );
    const total = out.votesPerCandidate["c1"] + out.votesPerCandidate["c2"];
    // Symmetric candidates should split roughly evenly when regimeMult is 1.0.
    expect(
      Math.abs(out.votesPerCandidate["c1"] - out.votesPerCandidate["c2"]) / total
    ).toBeLessThan(0.1);
  });
});

describe("distributeVotesBySwingFlow — governor coattail (govModifier)", () => {
  it("raises the governor party's share vs. no govModifier, all else equal", () => {
    // c1 = dem, c2 = rep; symmetric → ~50/50 baseline.
    const base = distributeVotesBySwingFlow(
      fixtureCandidates(),
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      { isGeneralElection: true, countryId: "US", votingSystem: "fptp" }
    );
    const withGov = distributeVotesBySwingFlow(
      fixtureCandidates(),
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      {
        isGeneralElection: true,
        countryId: "US",
        votingSystem: "fptp",
        govModifierByParty: new Map([["dem", 1.09]]),
      }
    );
    expect(withGov.sharesPct["c1"]).toBeGreaterThan(base.sharesPct["c1"]);
  });

  it("is a no-op when govModifierByParty is absent / empty (regression guard)", () => {
    const a = distributeVotesBySwingFlow(
      fixtureCandidates(),
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      { isGeneralElection: true, countryId: "US", votingSystem: "fptp" }
    );
    const b = distributeVotesBySwingFlow(
      fixtureCandidates(),
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      {
        isGeneralElection: true,
        countryId: "US",
        votingSystem: "fptp",
        govModifierByParty: new Map(),
      }
    );
    expect(b.sharesPct).toEqual(a.sharesPct);
  });
});

describe("distributeVotesBySwingFlow — presidential coattail (presidentialModifier)", () => {
  it("raises the President's party share vs. no presidentialModifier, all else equal", () => {
    const base = distributeVotesBySwingFlow(
      fixtureCandidates(),
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      { isGeneralElection: true, countryId: "US", votingSystem: "fptp" }
    );
    const withPres = distributeVotesBySwingFlow(
      fixtureCandidates(),
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      {
        isGeneralElection: true,
        countryId: "US",
        votingSystem: "fptp",
        presidentialModifierByParty: new Map([["dem", 1.09]]),
      }
    );
    expect(withPres.sharesPct["c1"]).toBeGreaterThan(base.sharesPct["c1"]);
  });

  it("is a no-op when presidentialModifierByParty is absent / empty", () => {
    const a = distributeVotesBySwingFlow(
      fixtureCandidates(),
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      { isGeneralElection: true, countryId: "US", votingSystem: "fptp" }
    );
    const b = distributeVotesBySwingFlow(
      fixtureCandidates(),
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      {
        isGeneralElection: true,
        countryId: "US",
        votingSystem: "fptp",
        presidentialModifierByParty: new Map(),
      }
    );
    expect(b.sharesPct).toEqual(a.sharesPct);
  });
});

describe("distributeVotesBySwingFlow — midterm opposition modifier", () => {
  it("raises an opposition party's nominal share by the configured counterweight", () => {
    const base = distributeVotesBySwingFlow(
      fixtureCandidates(),
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      { isGeneralElection: true, countryId: "UK", votingSystem: "fptp" }
    );
    const withMidterm = distributeVotesBySwingFlow(
      fixtureCandidates(),
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      {
        isGeneralElection: true,
        countryId: "UK",
        votingSystem: "fptp",
        midtermOppositionModifierByParty: new Map([["dem", 1.05]]),
      }
    );
    expect(withMidterm.sharesPct.c1).toBeGreaterThan(base.sharesPct.c1);
  });
});

describe("personal-reach org floor (#0671)", () => {
  it("a zero-org candidate with personal pull is no longer zeroed", () => {
    const enriched = fixtureCandidates();
    enriched[1].party = "ssp"; // c2's party has no org in this region
    const orgs = new Map([["dem", 50]]); // ssp absent → 0 org share
    const out = distributeVotesBySwingFlow(
      enriched,
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      orgs,
      { isGeneralElection: true, countryId: "US", votingSystem: "fptp" }
    );
    expect(out.votesPerCandidate.c2).toBeGreaterThan(0);
    expect(out.sharesPct.c2).toBeGreaterThan(0);
  });

  it("an OPS-banned (regimeMult 0) zero-org candidate stays at zero despite the floor", () => {
    const enriched = fixtureCandidates();
    enriched[1].party = "ssp";
    (enriched[1] as EnrichedCandidate).regimeMult = 0; // banned
    const orgs = new Map([["dem", 50]]);
    const out = distributeVotesBySwingFlow(
      enriched,
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      orgs,
      { isGeneralElection: true, countryId: "US", votingSystem: "fptp" }
    );
    expect(out.votesPerCandidate.c2).toBe(0);
  });
});

describe("vote reach floor for PI=0 candidates (#1034)", () => {
  it("swing-flow: a PI=0 player still gets votes against an NPP (not erased)", () => {
    const player: EnrichedCandidate = {
      candidateId: "player",
      party: "dem",
      isNPP: false,
      politicalInfluence: 0,
      nationalInfluence: 0,
      favorability: 50,
      support: 50,
      charEP: 0,
      charSP: 0,
      partyEcon: 0,
      partySocial: 0,
      archetypeApprovals: {},
      infamy: 0,
    } as EnrichedCandidate;
    const npp: EnrichedCandidate = {
      candidateId: "npp",
      party: "rep",
      isNPP: true,
      politicalInfluence: 20,
      nationalInfluence: 20,
      favorability: 65,
      support: 50,
      charEP: 1,
      charSP: 1,
      partyEcon: 1,
      partySocial: 1,
      archetypeApprovals: {},
      infamy: 0,
    } as EnrichedCandidate;
    const out = distributeVotesBySwingFlow(
      [player, npp],
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      { isGeneralElection: true, countryId: "US", votingSystem: "fptp" }
    );
    expect(out.votesPerCandidate.player).toBeGreaterThan(0);
    expect(out.sharesPct.player).toBeGreaterThan(0);
    // Still a steep disadvantage vs an NPP sitting on the PI=10+ floor.
    expect(out.votesPerCandidate.player).toBeLessThan(out.votesPerCandidate.npp);
  });

  it("legacy allocator: a PI=0 player still gets votes against an NPP", () => {
    const player: EnrichedCandidate = {
      candidateId: "player",
      party: "dem",
      isNPP: false,
      politicalInfluence: 0,
      nationalInfluence: 0,
      favorability: 50,
      support: 50,
      charEP: 0,
      charSP: 0,
      partyEcon: 0,
      partySocial: 0,
      archetypeApprovals: {},
      infamy: 0,
    } as EnrichedCandidate;
    const npp: EnrichedCandidate = {
      candidateId: "npp",
      party: "rep",
      isNPP: true,
      politicalInfluence: 20,
      nationalInfluence: 20,
      favorability: 65,
      support: 50,
      charEP: 1,
      charSP: 1,
      partyEcon: 1,
      partySocial: 1,
      archetypeApprovals: {},
      infamy: 0,
    } as EnrichedCandidate;
    const out = distributeVotesByGroupLevelAllocation(
      [player, npp],
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      { isGeneralElection: true, countryId: "US", votingSystem: "fptp" }
    );
    expect(out.votesPerCandidate.player).toBeGreaterThan(0);
    expect(out.votesPerCandidate.player).toBeLessThan(out.votesPerCandidate.npp);
  });

  it("approval=0 still fully zeros a candidate (floor does not override approval)", () => {
    const dead: EnrichedCandidate = {
      candidateId: "dead",
      party: "dem",
      isNPP: false,
      politicalInfluence: 0,
      nationalInfluence: 0,
      favorability: 0,
      support: 50,
      charEP: 0,
      charSP: 0,
      partyEcon: 0,
      partySocial: 0,
      archetypeApprovals: {},
      infamy: 0,
    } as EnrichedCandidate;
    const alive: EnrichedCandidate = {
      candidateId: "alive",
      party: "rep",
      isNPP: true,
      politicalInfluence: 20,
      nationalInfluence: 20,
      favorability: 50,
      support: 50,
      charEP: 1,
      charSP: 1,
      partyEcon: 1,
      partySocial: 1,
      archetypeApprovals: {},
      infamy: 0,
    } as EnrichedCandidate;
    const out = distributeVotesBySwingFlow(
      [dead, alive],
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      { isGeneralElection: true, countryId: "US", votingSystem: "fptp" }
    );
    expect(out.votesPerCandidate.dead).toBe(0);
    expect(out.votesPerCandidate.alive).toBeGreaterThan(0);
  });
});

// ─── Vote conservation in crowded races (2026-07-09 fix) ─────────────────────

/** N identical centrist candidates, one per party p1..pN (non-major so the
 * FPTP spoiler step stays inert and the swing layer is the only mover). */
function crowdedField(n: number): EnrichedCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    candidateId: `c${i + 1}`,
    party: `p${i + 1}`,
    isNPP: false,
    politicalInfluence: 60,
    nationalInfluence: 60,
    favorability: 50,
    support: 50,
    charEP: 0,
    charSP: 0,
    partyEcon: 0,
    partySocial: 0,
    archetypeApprovals: {},
    infamy: 0,
  })) as EnrichedCandidate[];
}

function runCrowded(enriched: EnrichedCandidate[], extra: Record<string, unknown> = {}) {
  return distributeVotesBySwingFlow(
    enriched,
    1_000_000,
    1_000_000,
    1_000_000,
    fixtureDemographics(),
    fixtureCategories(),
    new Map(),
    { isGeneralElection: true, countryId: "US", votingSystem: "fptp", ...extra }
  );
}

function totalVotes(out: { votesPerCandidate: Record<string, number> }): number {
  return Object.values(out.votesPerCandidate).reduce((s, v) => s + v, 0);
}

describe("distributeVotesBySwingFlow — vote conservation under multi-opponent peels", () => {
  it("conserves total votes in a crowded 8-party race with strong drivers against one party", () => {
    const enriched = crowdedField(8);
    // Every opponent of p1 is rich and defended a prior seat share; p1 has
    // nothing. Money + incumbency drivers are positive from p1 toward all 7
    // opponents, so p1's independently-computed pairwise peels historically
    // summed past its transferable pool.
    const funds = new Map(enriched.map((ec) => [ec.party, ec.party === "p1" ? 0 : 10_000_000]));
    const seats = new Map(enriched.map((ec) => [ec.party, ec.party === "p1" ? 0 : 1 / 7]));

    const baseline = runCrowded(crowdedField(8));
    const crowded = runCrowded(enriched, {
      fundsByParty: funds,
      incumbentSeatShareByParty: seats,
    });

    // Conservation invariant: swings move votes between parties, they never
    // mint or destroy them. Totals must match the driver-free baseline.
    expect(totalVotes(crowded)).toBeCloseTo(totalVotes(baseline), 3);
  });

  it("caps a party's total outflow at peelableFraction × pool even with 7 positive-driver opponents", () => {
    const enriched = crowdedField(8);
    const funds = new Map(enriched.map((ec) => [ec.party, ec.party === "p1" ? 0 : 10_000_000]));
    const seats = new Map(enriched.map((ec) => [ec.party, ec.party === "p1" ? 0 : 1 / 7]));

    const baseline = runCrowded(crowdedField(8));
    const crowded = runCrowded(enriched, {
      fundsByParty: funds,
      incumbentSeatShareByParty: seats,
    });

    // Symmetric baseline → p1's nominal share is total/8. With no Reg data
    // the peelable fraction is TRANSFERABLE_SHARE_NO_REG × (1 −
    // PERSUASION_RESISTANCE_NO_REG); p1 must keep at least (1 − peelable) of
    // its nominal pool no matter how many opponents pile on. Pre-fix, seven
    // independent pairwise peels bled ~peelable × Σ(drivers) > peelable.
    const peelable = TRANSFERABLE_SHARE_NO_REG * (1 - PERSUASION_RESISTANCE_NO_REG);
    const nominalP1 = baseline.votesPerCandidate.c1;
    expect(crowded.votesPerCandidate.c1).toBeGreaterThanOrEqual(nominalP1 * (1 - peelable) - 1e-6);
    // Drivers do move votes — p1 loses vs the neutral baseline.
    expect(crowded.votesPerCandidate.c1).toBeLessThan(nominalP1);
  });

  it("still conserves votes and preserves single-opponent behavior in a 2-party race", () => {
    const enriched = crowdedField(2);
    const funds = new Map<string, number>([
      ["p1", 0],
      ["p2", 10_000_000],
    ]);

    const baseline = runCrowded(crowdedField(2));
    const twoParty = runCrowded(enriched, { fundsByParty: funds });

    expect(totalVotes(twoParty)).toBeCloseTo(totalVotes(baseline), 3);
    // Single opponent: driver ≤ 1 keeps the peel under the cap, so the
    // rescale is a no-op and the peel lands in full on the rich party.
    expect(twoParty.votesPerCandidate.c2).toBeGreaterThan(twoParty.votesPerCandidate.c1);
    const peelable = TRANSFERABLE_SHARE_NO_REG * (1 - PERSUASION_RESISTANCE_NO_REG);
    expect(twoParty.votesPerCandidate.c1).toBeGreaterThanOrEqual(
      baseline.votesPerCandidate.c1 * (1 - peelable) - 1e-6
    );
  });
});

// ─── Regional bases + L2 party gate in the swing-flow kernel (2026-07-09) ────

describe("distributeVotesBySwingFlow — regional bases (state org / home state)", () => {
  function run(extra: Record<string, unknown> = {}) {
    return distributeVotesBySwingFlow(
      fixtureCandidates(),
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      { isGeneralElection: true, countryId: "US", votingSystem: "fptp", ...extra }
    );
  }

  it("stateOrgByCandidate raises the invested candidate's share (general caps)", () => {
    const base = run();
    const withOrg = run({ stateOrgByCandidate: new Map([["c1", 10]]) });
    expect(withOrg.sharesPct.c1).toBeGreaterThan(base.sharesPct.c1);
  });

  it("state-org level is uncapped but its bonus diminishes sharply", () => {
    // The level ladder no longer has a ceiling (2026-08-19): investment is
    // never wasted, so 99 must beat 10. What bounds it is the curve, not a cap
    // — see stateOrgBonusFraction. Level 10 delivers 75% of the maximum bonus,
    // so the entire remaining 89 levels are worth less than a third of what the
    // first 10 bought. That is what stops an unbounded treasury buying
    // unbounded vote weight.
    const base = run();
    const atReference = run({ stateOrgByCandidate: new Map([["c1", 10]]) });
    const farAbove = run({ stateOrgByCandidate: new Map([["c1", 99]]) });

    expect(farAbove.sharesPct.c1).toBeGreaterThan(atReference.sharesPct.c1);

    const firstTenGain = atReference.sharesPct.c1 - base.sharesPct.c1;
    const next89Gain = farAbove.sharesPct.c1 - atReference.sharesPct.c1;
    expect(next89Gain).toBeLessThan(firstTenGain / 2);
  });

  it("homeStateByCandidate bumps the candidate only in their home state", () => {
    const base = run({ currentStateId: "TS" });
    const home = run({
      currentStateId: "TS",
      homeStateByCandidate: new Map([["c1", "TS"]]),
    });
    const away = run({
      currentStateId: "TS",
      homeStateByCandidate: new Map([["c1", "ZZ"]]),
    });
    expect(home.sharesPct.c1).toBeGreaterThan(base.sharesPct.c1);
    expect(away.sharesPct).toEqual(base.sharesPct);
  });

  it("is a no-op when the maps are absent (regression guard)", () => {
    const a = run();
    const b = run({
      stateOrgByCandidate: new Map(),
      homeStateByCandidate: new Map(),
      currentStateId: "TS",
    });
    expect(b.sharesPct).toEqual(a.sharesPct);
  });
});

describe("distributeVotesBySwingFlow — L2 party-sign gate in appeal", () => {
  it("a leaning candidate whose party disagrees in sign loses the directional bonus", () => {
    const aligned = fixtureCandidates(); // c1 at (-1,-1) with party at (-1,-1)
    const misaligned = fixtureCandidates();
    misaligned[0].partyEcon = 1; // party sign flipped vs c1's own lean
    misaligned[0].partySocial = 1;

    const opts = { isGeneralElection: true, countryId: "US", votingSystem: "fptp" } as const;
    const a = distributeVotesBySwingFlow(
      aligned,
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      opts
    );
    const b = distributeVotesBySwingFlow(
      misaligned,
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      opts
    );
    expect(b.sharesPct.c1).toBeLessThan(a.sharesPct.c1);
  });
});

// ─── Personal-stat (PI/favorability) tenure erosion ─────────────────────────
//
// Root-cause coverage for the "same party wins every close race, every cycle,
// for 12 years" defect: politicalInfluence and favorability compound without
// any tenure-aware decay (see `personalStatTenureRetention`'s doc comment in
// electionFormulaFactors.ts). These tests prove (a) the retention curve's own
// shape, (b) that a fresh (first-term) incumbent still gets the full, genuine
// PI/favorability advantage the game intends, and (c) that erosion measurably
// narrows an entrenched incumbent's margin without ever zeroing them out.
//
// The multi-cycle simulations below carry a long note on what this channel
// does NOT deliver, and why: with the stats compounding unopposed, only the
// retired points form's outright deletion of a candidate could flip the seat,
// and that is the behaviour this change exists to remove.

describe("personalStatTenureRetention", () => {
  it("is a full 1.0 no-op for a first term / undefined / non-finite tenure", () => {
    expect(personalStatTenureRetention(undefined)).toBe(1);
    expect(personalStatTenureRetention(1)).toBe(1);
    expect(personalStatTenureRetention(NaN)).toBe(1);
    expect(personalStatTenureRetention(0)).toBe(1);
  });

  it("erodes linearly per consecutive term beyond the first, then caps", () => {
    expect(personalStatTenureRetention(2)).toBeCloseTo(
      1 - PERSONAL_STAT_TENURE_EROSION_PER_TERM,
      10
    );
    expect(personalStatTenureRetention(3)).toBeCloseTo(
      1 - PERSONAL_STAT_TENURE_EROSION_PER_TERM * 2,
      10
    );
    // Capped — doesn't grow without bound across an arbitrarily long tenure.
    expect(personalStatTenureRetention(50)).toBeCloseTo(1 - PERSONAL_STAT_TENURE_EROSION_MAX, 10);
  });

  it("never reaches zero, so no tenure can delete a candidate outright", () => {
    // The retired points form hit 0 politicalInfluence at four terms for an
    // ordinary candidate; this is the invariant that replaced it.
    for (const terms of [2, 5, 12, 40, 1000]) {
      expect(personalStatTenureRetention(terms)).toBeGreaterThan(0);
    }
    expect(PERSONAL_STAT_TENURE_EROSION_MAX).toBeLessThan(1);
  });
});

describe("appealWeight — personal-stat tenure fatigue (executive own-race)", () => {
  // Positions identical (0,0 both) so appeal/org/persuasion are neutral —
  // isolates the reach (PI) / approval (favorability) channel the fatigue
  // targets. Large PI/favorability gap mirrors the measured 654-turn world
  // (3.6x PI, +28pt favorability between the recurring incumbent and a
  // challenger who never held the seat).
  function tenuredCandidates(): EnrichedCandidate[] {
    return [
      {
        candidateId: "incumbent",
        party: "A",
        isNPP: false,
        politicalInfluence: 90,
        nationalInfluence: 90,
        favorability: 90,
        support: 50,
        charEP: 0,
        charSP: 0,
        archetypeApprovals: {},
        infamy: 0,
      } as EnrichedCandidate,
      {
        candidateId: "challenger",
        party: "B",
        isNPP: false,
        politicalInfluence: 10,
        nationalInfluence: 10,
        favorability: 10,
        support: 50,
        charEP: 0,
        charSP: 0,
        archetypeApprovals: {},
        infamy: 0,
      } as EnrichedCandidate,
    ];
  }

  function runWithTerms(consecutiveTerms: number | undefined) {
    const opts: DistributeVotesOptions = {
      isGeneralElection: true,
      countryId: "US",
      votingSystem: "fptp",
      useNationalInfluenceForReach: true,
      includeInfluenceInAppeal: false,
      incumbentPartyId: "A",
      incumbentApproval: 60,
      incumbentConsecutiveTerms: consecutiveTerms,
    };
    return distributeVotesBySwingFlow(
      tenuredCandidates(),
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      opts
    );
  }

  it("a first-term incumbent keeps the FULL, genuine PI/favorability advantage", () => {
    const first = runWithTerms(1);
    // Guard against over-correction: at term 1 (no fatigue at all) the
    // 80-point PI/favorability gap must still confer a real, decisive edge —
    // incumbency has to remain genuinely advantageous, not neutered into a
    // coin flip.
    expect(first.sharesPct.incumbent).toBeGreaterThan(first.sharesPct.challenger);
    expect(first.sharesPct.incumbent / first.sharesPct.challenger).toBeGreaterThan(2);
  });

  it("the advantage shrinks monotonically as consecutive terms accumulate", () => {
    const t1 = runWithTerms(1);
    const t2 = runWithTerms(2);
    const t4 = runWithTerms(4);
    const t6 = runWithTerms(6);
    // Deep into a decade+ of uninterrupted tenure — fatigue (10pts/term)
    // has long since exceeded the raw 80-point PI/favorability gap, so
    // reach/approval floor at 0 for both. Two different, sufficiently-large
    // term counts should land on the identical floored result.
    const tFloored1 = runWithTerms(15);
    const tFloored2 = runWithTerms(25);

    const ratio = (r: typeof t1) => r.sharesPct.incumbent / r.sharesPct.challenger;

    expect(ratio(t2)).toBeLessThan(ratio(t1));
    expect(ratio(t4)).toBeLessThan(ratio(t2));
    expect(ratio(t6)).toBeLessThan(ratio(t4));
    // Still a real (if shrunk) edge at 6 consecutive terms.
    expect(ratio(t6)).toBeGreaterThan(1);
    // Once fatigue has floored PI/favorability's contribution, further
    // tenure can't erode it any further — the result stops moving.
    expect(tFloored1.sharesPct.incumbent).toBeCloseTo(tFloored2.sharesPct.incumbent, 5);
  });

  it("an untracked race family (no tenure data) never applies fatigue", () => {
    // Same incumbentPartyId/incumbentApproval in both calls (so the SWING-side
    // incumbency driver is unaffected) — only incumbentConsecutiveTerms is
    // withheld, isolating the personal-stat fatigue this test targets.
    const noTenureData = distributeVotesBySwingFlow(
      tenuredCandidates(),
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      {
        isGeneralElection: true,
        countryId: "US",
        votingSystem: "fptp",
        useNationalInfluenceForReach: true,
        includeInfluenceInAppeal: false,
        incumbentPartyId: "A",
        incumbentApproval: 60,
        // No incumbentConsecutiveTerms — matches an untracked race family
        // (e.g. US House's multi-seat aggregate).
      }
    );
    const withTermOne = runWithTerms(1);
    expect(noTenureData.sharesPct.incumbent).toBeCloseTo(withTermOne.sharesPct.incumbent, 5);
  });
});

describe("multi-cycle simulation — entrenched incumbency vs. a genuinely better challenger", () => {
  // Models the actual bug end-to-end: politicalInfluence/favorability accrue
  // every term the incumbent holds the seat (mirroring the real, uncapped
  // campaign/advertise growth in src/lib/actions.ts and
  // src/lib/turn/nppActionProcessing.ts) and only decay toward a floor for
  // the out-of-office side (mirroring src/lib/turn/actionRefresh.ts). Party
  // A opens as a modest first-term incumbent (a mild policy misalignment —
  // charEP/SP 1.0 vs the electorate's center — offset by an early PI/
  // favorability lead) against party B, who sits exactly at the electorate's
  // center (genuinely better fundamentals on the merits) but starts behind
  // on PI/favorability. `withFatigue` toggles whether
  // `incumbentConsecutiveTerms` is threaded through (the fix); when it's
  // withheld this reproduces the pre-fix bug.
  function simulate(withFatigue: boolean, cycles: number) {
    let incumbentParty: string | null = "A";
    let consecutiveTerms = 0;
    let piA = 60;
    let favA = 60;
    let piB = 40;
    let favB = 40;
    const winners: string[] = [];
    const margins: number[] = [];

    for (let cycle = 0; cycle < cycles; cycle++) {
      const candidates: EnrichedCandidate[] = [
        {
          candidateId: "A",
          party: "A",
          isNPP: false,
          politicalInfluence: piA,
          nationalInfluence: piA,
          favorability: favA,
          support: 50,
          // Mildly off-center — a slightly worse fit for this electorate.
          charEP: 1.0,
          charSP: 1.0,
          archetypeApprovals: {},
          infamy: 0,
        } as EnrichedCandidate,
        {
          candidateId: "B",
          party: "B",
          isNPP: false,
          politicalInfluence: piB,
          nationalInfluence: piB,
          favorability: favB,
          support: 50,
          // Dead-center — genuinely better fit for this electorate.
          charEP: 0,
          charSP: 0,
          archetypeApprovals: {},
          infamy: 0,
        } as EnrichedCandidate,
      ];

      const opts: DistributeVotesOptions = {
        isGeneralElection: true,
        countryId: "US",
        votingSystem: "fptp",
        useNationalInfluenceForReach: true,
        includeInfluenceInAppeal: false,
        ...(incumbentParty
          ? {
              incumbentPartyId: incumbentParty,
              incumbentApproval: 60,
              ...(withFatigue ? { incumbentConsecutiveTerms: consecutiveTerms } : {}),
            }
          : {}),
      };

      const { sharesPct } = distributeVotesBySwingFlow(
        candidates,
        1_000_000,
        1_000_000,
        1_000_000,
        fixtureDemographics(),
        fixtureCategories(),
        new Map(),
        opts
      );

      const winner = sharesPct.A >= sharesPct.B ? "A" : "B";
      winners.push(winner);
      margins.push(Math.abs(sharesPct.A - sharesPct.B));

      if (winner === incumbentParty) {
        consecutiveTerms += 1;
      } else {
        incumbentParty = winner;
        consecutiveTerms = 1;
      }

      // Growth/decay mirrors the real, uncapped per-turn arithmetic: the
      // winner's PI/favorability climbs toward the cap, the loser's decays
      // toward the floor. This is the actual defect under test — the
      // election engine must remain contestable even though these inputs
      // never mean-revert on their own.
      if (winner === "A") {
        piA = Math.min(100, piA + 10);
        favA = Math.min(100, favA + 10);
        piB = Math.max(10, piB - 5);
        favB = Math.max(10, favB - 5);
      } else {
        piB = Math.min(100, piB + 10);
        favB = Math.min(100, favB + 10);
        piA = Math.max(10, piA - 5);
        favA = Math.max(10, favA - 5);
      }
    }

    return { winners, margins };
  }

  function longestRun(winners: string[]): number {
    let longest = 1;
    let current = 1;
    for (let i = 1; i < winners.length; i++) {
      current = winners[i] === winners[i - 1] ? current + 1 : 1;
      longest = Math.max(longest, current);
    }
    return longest;
  }

  it("BUG REPRODUCTION — without tenure erosion, the entrenched incumbent wins every cycle for 20 straight cycles", () => {
    const { winners } = simulate(false, 20);
    // Once A wins its first term, uncapped PI/favorability compounding locks
    // it in — every subsequent cycle, forever. This is the audit's
    // "same party wins every close race, every cycle, for 12 years" bug,
    // reproduced directly: 20 cycles, 0 changes of control.
    expect(new Set(winners)).toEqual(new Set(["A"]));
    expect(longestRun(winners)).toBe(20);
  });

  // ── What this channel does, and what it deliberately does NOT do ─────────
  //
  // This pair of tests used to assert that tenure fatigue made control change
  // hands inside twenty cycles. It did — but only because the retired
  // points-subtraction form charged up to 100 points against stats that top
  // out at 100, so a long-serving incumbent's favorability reached EXACTLY
  // zero, and `approvalScalar(0)` is a hard zero: the incumbent was awarded
  // literally no votes. That is annihilation, not contestability, and it is
  // the same mechanism that handed a first-time nominee 87.8% and all eight
  // Florida House seats on live turn 522 (see `personalStatTenureRetention`'s
  // doc comment in electionFormulaFactors.ts).
  //
  // Measured with the real engine over this fixture, sweeping a retention
  // floor from 1.0 down to 0.05: control NEVER changes hands at any floor
  // above zero, and the incumbent's steady-state margin only falls from
  // 87.2pp to 70.4pp. The old assertion was therefore unsatisfiable by any
  // proportional erosion — it could only ever be met by deleting a candidate.
  //
  // The reason is upstream of this channel and is not a vote-engine defect:
  // in this fixture A's PI/favorability compound 60 -> 100 while B's decay
  // 40 -> 10, because neither stat mean-reverts per cycle the way
  // `electionCandidates.support` does. A 10x stat gap is not something a
  // nominal-share multiplier should be sized to overturn. Restoring genuine
  // contestability means giving PI/favorability that mean reversion in the
  // stats themselves; until then this channel is an honest tilt against
  // entrenchment, and the assertion below is what it actually delivers.
  it("tenure erosion narrows the entrenched incumbent's margin every cycle it holds the seat", () => {
    const eroded = simulate(true, 20);
    const untouched = simulate(false, 20);
    // Same winner every cycle in both runs, so the margins are directly
    // comparable cycle-for-cycle.
    expect(eroded.winners).toEqual(untouched.winners);
    // Erosion first applies at the third cycle (consecutiveTerms reaches 2);
    // from there the incumbent's margin is strictly smaller than it would
    // have been without the channel.
    for (let cycle = 2; cycle < 20; cycle++) {
      expect(eroded.margins[cycle]).toBeLessThan(untouched.margins[cycle]);
    }
  });

  it("but it never zeroes the incumbent out — the seat is taxed, not confiscated", () => {
    const { margins } = simulate(true, 20);
    // A margin of 100pp means the loser received no votes at all. The retired
    // points form reached exactly that; a retention fraction cannot.
    for (const margin of margins) expect(margin).toBeLessThan(100);
  });
});

// ─── US House: per-candidate multi-seat tenure fatigue ─────────────────────
//
// The House can't use the single scalar `incumbentConsecutiveTerms` /
// `legislativeIncumbentPartyId` pair — a state's delegation can have several
// simultaneous incumbents (one per party's returning nominee) at once — so
// this exercises `houseIncumbentTenureTermsByCandidateId`, a per-candidateId
// map. See `resolveHouseIncumbentTenures`'s doc comment in
// singleSeatIncumbency.ts for why the House needs this different shape.

describe("appealWeight — House per-candidate tenure fatigue", () => {
  function tenuredHouseCandidates(): EnrichedCandidate[] {
    return [
      {
        candidateId: "incumbent",
        party: "A",
        isNPP: false,
        politicalInfluence: 90,
        nationalInfluence: 90,
        favorability: 90,
        support: 50,
        charEP: 0,
        charSP: 0,
        archetypeApprovals: {},
        infamy: 0,
      } as EnrichedCandidate,
      {
        candidateId: "challenger",
        party: "B",
        isNPP: false,
        politicalInfluence: 10,
        nationalInfluence: 10,
        favorability: 10,
        support: 50,
        charEP: 0,
        charSP: 0,
        archetypeApprovals: {},
        infamy: 0,
      } as EnrichedCandidate,
    ];
  }

  function runWithHouseTerms(terms: number | undefined) {
    const houseIncumbentTenureTermsByCandidateId =
      terms == null ? undefined : new Map([["incumbent", terms]]);
    const opts: DistributeVotesOptions = {
      isGeneralElection: true,
      countryId: "US",
      votingSystem: "fptp",
      useNationalInfluenceForReach: true,
      includeInfluenceInAppeal: false,
      houseIncumbentTenureTermsByCandidateId,
    };
    return distributeVotesBySwingFlow(
      tenuredHouseCandidates(),
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      opts
    );
  }

  it("no tenure entry (open seat / fresh nominee) is a complete no-op", () => {
    const noEntry = runWithHouseTerms(undefined);
    const termOne = runWithHouseTerms(1);
    expect(noEntry.sharesPct.incumbent).toBeCloseTo(termOne.sharesPct.incumbent, 5);
  });

  it("a first-term House incumbent keeps the full PI/favorability advantage", () => {
    const first = runWithHouseTerms(1);
    expect(first.sharesPct.incumbent).toBeGreaterThan(first.sharesPct.challenger);
    expect(first.sharesPct.incumbent / first.sharesPct.challenger).toBeGreaterThan(2);
  });

  it("the advantage shrinks monotonically as one candidate's consecutive terms accumulate", () => {
    const t1 = runWithHouseTerms(1);
    const t2 = runWithHouseTerms(2);
    const t4 = runWithHouseTerms(4);
    const ratio = (r: typeof t1) => r.sharesPct.incumbent / r.sharesPct.challenger;
    expect(ratio(t2)).toBeLessThan(ratio(t1));
    expect(ratio(t4)).toBeLessThan(ratio(t2));
    expect(ratio(t4)).toBeGreaterThan(1); // still a real edge, just eroded
  });

  it("only the tenured candidateId is fatigued — a same-race rival with no entry is untouched", () => {
    // Give ONLY "incumbent" a tenure entry; "challenger" has none. Confirms the
    // fatigue keys off candidateId (per-candidate), not party or race-wide.
    const opts: DistributeVotesOptions = {
      isGeneralElection: true,
      countryId: "US",
      votingSystem: "fptp",
      useNationalInfluenceForReach: true,
      includeInfluenceInAppeal: false,
      houseIncumbentTenureTermsByCandidateId: new Map([["incumbent", 6]]),
    };
    const fatigued = distributeVotesBySwingFlow(
      tenuredHouseCandidates(),
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      opts
    );
    const baseline = runWithHouseTerms(undefined);
    // The incumbent's share should have fallen relative to the untouched
    // baseline; the untenured challenger's underlying inputs are identical
    // either way, so any shift in their share is purely the renormalized
    // complement of the incumbent's fatigue-shrunk share.
    expect(fatigued.sharesPct.incumbent).toBeLessThan(baseline.sharesPct.incumbent);
  });
});

// ─── Tenure erosion is proportional, so it can never delete a candidate ─────
//
// Regression coverage for the live 1962 US House defect (FL, turn 522): a
// state's two returning nominees had each contested five prior cycles, so both
// carried five terms of tenure. The erosion of the day subtracted a flat 10
// POINTS per term from politicalInfluence and favorability — 40 points at five
// terms — which drove both incumbents' influence to zero (floored at
// VOTE_REACH_FLOOR) and more than halved their favorability. A first-time
// nominee for a party holding 1.7% of the state's registration took 87.8% of
// the vote and all eight seats. 41 of 55 active House races carried the same
// erosion; the shape recurred wherever both major-party nominees were
// long-serving and a new party fielded a fresh face.
//
// The root cause is the OPERATOR, not just its size: subtracting fixed points
// from a 0-100 stat erases a candidate whose stat is small, while barely
// scratching one whose stat is large. Erosion is proportional now, so a
// candidate keeps a fixed FRACTION of their standing no matter how long they
// have served, and the ordering the rest of the engine computes survives.
describe("appealWeight — tenure erosion never deletes a long-serving candidate", () => {
  // Modelled on the live FL race: two long-tenured incumbents with ordinary
  // stats, against a fresh nominee whose stats are only marginally better.
  function floridaShapedRace(): EnrichedCandidate[] {
    return [
      {
        candidateId: "fresh", // Frances Ortiz (CUP) — first-time nominee
        party: "C",
        isNPP: true,
        politicalInfluence: 42.7,
        nationalInfluence: 42.7,
        favorability: 78.4,
        support: 50,
        charEP: 0.8,
        charSP: 1.6,
        archetypeApprovals: {},
        infamy: 0,
      } as EnrichedCandidate,
      {
        candidateId: "tenuredHighPi", // Joseph Grant (FLP) — five terms
        party: "A",
        isNPP: true,
        politicalInfluence: 40.0,
        nationalInfluence: 40.0,
        favorability: 75.9,
        support: 50,
        charEP: -0.5,
        charSP: 1.0,
        archetypeApprovals: {},
        infamy: 0,
      } as EnrichedCandidate,
      {
        candidateId: "tenuredLowPi", // Lisa Ross (DEM) — five terms, low PI
        party: "B",
        isNPP: true,
        politicalInfluence: 26.6,
        nationalInfluence: 26.6,
        favorability: 73.3,
        support: 50,
        charEP: 0.8,
        charSP: 1.1,
        archetypeApprovals: {},
        infamy: 0,
      } as EnrichedCandidate,
    ];
  }

  function runFlorida(terms: number) {
    const opts: DistributeVotesOptions = {
      isGeneralElection: true,
      countryId: "US",
      votingSystem: "fptp",
      useNationalInfluenceForReach: false,
      includeInfluenceInAppeal: false,
      houseIncumbentTenureTermsByCandidateId: new Map([
        ["tenuredHighPi", terms],
        ["tenuredLowPi", terms],
      ]),
    };
    return distributeVotesBySwingFlow(
      floridaShapedRace(),
      1_000_000,
      1_000_000,
      1_000_000,
      fixtureDemographics(),
      fixtureCategories(),
      new Map(),
      opts
    );
  }

  it("a fresh nominee cannot sweep a field of long-serving rivals with comparable stats", () => {
    const { sharesPct } = runFlorida(5);
    // The live defect put the fresh nominee at 87.8% with the two incumbents
    // on 10.1% and 2.1%. Tenure is a tilt, not a deletion: no candidate whose
    // underlying stats are competitive may be reduced to a rounding error.
    expect(sharesPct.fresh).toBeLessThan(55);
    expect(sharesPct.tenuredHighPi).toBeGreaterThan(15);
    expect(sharesPct.tenuredLowPi).toBeGreaterThan(15);
  });

  it("erosion saturates — an unbounded tenure cannot drive a candidate to zero", () => {
    // MAX_HOUSE_TENURE_LOOKBACK is 12, but the curve must hold past it: the
    // flat-points form hit zero PI at four terms for an ordinary candidate and
    // zero favorability (hence zero votes) at eleven.
    const long = runFlorida(40);
    expect(long.sharesPct.tenuredLowPi).toBeGreaterThan(10);
    // Saturated: past the cap, further terms change nothing at all.
    const longer = runFlorida(120);
    expect(longer.sharesPct.tenuredLowPi).toBeCloseTo(long.sharesPct.tenuredLowPi, 6);
  });

  it("a low-stat incumbent is eroded no harder, in relative terms, than a high-stat one", () => {
    // The flat-points form was regressive: 40 points took 100% of a PI-26.6
    // candidate and 0% of a PI-40 one. Proportional erosion is scale-free, so
    // both incumbents keep the same fraction of their unfatigued share.
    const base = runFlorida(1); // first term — no erosion
    const worn = runFlorida(6);
    const retention = (id: string) => worn.sharesPct[id] / base.sharesPct[id];
    expect(retention("tenuredLowPi")).toBeCloseTo(retention("tenuredHighPi"), 1);
  });
});

describe("multi-cycle simulation — US House control can change hands", () => {
  // Two parties' House nominees for one state's delegation. Mirrors the
  // presidential/Senate simulation above but keys tenure per-candidateId
  // (`houseIncumbentTenureTermsByCandidateId`) instead of a single scalar,
  // since a multi-seat race can carry more than one simultaneous incumbent.
  function simulateHouse(
    withFatigue: boolean,
    cycles: number,
    opts: { rivalIsGenuinelyBetter: boolean }
  ) {
    let incumbentCandidateId: string | null = "A";
    let consecutiveTerms = 0;
    let piA = 60;
    let favA = 60;
    let piB = 40;
    let favB = 40;
    const winners: string[] = [];
    const sharesA: number[] = [];

    for (let cycle = 0; cycle < cycles; cycle++) {
      const candidates: EnrichedCandidate[] = [
        {
          candidateId: "A",
          party: "A",
          isNPP: false,
          politicalInfluence: piA,
          nationalInfluence: piA,
          favorability: favA,
          support: 50,
          charEP: opts.rivalIsGenuinelyBetter ? 1.0 : 0,
          charSP: opts.rivalIsGenuinelyBetter ? 1.0 : 0,
          archetypeApprovals: {},
          infamy: 0,
        } as EnrichedCandidate,
        {
          candidateId: "B",
          party: "B",
          isNPP: false,
          politicalInfluence: piB,
          nationalInfluence: piB,
          favorability: favB,
          support: 50,
          charEP: 0,
          charSP: 0,
          archetypeApprovals: {},
          infamy: 0,
        } as EnrichedCandidate,
      ];

      const houseIncumbentTenureTermsByCandidateId =
        withFatigue && incumbentCandidateId
          ? new Map([[incumbentCandidateId, consecutiveTerms]])
          : undefined;

      const opts2: DistributeVotesOptions = {
        isGeneralElection: true,
        countryId: "US",
        votingSystem: "fptp",
        useNationalInfluenceForReach: true,
        includeInfluenceInAppeal: false,
        houseIncumbentTenureTermsByCandidateId,
      };

      const { sharesPct } = distributeVotesBySwingFlow(
        candidates,
        1_000_000,
        1_000_000,
        1_000_000,
        fixtureDemographics(),
        fixtureCategories(),
        new Map(),
        opts2
      );

      const winner = sharesPct.A >= sharesPct.B ? "A" : "B";
      winners.push(winner);
      sharesA.push(sharesPct.A);

      if (winner === incumbentCandidateId) {
        consecutiveTerms += 1;
      } else {
        incumbentCandidateId = winner;
        consecutiveTerms = 1;
      }

      // Same uncapped growth/decay the real campaign/advertise actions
      // produce absent any per-cycle mean-reversion.
      if (winner === "A") {
        piA = Math.min(100, piA + 10);
        favA = Math.min(100, favA + 10);
        piB = Math.max(10, piB - 5);
        favB = Math.max(10, favB - 5);
      } else {
        piB = Math.min(100, piB + 10);
        favB = Math.min(100, favB + 10);
        piA = Math.max(10, piA - 5);
        favA = Math.max(10, favA - 5);
      }
    }

    return { winners, sharesA };
  }

  it("erosion narrows a long-serving House incumbent's margin without ever zeroing them", () => {
    // B is genuinely the better fit (A starts 1.0 off-center). This used to
    // assert that erosion let B take the delegation within twenty cycles; it
    // only ever did so because the retired points form drove A's favorability
    // to exactly zero, which awards zero votes. See the long note on the
    // presidential/Senate simulation above for the measurement, and
    // `personalStatTenureRetention`'s doc comment for the live House race
    // that behaviour produced. What the channel honestly guarantees is that
    // the tax is real and that it never becomes a confiscation.
    const eroded = simulateHouse(true, 20, { rivalIsGenuinelyBetter: true });
    const untouched = simulateHouse(false, 20, { rivalIsGenuinelyBetter: true });
    expect(eroded.winners).toEqual(untouched.winners);
    // The tax is real: from the third cycle on (consecutiveTerms reaches 2)
    // A's share is strictly below what it would have been with no erosion.
    for (let cycle = 2; cycle < 20; cycle++) {
      expect(eroded.sharesA[cycle]).toBeLessThan(untouched.sharesA[cycle]);
    }
    // And it is never a confiscation: the incumbent stays a live candidate
    // with a real share at every point in a twenty-cycle tenure.
    for (const share of eroded.sharesA) expect(share).toBeGreaterThan(5);
  });

  it("a strong incumbent still usually wins when fundamentals are otherwise equal", () => {
    // Neither candidate is off-center here — the only edge A has is the
    // genuine, real PI/favorability incumbency advantage. Tenure erosion
    // shrinks that advantage over TIME but must not neuter it turn one: A
    // should still win most cycles, not merely at chance (~50%).
    const { winners } = simulateHouse(true, 20, { rivalIsGenuinelyBetter: false });
    const aWins = winners.filter((w) => w === "A").length;
    expect(aWins).toBeGreaterThan(winners.length / 2);
  });
});
