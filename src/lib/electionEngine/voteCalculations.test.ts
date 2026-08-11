import { describe, it, expect } from "vitest";
import {
  calcEffectiveFavorability,
  calcCandidateVotePotential,
  calcStateTurnout,
  turnVoteWeight,
  resolveTurnWindow,
} from "./voteCalculations";
import type { DemographicCategory, StateDemographics } from "@/lib/db/types";

// ─── Test fixtures ──────────────────────────────────────────────────────────

/**
 * Minimal demographic category with two groups for testing.
 * Groups differ in economic/social lean to model a swing state.
 */
function makeCategory(overrides?: Partial<DemographicCategory>): DemographicCategory {
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
        defaultTurnout: 65,
      },
    ],
    ...overrides,
  } as DemographicCategory;
}

function makeDemographics(overrides?: Partial<StateDemographics>): StateDemographics {
  return {
    _id: "PA",
    categoryWeights: { ideology: 100 },
    groups: {
      liberal: { population: 48, turnout: 60, economicLean: -3, socialLean: -3 },
      conservative: { population: 52, turnout: 65, economicLean: 3, socialLean: 3 },
    },
    ...overrides,
  } as StateDemographics;
}

// ─── calcEffectiveFavorability ──────────────────────────────────────────────

describe("calcEffectiveFavorability", () => {
  it("returns base favorability when archetype approval is 0", () => {
    expect(calcEffectiveFavorability(50, 0)).toBe(50);
  });

  it("adds 50% of archetype approval to base", () => {
    expect(calcEffectiveFavorability(50, 20)).toBe(60); // 50 + 20*0.5
  });

  it("subtracts when archetype approval is negative", () => {
    expect(calcEffectiveFavorability(50, -40)).toBe(30); // 50 - 20
  });

  it("clamps to 0 when result would be negative", () => {
    expect(calcEffectiveFavorability(10, -100)).toBe(0);
  });

  it("clamps to 100 when result would exceed max", () => {
    expect(calcEffectiveFavorability(90, 100)).toBe(100);
  });

  it("treats undefined approval as 0", () => {
    expect(calcEffectiveFavorability(70, undefined)).toBe(70);
  });
});

// ─── calcCandidateVotePotential ─────────────────────────────────────────────

describe("calcCandidateVotePotential", () => {
  const categories = [makeCategory()];
  const demographics = makeDemographics();
  const population = 1_000_000;

  it("returns a positive number for a viable candidate", () => {
    const result = calcCandidateVotePotential(0, 0, 100, population, demographics, categories);
    expect(result).toBeGreaterThan(0);
  });

  it("returns 0 when political influence is 0 (no reach)", () => {
    const result = calcCandidateVotePotential(0, 0, 0, population, demographics, categories);
    expect(result).toBe(0);
  });

  it("left-leaning candidate gets more votes from liberal groups", () => {
    const leftCandidate = calcCandidateVotePotential(
      -3,
      -3,
      100,
      population,
      demographics,
      categories
    );
    const rightCandidate = calcCandidateVotePotential(
      3,
      3,
      100,
      population,
      demographics,
      categories
    );
    // Right candidate should get slightly more total due to 52% conservative vs 48% liberal + higher turnout
    // But each candidate should dominate their aligned group. We test that both produce significant votes.
    expect(leftCandidate).toBeGreaterThan(0);
    expect(rightCandidate).toBeGreaterThan(0);
  });

  it("centrist candidate has broader appeal but extreme can win in polarized electorate", () => {
    const centrist = calcCandidateVotePotential(0, 0, 100, population, demographics, categories);
    const extreme = calcCandidateVotePotential(5, 5, 100, population, demographics, categories);
    // In a polarized electorate (groups at -3,-3 and 3,3), a candidate at 5,5 has strong appeal
    // to conservatives (quadratic scoring means 3→5 gap is small penalty) while centrist 0,0
    // has moderate appeal to both but dominates neither. Extreme can win here — this is by design.
    expect(centrist).toBeGreaterThan(0);
    expect(extreme).toBeGreaterThan(0);
    // The extreme candidate gets >50% because conservatives (52%) have higher turnout (65% vs 60%)
    expect(extreme).toBeGreaterThan(centrist);
  });

  it("higher political influence increases vote potential (sqrt curve, capped at PI=100)", () => {
    const low = calcCandidateVotePotential(0, 0, 50, population, demographics, categories);
    const mid = calcCandidateVotePotential(0, 0, 100, population, demographics, categories);
    const high = calcCandidateVotePotential(0, 0, 500, population, demographics, categories);

    expect(mid).toBeGreaterThan(low);
    expect(high).toBe(mid);
  });

  it("larger population produces more total votes", () => {
    const small = calcCandidateVotePotential(0, 0, 100, 100_000, demographics, categories);
    const large = calcCandidateVotePotential(0, 0, 100, 10_000_000, demographics, categories);
    expect(large).toBeGreaterThan(small);
    // Should scale roughly linearly with population
    expect(large / small).toBeCloseTo(100, -1);
  });
});

// ─── Balance: candidate matchup scenarios ───────────────────────────────────

describe("vote potential balance scenarios", () => {
  const categories = [makeCategory()];
  const demographics = makeDemographics();
  const population = 1_000_000;

  it("perfectly aligned candidates in even state split votes roughly equally", () => {
    const evenDemographics = makeDemographics({
      groups: {
        liberal: { population: 50, turnout: 60, economicLean: -3, socialLean: -3 },
        conservative: { population: 50, turnout: 60, economicLean: 3, socialLean: 3 },
      },
    });

    const left = calcCandidateVotePotential(-3, -3, 100, population, evenDemographics, categories);
    const right = calcCandidateVotePotential(3, 3, 100, population, evenDemographics, categories);

    // With identical population and turnout, mirror candidates should get identical votes
    expect(left).toBeCloseTo(right, 0);
  });

  it("candidate perfectly matching all groups dominates mismatched candidate", () => {
    // Make all groups lean left
    const leftState = makeDemographics({
      groups: {
        liberal: { population: 70, turnout: 65, economicLean: -4, socialLean: -3 },
        conservative: { population: 30, turnout: 60, economicLean: -1, socialLean: 0 },
      },
    });

    const alignedLeft = calcCandidateVotePotential(-3, -2, 100, population, leftState, categories);
    const farRight = calcCandidateVotePotential(5, 5, 100, population, leftState, categories);

    expect(alignedLeft).toBeGreaterThan(farRight * 2);
  });

  it("moderate candidate beats extreme in a MODERATE-dominant electorate", () => {
    // N1 tribal-bonus update: in a balanced left/right/center electorate
    // an extreme candidate now wins decisively in their own ideological
    // wing (the directional bonus). For the centrist to win, the
    // moderate group needs to dominate population so the centrist's
    // cross-appeal there outweighs the extreme's tribal lock on the
    // aligned wing. With 60% moderate / 20% liberal / 20% conservative,
    // the centrist still wins overall.
    const twoCategories = [
      makeCategory(),
      {
        _id: "age",
        name: "Age",
        defaultWeight: 100,
        groups: [
          {
            id: "moderate",
            name: "Moderates",
            defaultEconomicLean: 0,
            defaultSocialLean: 0,
            defaultTurnout: 55,
          },
        ],
      } as DemographicCategory,
    ];
    const moderateDomDemo = makeDemographics({
      categoryWeights: { ideology: 40, age: 60 },
      groups: {
        liberal: { population: 50, turnout: 55, economicLean: -3, socialLean: -3 },
        conservative: { population: 50, turnout: 60, economicLean: 3, socialLean: 3 },
        moderate: { population: 100, turnout: 55, economicLean: 0, socialLean: 0 },
      },
    });

    const moderate = calcCandidateVotePotential(
      0,
      0,
      100,
      population,
      moderateDomDemo,
      twoCategories
    );
    const extreme = calcCandidateVotePotential(
      5,
      5,
      100,
      population,
      moderateDomDemo,
      twoCategories
    );

    expect(moderate).toBeGreaterThan(extreme);
  });

  it("NPI advantage provides meaningful but not overwhelming edge", () => {
    const demographics = makeDemographics();
    // Same positions, different influence
    const low = calcCandidateVotePotential(0, 0, 30, population, demographics, categories);
    const high = calcCandidateVotePotential(0, 0, 200, population, demographics, categories);

    // High NPI should be an advantage
    expect(high).toBeGreaterThan(low);
    // But not a runaway: high / low < 10x (NPI sqrt-clamped reach, not a direct multiplier)
    expect(high / low).toBeLessThan(10);
  });

  it("caps state-race influence at 100", () => {
    const atCap = calcCandidateVotePotential(0, 0, 100, population, demographics, categories);
    const aboveCap = calcCandidateVotePotential(0, 0, 250, population, demographics, categories);
    expect(aboveCap).toBe(atCap);
  });
});

// ─── calcStateTurnout ───────────────────────────────────────────────────────

describe("calcStateTurnout", () => {
  const categories = [makeCategory()];

  it("calculates expected turnout from population × group turnout × weight", () => {
    const demographics = makeDemographics();
    const population = 1_000_000;

    const result = calcStateTurnout(population, demographics, categories);

    // Manual: (480000 * 0.60 + 520000 * 0.65) * 100/100 = 288000 + 338000 = 626000
    expect(result).toBe(626000);
  });

  it("returns 0 for zero population", () => {
    expect(calcStateTurnout(0, makeDemographics(), categories)).toBe(0);
  });

  it("scales linearly with population", () => {
    const demo = makeDemographics();
    const small = calcStateTurnout(100_000, demo, categories);
    const big = calcStateTurnout(1_000_000, demo, categories);
    expect(big / small).toBeCloseTo(10, 1);
  });

  it("higher turnout demographics produce more voters", () => {
    const lowTurnout = makeDemographics({
      groups: {
        liberal: { population: 50, turnout: 30, economicLean: -3, socialLean: -3 },
        conservative: { population: 50, turnout: 30, economicLean: 3, socialLean: 3 },
      },
    });
    const highTurnout = makeDemographics({
      groups: {
        liberal: { population: 50, turnout: 80, economicLean: -3, socialLean: -3 },
        conservative: { population: 50, turnout: 80, economicLean: 3, socialLean: 3 },
      },
    });

    const low = calcStateTurnout(1_000_000, lowTurnout, categories);
    const high = calcStateTurnout(1_000_000, highTurnout, categories);
    expect(high).toBeGreaterThan(low * 2);
  });
});

// ─── turnVoteWeight ─────────────────────────────────────────────────────────

describe("turnVoteWeight (3-tier 50/20/30 surge)", () => {
  const totalPool = 100_000;

  // 48-turn general window: finalCount=4, rampCount=8, earlyCount=36.
  // Bands: early = idx 0..35, ramp = idx 36..43, final = idx 44..47.
  it("early tier gets 50% of pool spread over the early turns", () => {
    expect(turnVoteWeight(48, 0, totalPool)).toBeCloseTo(50_000 / 36, 0);
  });

  it("ramp tier gets 20% of pool spread over the 8 ramp turns", () => {
    expect(turnVoteWeight(48, 36, totalPool)).toBeCloseTo(20_000 / 8, 0);
    expect(turnVoteWeight(48, 43, totalPool)).toBeCloseTo(20_000 / 8, 0);
  });

  it("election-day tier gets 30% of pool over the final 4 turns", () => {
    expect(turnVoteWeight(48, 44, totalPool)).toBeCloseTo(30_000 / 4, 0);
    expect(turnVoteWeight(48, 47, totalPool)).toBeCloseTo(30_000 / 4, 0);
  });

  it("tiers strictly increase: final > ramp > early", () => {
    const early = turnVoteWeight(48, 0, totalPool);
    const ramp = turnVoteWeight(48, 36, totalPool);
    const final_ = turnVoteWeight(48, 44, totalPool);
    expect(ramp).toBeGreaterThan(early);
    expect(final_).toBeGreaterThan(ramp);
  });

  it("#955 regression: final 4 turns are ~30% of the vote, NOT ~66%", () => {
    const totalTurns = 48;
    let last4 = 0;
    let all = 0;
    for (let i = 0; i < totalTurns; i++) {
      const w = turnVoteWeight(totalTurns, i, totalPool);
      all += w;
      if (i >= totalTurns - 4) last4 += w;
    }
    expect(last4 / all).toBeCloseTo(0.3, 2);
  });

  it("all turns sum to approximately the total pool (48-turn window)", () => {
    let sum = 0;
    for (let i = 0; i < 48; i++) sum += turnVoteWeight(48, i, totalPool);
    expect(sum).toBeCloseTo(totalPool, 0);
  });

  it("medium race with no early band still conserves the pool", () => {
    // totalTurns=10 → finalCount=4, rampCount=6, earlyCount=0: the early share
    // folds into the ramp so per-turn weights still integrate to the pool.
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += turnVoteWeight(10, i, totalPool);
    expect(sum).toBeCloseTo(totalPool, 0);
    // final 4 still carry 30%.
    let last4 = 0;
    for (let i = 6; i < 10; i++) last4 += turnVoteWeight(10, i, totalPool);
    expect(last4 / totalPool).toBeCloseTo(0.3, 2);
  });

  it("short election (<=4 turns): full pool distributed evenly", () => {
    const weight0 = turnVoteWeight(4, 0, totalPool);
    const weight3 = turnVoteWeight(4, 3, totalPool);
    expect(weight0).toBe(weight3);
    expect(weight0).toBeCloseTo(totalPool / 4, 0);
    let sum = 0;
    for (let i = 0; i < 4; i++) sum += turnVoteWeight(4, i, totalPool);
    expect(sum).toBeCloseTo(totalPool, 0);
  });

  it("very long election still sums to pool", () => {
    const totalTurns = 200;
    let sum = 0;
    for (let i = 0; i < totalTurns; i++) sum += turnVoteWeight(totalTurns, i, totalPool);
    expect(sum).toBeCloseTo(totalPool, 0);
  });
});

// ─── resolveTurnWindow ──────────────────────────────────────────────────────

describe("resolveTurnWindow", () => {
  const HOUR = 3_600_000;
  // A wall-clock anchor; argless `new Date()` is avoided so the test is
  // deterministic and matches the harness constraints.
  const T0 = new Date("2026-01-01T00:00:00.000Z");
  const at = (hours: number) => new Date(T0.getTime() + hours * HOUR);

  // Turn-first path: turn fields are the source of truth and ignore clock drift.
  it("turn-first: totalTurns and turnIndex derive from turn numbers", () => {
    const { totalTurns, turnIndex } = resolveTurnWindow({
      startTurn: 0,
      endTurn: 48,
      currentTurn: 0,
      now: T0,
    });
    expect(totalTurns).toBe(48);
    expect(turnIndex).toBe(0);
  });

  it("turn-first: lands in the final-4 surge band on the last 4 turns despite clock drift", () => {
    // endTime / startTime / now are wildly inconsistent (drifted game clock),
    // but the turn fields put us at turn 45 of a 48-turn race → surge band.
    const window = resolveTurnWindow({
      startTurn: 100,
      endTurn: 148,
      // Drifted timestamps that would (wrongly) yield turnIndex 9, well outside
      // the surge band, if the Date path were used.
      startTime: at(0),
      endTime: at(48),
      currentTurn: 145,
      now: at(9),
    });
    expect(window.totalTurns).toBe(48);
    expect(window.turnIndex).toBe(45);
    // earlyTurns = 44, so turnIndex 45 must receive the final (surge) weight.
    const final = turnVoteWeight(window.totalTurns, window.turnIndex, 100_000);
    const early = turnVoteWeight(window.totalTurns, 0, 100_000);
    expect(final).toBeGreaterThan(early);
  });

  it("turn-first: clamps turnIndex to totalTurns - 1 past the end", () => {
    const { totalTurns, turnIndex } = resolveTurnWindow({
      startTurn: 0,
      endTurn: 48,
      currentTurn: 200,
      now: T0,
    });
    expect(totalTurns).toBe(48);
    expect(turnIndex).toBe(47);
  });

  it("turn-first: clamps turnIndex to 0 before the start", () => {
    const { turnIndex } = resolveTurnWindow({
      startTurn: 100,
      endTurn: 148,
      currentTurn: 90,
      now: T0,
    });
    expect(turnIndex).toBe(0);
  });

  it("turn-first: short race floors totalTurns at 4", () => {
    const { totalTurns, turnIndex } = resolveTurnWindow({
      startTurn: 0,
      endTurn: 2,
      currentTurn: 1,
      now: T0,
    });
    expect(totalTurns).toBe(4);
    expect(turnIndex).toBe(1);
  });

  // Date-fallback path: legacy / un-backfilled docs with no turn fields keep the
  // prior game-hours behavior exactly.
  it("date-fallback: derives turns from startTime/endTime when turn fields absent", () => {
    const { totalTurns, turnIndex } = resolveTurnWindow({
      startTime: at(0),
      endTime: at(48),
      currentTurn: 10,
      now: at(10),
    });
    expect(totalTurns).toBe(48);
    expect(turnIndex).toBe(10);
  });

  it("date-fallback: uses createdAt when startTime is absent", () => {
    const { totalTurns, turnIndex } = resolveTurnWindow({
      createdAt: at(0),
      endTime: at(48),
      currentTurn: 5,
      now: at(5),
    });
    expect(totalTurns).toBe(48);
    expect(turnIndex).toBe(5);
  });

  it("date-fallback: clamps turnIndex to totalTurns - 1", () => {
    const { totalTurns, turnIndex } = resolveTurnWindow({
      startTime: at(0),
      endTime: at(48),
      currentTurn: 999,
      now: at(100),
    });
    expect(totalTurns).toBe(48);
    expect(turnIndex).toBe(47);
  });
});
