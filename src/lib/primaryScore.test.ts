/**
 * Pure function tests for primary score calculations.
 * No DB mocking needed — tests determinism, edge cases, and scoring ranges.
 */
import { describe, it, expect } from "vitest";
import {
  calcPrimaryScore,
  calcPresidentPrimaryScore,
  primarySharePctSoftmax,
  effectivePartyInfluenceForPresidentialPrimary,
  buildPartyChairMaps,
  resolvePartyChairPrimaryRole,
  buildPartyChairIdSet,
} from "./primaryScore";

describe("calcPrimaryScore", () => {
  it("returns maximum score for perfect alignment, high favorability, high influence", () => {
    // Perfect party alignment (0 diff), 100% favorability, capped influence
    const score = calcPrimaryScore(5, 5, 5, 5, 100, 1000);
    expect(score).toBeGreaterThan(0);
    // calcPrimaryScore caps PI at 100 internally; max raw = 40 + 35 + 25 = 100
    expect(score).toBeGreaterThan(90);
  });

  it("returns zero or near-zero for worst case", () => {
    // Max policy distance, 0 favorability, 0 influence
    const score = calcPrimaryScore(-10, -10, 10, 10, 0, 0);
    // alignment = max(0, 40 - 40*2) = 0, fav = 0, inf = 0
    expect(score).toBe(0);
  });

  it("is deterministic — same inputs always produce same output", () => {
    const args = [3, -2, 5, 1, 65, 200] as const;
    const results = Array.from({ length: 20 }, () => calcPrimaryScore(...args));
    expect(new Set(results).size).toBe(1);
  });

  it("higher favorability increases score", () => {
    const low = calcPrimaryScore(0, 0, 0, 0, 30, 50);
    const high = calcPrimaryScore(0, 0, 0, 0, 80, 50);
    expect(high).toBeGreaterThan(low);
  });

  it("higher political influence increases score", () => {
    const low = calcPrimaryScore(0, 0, 0, 0, 50, 10);
    const high = calcPrimaryScore(0, 0, 0, 0, 50, 500);
    expect(high).toBeGreaterThan(low);
  });

  it("caps state-race influence at 100 for scoring", () => {
    const atCap = calcPrimaryScore(0, 0, 0, 0, 50, 100);
    const aboveCap = calcPrimaryScore(0, 0, 0, 0, 50, 500);
    expect(aboveCap).toBe(atCap);
  });

  it("caps favorability at 100 for scoring", () => {
    const atCap = calcPrimaryScore(0, 0, 0, 0, 100, 50);
    const aboveCap = calcPrimaryScore(0, 0, 0, 0, 140, 50);
    expect(aboveCap).toBe(atCap);
  });

  it("worse party alignment decreases score", () => {
    const aligned = calcPrimaryScore(5, 5, 5, 5, 50, 100);
    const misaligned = calcPrimaryScore(-5, -5, 5, 5, 50, 100);
    expect(aligned).toBeGreaterThan(misaligned);
  });

  it("uses split alignment when state lean is provided", () => {
    // Candidate (1, 1.75) vs Party (2, 2) vs State (1, 1)
    // With state: align_state(25) closer + align_party(15) → higher than party-only baseline
    const withState = calcPrimaryScore(1, 1.75, 2, 2, 50, 50, 0, 1, 1);
    const withoutState = calcPrimaryScore(1, 1.75, 2, 2, 50, 50);
    expect(withState).toBeGreaterThan(withoutState);
  });

  it("falls back to 40-pt party alignment when state lean is null/undefined (one or both)", () => {
    const noState = calcPrimaryScore(1, 1.75, 2, 2, 50, 50);
    const onlyEcon = calcPrimaryScore(1, 1.75, 2, 2, 50, 50, 0, 1, null);
    const onlySocial = calcPrimaryScore(1, 1.75, 2, 2, 50, 50, 0, null, 1);
    const onlyEconUndef = calcPrimaryScore(1, 1.75, 2, 2, 50, 50, 0, 1, undefined);
    const onlySocialUndef = calcPrimaryScore(1, 1.75, 2, 2, 50, 50, 0, undefined, 1);
    expect(onlyEcon).toBe(noState);
    expect(onlySocial).toBe(noState);
    expect(onlyEconUndef).toBe(noState);
    expect(onlySocialUndef).toBe(noState);
  });

  it("infamy reduces score by ~5% at infamy=100", () => {
    const clean = calcPrimaryScore(0, 0, 0, 0, 100, 100, 0);
    const infamous = calcPrimaryScore(0, 0, 0, 0, 100, 100, 100);
    expect(infamous / clean).toBeCloseTo(0.95, 4);
  });

  it("infamy=0 (or undefined) leaves score unchanged", () => {
    const undef = calcPrimaryScore(0, 0, 0, 0, 100, 100);
    const zero = calcPrimaryScore(0, 0, 0, 0, 100, 100, 0);
    expect(zero).toBe(undef);
  });

  it("state alignment dominates party alignment (Hiven/Noem real-world case)", () => {
    // Texas leans roughly +1 econ, +0.5 social
    // GOP party position: +2 / +2
    // Hiven (1, 1.75): farther from TX than Noem (1, 1.0)
    // With state weighting at 25/15 + Noem's higher fav and PI, Noem should win
    const stateEcon = 1;
    const stateSocial = 0.5;
    const hiven = calcPrimaryScore(1, 1.75, 2, 2, 97.7, 84.2, 12.6, stateEcon, stateSocial);
    const noem = calcPrimaryScore(1, 1.0, 2, 2, 98.0, 92.1, 0.0, stateEcon, stateSocial);
    expect(noem).toBeGreaterThan(hiven);
  });
});

describe("calcPresidentPrimaryScore", () => {
  it("returns maximum score for perfect inputs", () => {
    // 7th arg is partyInfluence (~0-150 scale); 150 maxes the party-clout lever.
    const score = calcPresidentPrimaryScore(5, 5, 5, 5, 100, 1000, 150);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeGreaterThan(90);
  });

  it("returns zero or near-zero for worst case", () => {
    const score = calcPresidentPrimaryScore(-10, -10, 10, 10, 0, 0, 0);
    expect(score).toBe(0);
  });

  it("is deterministic", () => {
    const args = [3, -2, 5, 1, 65, 200, 50] as const;
    const results = Array.from({ length: 20 }, () => calcPresidentPrimaryScore(...args));
    expect(new Set(results).size).toBe(1);
  });

  it("higher party influence increases score", () => {
    const low = calcPresidentPrimaryScore(0, 0, 0, 0, 50, 100, 10);
    const high = calcPresidentPrimaryScore(0, 0, 0, 0, 50, 100, 90);
    expect(high).toBeGreaterThan(low);
  });

  it("party influence is linear and uncapped (no ceiling at 150)", () => {
    // At/below the reference scale the lever is linear as before...
    const below = calcPresidentPrimaryScore(0, 0, 0, 0, 50, 100, 100);
    const atScale = calcPresidentPrimaryScore(0, 0, 0, 0, 50, 100, 150);
    expect(atScale).toBeGreaterThan(below);
    // ...and it KEEPS paying off above the reference scale rather than pinning.
    // partyInfluence 300 = 2× the scale → party component 60 (vs 30 at scale),
    // and the extra 30 pts is exactly (300-150)/150 * WEIGHT(30) above `atScale`.
    const overScale = calcPresidentPrimaryScore(0, 0, 0, 0, 50, 100, 300);
    expect(overScale).toBeGreaterThan(atScale);
    expect(overScale - atScale).toBeCloseTo(30, 5);
  });

  it("caps presidential favorability at 100 for scoring", () => {
    const atCap = calcPresidentPrimaryScore(0, 0, 0, 0, 100, 100, 50);
    const aboveCap = calcPresidentPrimaryScore(0, 0, 0, 0, 125, 100, 50);
    expect(aboveCap).toBe(atCap);
  });

  it("weights party influence more than national reach", () => {
    const base = calcPresidentPrimaryScore(0, 0, 0, 0, 0, 0, 0);
    const withPartyInfluence = calcPresidentPrimaryScore(0, 0, 0, 0, 0, 0, 150);
    const withReach = calcPresidentPrimaryScore(0, 0, 0, 0, 0, 600, 0);
    // Party influence weight (30) > national reach weight (20)
    expect(withPartyInfluence - base).toBeGreaterThan(withReach - base);
  });

  it("effectivePartyInfluenceForPresidentialPrimary: chairs get no inherent boost (reverted)", () => {
    // Chair role no longer amplifies party influence in presidential primaries.
    // The raw value passes through unchanged for every role and geography.
    expect(effectivePartyInfluenceForPresidentialPrimary(100, null)).toBe(100);
    expect(effectivePartyInfluenceForPresidentialPrimary(100, "national")).toBe(100);
    expect(effectivePartyInfluenceForPresidentialPrimary(100, "state")).toBe(100);
    // In chair state — still no boost
    expect(
      effectivePartyInfluenceForPresidentialPrimary(100, "state", {
        currentStateId: "PA",
        chairStateIds: ["PA"],
        countryId: "US",
      })
    ).toBe(100);
    // Adjacent (PA↔NJ) — still no boost
    expect(
      effectivePartyInfluenceForPresidentialPrimary(100, "state", {
        currentStateId: "NJ",
        chairStateIds: ["PA"],
        countryId: "US",
      })
    ).toBe(100);
    // Negative clamps to 0
    expect(effectivePartyInfluenceForPresidentialPrimary(-5, "national")).toBe(0);
  });

  it("chair role does not change presidential primary score (boost removed)", () => {
    const raw = 100;
    const without = calcPresidentPrimaryScore(
      0,
      0,
      0,
      0,
      50,
      100,
      effectivePartyInfluenceForPresidentialPrimary(raw, null)
    );
    const withChair = calcPresidentPrimaryScore(
      0,
      0,
      0,
      0,
      50,
      100,
      effectivePartyInfluenceForPresidentialPrimary(raw, "national")
    );
    expect(withChair).toBe(without);
  });

  it("buildPartyChairMaps separates national and state chairs", () => {
    const national = { toString: () => "national-chair" };
    const state = { toString: () => "state-chair" };
    const maps = buildPartyChairMaps([{ chairId: national }], [{ chairId: state, stateId: "PA" }]);
    expect(maps.nationalChairIds.has("national-chair")).toBe(true);
    expect(maps.stateChairStatesByCharacterId.get("state-chair")).toEqual(["PA"]);
    expect(resolvePartyChairPrimaryRole("national-chair", maps)).toBe("national");
    expect(resolvePartyChairPrimaryRole("state-chair", maps)).toBe("state");
    expect(resolvePartyChairPrimaryRole("nobody", maps)).toBe(null);
    // Deprecated union helper still works
    const ids = buildPartyChairIdSet([{ chairId: national }], [{ chairId: state }]);
    expect(ids.has("national-chair")).toBe(true);
    expect(ids.has("state-chair")).toBe(true);
  });

  it("weights national influence more than favorability", () => {
    // Compare adding influence vs adding favorability from a baseline
    const base = calcPresidentPrimaryScore(0, 0, 0, 0, 0, 0, 0);
    const withInfluence = calcPresidentPrimaryScore(0, 0, 0, 0, 0, 500, 0);
    const withFav = calcPresidentPrimaryScore(0, 0, 0, 0, 100, 0, 0);
    // Influence coefficient (20) > favorability coefficient (10)
    expect(withInfluence - base).toBeGreaterThan(withFav - base);
  });

  it("national influence keeps growing past 100 with diminishing returns (no hard cap)", () => {
    const atHundred = calcPresidentPrimaryScore(0, 0, 0, 0, 50, 100, 50);
    const above = calcPresidentPrimaryScore(0, 0, 0, 0, 50, 200, 50);
    // The reach curve is `1 − exp(−NPI/45)` — strictly increasing forever.
    // The function rounds to 1 decimal, so NPI=200 should score noticeably
    // higher than NPI=100 (200 → 0.988 vs 100 → 0.892 on the reach side).
    expect(above).toBeGreaterThan(atHundred);
  });

  it("infamy=100 reduces presidential primary score by ~5%", () => {
    const clean = calcPresidentPrimaryScore(0, 0, 0, 0, 100, 100, 100, 0);
    const infamous = calcPresidentPrimaryScore(0, 0, 0, 0, 100, 100, 100, 100);
    // 1-decimal rounding in calcPresidentPrimaryScore introduces ~0.001
    // precision loss when the raw score doesn't land on a clean 0.1
    // boundary. The infamy penalty itself is exactly 5%; tolerance reflects
    // the rounding step, not curve drift.
    expect(infamous / clean).toBeCloseTo(0.95, 2);
  });

  it("undefined infamy leaves presidential score unchanged", () => {
    const undef = calcPresidentPrimaryScore(0, 0, 0, 0, 100, 100, 100);
    const zero = calcPresidentPrimaryScore(0, 0, 0, 0, 100, 100, 100, 0);
    expect(zero).toBe(undef);
  });
});

describe("primarySharePctSoftmax", () => {
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

  it("handles empty and singleton fields", () => {
    expect(primarySharePctSoftmax([])).toEqual([]);
    expect(primarySharePctSoftmax([42])).toEqual([100]);
  });

  it("shares sum to ~100 and stay index-aligned", () => {
    const shares = primarySharePctSoftmax([90.1, 86.6, 83.5]);
    expect(sum(shares)).toBeCloseTo(100, 0);
    expect(shares[0]).toBeGreaterThan(shares[1]);
    expect(shares[1]).toBeGreaterThan(shares[2]);
  });

  it("decompresses a near-tie harder than the linear mapping", () => {
    const scores = [90.1, 86.6, 83.5];
    const soft = primarySharePctSoftmax(scores);
    const total = sum(scores);
    const linearLead = (scores[0] / total) * 100;
    // Softmax leader share exceeds the linear leader share (34.6% here → ~48%).
    expect(soft[0]).toBeGreaterThan(linearLead);
    expect(soft[0]).toBeCloseTo(48, 0);
  });

  it("is monotonic — never reorders candidates", () => {
    const shares = primarySharePctSoftmax([70, 80, 75]);
    // index 1 (score 80) is the leader, index 0 (70) the trailer
    expect(shares[1]).toBeGreaterThan(shares[2]);
    expect(shares[2]).toBeGreaterThan(shares[0]);
  });

  it("splits an all-equal field evenly", () => {
    const shares = primarySharePctSoftmax([50, 50, 50, 50]);
    for (const s of shares) expect(s).toBeCloseTo(25, 1);
  });
});
