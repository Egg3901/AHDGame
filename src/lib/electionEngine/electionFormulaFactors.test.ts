import { describe, expect, it } from "vitest";
import {
  REG_BASELINE_EXPONENT,
  REG_BASELINE_MIN_SHARE,
  REG_RESISTANCE_MAX_BONUS,
  SUPPORT_MOOD_CEILING,
  SUPPORT_MOOD_FLOOR,
  normalizedOrgShare,
  orgVoteWeight,
  ORG_WEIGHT_EXPONENT,
  personalOrgFloor,
  PERSONAL_ORG_FLOOR_CAP,
  applyVoteReachFloor,
  VOTE_REACH_FLOOR,
  regBaselineMultiplier,
  regResistanceMultiplier,
  supportMoodMultiplier,
} from "./electionFormulaFactors";

describe("normalizedOrgShare", () => {
  it("returns own Org / sum across all parties", () => {
    const map = new Map([
      ["dem", 30],
      ["gop", 50],
      ["green", 20],
    ]);
    expect(normalizedOrgShare(map, "dem")).toBeCloseTo(30 / 100);
    expect(normalizedOrgShare(map, "gop")).toBeCloseTo(50 / 100);
    expect(normalizedOrgShare(map, "green")).toBeCloseTo(20 / 100);
  });

  it("normalized shares sum to 1 across all parties present in the map", () => {
    const map = new Map([
      ["a", 12.5],
      ["b", 17.3],
      ["c", 8.4],
    ]);
    const sum =
      normalizedOrgShare(map, "a") + normalizedOrgShare(map, "b") + normalizedOrgShare(map, "c");
    expect(sum).toBeCloseTo(1);
  });

  it("returns 1 when only one party is in the state", () => {
    const map = new Map([["dem", 25]]);
    expect(normalizedOrgShare(map, "dem")).toBe(1);
  });

  it("returns 0 when total Org is 0 (no party has presence)", () => {
    const map = new Map([
      ["dem", 0],
      ["gop", 0],
    ]);
    expect(normalizedOrgShare(map, "dem")).toBe(0);
  });

  it("returns 0 for an unknown / missing party", () => {
    const map = new Map([
      ["dem", 30],
      ["gop", 70],
    ]);
    expect(normalizedOrgShare(map, "green")).toBe(0);
  });

  it("treats negative Orgs as 0 (defensive)", () => {
    const map = new Map([
      ["dem", -5],
      ["gop", 100],
    ]);
    expect(normalizedOrgShare(map, "dem")).toBe(0);
    expect(normalizedOrgShare(map, "gop")).toBe(1);
  });

  it("preserves relative ordering (party with more Org has larger share)", () => {
    const map = new Map([
      ["dem", 40],
      ["gop", 35],
      ["green", 25],
    ]);
    expect(normalizedOrgShare(map, "dem")).toBeGreaterThan(normalizedOrgShare(map, "gop"));
    expect(normalizedOrgShare(map, "gop")).toBeGreaterThan(normalizedOrgShare(map, "green"));
  });
});

describe("orgVoteWeight (diminishing-returns curve)", () => {
  it("uses a sub-linear exponent (diminishing returns)", () => {
    // 2026-07-09 recalibration: 0.2 (was 0.5 sqrt). Sub-linear is the
    // invariant; the exact value is A/B-swept balance tuning.
    expect(ORG_WEIGHT_EXPONENT).toBe(0.2);
    expect(ORG_WEIGHT_EXPONENT).toBeLessThan(1);
    expect(ORG_WEIGHT_EXPONENT).toBeGreaterThan(0);
  });

  it("returns neutral 1 when there is no Org data anywhere", () => {
    expect(orgVoteWeight(new Map(), "dem")).toBe(1);
    expect(orgVoteWeight(new Map([["dem", 0]]), "dem")).toBe(1);
  });

  it("returns 0 for a party with no Org in a populated state (gate preserved)", () => {
    const map = new Map([
      ["dem", 40],
      ["gop", 20],
    ]);
    expect(orgVoteWeight(map, "green")).toBe(0);
  });

  it("compresses the Org advantage vs the linear share (ratio^exponent)", () => {
    const map = new Map([
      ["dem", 30],
      ["gop", 10],
    ]);
    // Linear share ratio is 3:1; the curve compresses it to 3^exponent : 1
    // (~1.25:1 at the 2026-07-09 exponent of 0.2, vs 1.73:1 at the old sqrt).
    const ratio = orgVoteWeight(map, "dem") / orgVoteWeight(map, "gop");
    expect(ratio).toBeCloseTo(Math.pow(3, ORG_WEIGHT_EXPONENT), 5);
    // Resulting 2-way share (equal appeal) stays well below the linear 75%.
    const share =
      orgVoteWeight(map, "dem") / (orgVoteWeight(map, "dem") + orgVoteWeight(map, "gop"));
    expect(share).toBeGreaterThan(0.5);
    expect(share).toBeLessThan(0.67);
  });

  it("preserves relative ordering (more Org still means more weight)", () => {
    const map = new Map([
      ["dem", 40],
      ["gop", 35],
      ["green", 25],
    ]);
    expect(orgVoteWeight(map, "dem")).toBeGreaterThan(orgVoteWeight(map, "gop"));
    expect(orgVoteWeight(map, "gop")).toBeGreaterThan(orgVoteWeight(map, "green"));
  });
});

describe("regResistanceMultiplier", () => {
  it("returns 1.0 (neutral) for undefined / null / NaN / 0", () => {
    expect(regResistanceMultiplier(undefined)).toBe(1.0);
    expect(regResistanceMultiplier(NaN)).toBe(1.0);
    expect(regResistanceMultiplier(0)).toBe(1.0);
  });

  it("returns 1.0 for negative Reg (defensive)", () => {
    expect(regResistanceMultiplier(-5)).toBe(1.0);
  });

  it("returns 1.0 + REG_RESISTANCE_MAX_BONUS at 100% Reg", () => {
    expect(regResistanceMultiplier(100)).toBeCloseTo(1 + REG_RESISTANCE_MAX_BONUS);
  });

  it("interpolates linearly between 0 and 100", () => {
    expect(regResistanceMultiplier(50)).toBeCloseTo(1 + REG_RESISTANCE_MAX_BONUS * 0.5);
    expect(regResistanceMultiplier(25)).toBeCloseTo(1 + REG_RESISTANCE_MAX_BONUS * 0.25);
  });

  it("clamps Reg above 100 to the ceiling (defensive against bad data)", () => {
    expect(regResistanceMultiplier(200)).toBeCloseTo(1 + REG_RESISTANCE_MAX_BONUS);
  });

  it("monotonically non-decreasing in Reg", () => {
    let last = 0;
    for (let r = 0; r <= 100; r += 5) {
      const m = regResistanceMultiplier(r);
      expect(m).toBeGreaterThanOrEqual(last);
      last = m;
    }
  });
});

describe("supportMoodMultiplier", () => {
  it("returns 1.0 (neutral) for undefined / NaN", () => {
    expect(supportMoodMultiplier(undefined)).toBe(1.0);
    expect(supportMoodMultiplier(NaN)).toBe(1.0);
  });

  it("returns SUPPORT_MOOD_FLOOR at support=0", () => {
    expect(supportMoodMultiplier(0)).toBeCloseTo(SUPPORT_MOOD_FLOOR);
  });

  it("returns 1.0 at support=50 (default neutral)", () => {
    expect(supportMoodMultiplier(50)).toBeCloseTo(1.0);
  });

  it("returns SUPPORT_MOOD_CEILING at support=100", () => {
    expect(supportMoodMultiplier(100)).toBeCloseTo(SUPPORT_MOOD_CEILING);
  });

  it("clamps support outside [0, 100] to the band edges", () => {
    expect(supportMoodMultiplier(-10)).toBeCloseTo(SUPPORT_MOOD_FLOOR);
    expect(supportMoodMultiplier(200)).toBeCloseTo(SUPPORT_MOOD_CEILING);
  });

  it("monotonically non-decreasing in support", () => {
    let last = 0;
    for (let s = 0; s <= 100; s += 5) {
      const m = supportMoodMultiplier(s);
      expect(m).toBeGreaterThanOrEqual(last);
      last = m;
    }
  });

  it("symmetric around support=50 in penalty/bonus magnitude", () => {
    const at0 = supportMoodMultiplier(0);
    const at50 = supportMoodMultiplier(50);
    const at100 = supportMoodMultiplier(100);
    expect(at50 - at0).toBeCloseTo(at100 - at50);
  });
});

describe("Phase 5a formula factor invariants", () => {
  it("all factors return 1.0 (neutral) for undefined inputs (bootstrap-deferred default)", () => {
    expect(regResistanceMultiplier(undefined)).toBe(1.0);
    expect(supportMoodMultiplier(undefined)).toBe(1.0);
    // normalizedOrgShare returns 0 for missing party — this is intentional and
    // documented; a missing party has no presence, not "neutral" share.
  });

  it("factors are bounded — no factor can drive weights to infinity or below 0", () => {
    for (let v = -50; v <= 200; v += 10) {
      const reg = regResistanceMultiplier(v);
      const sup = supportMoodMultiplier(v);
      expect(reg).toBeGreaterThanOrEqual(1.0);
      expect(reg).toBeLessThanOrEqual(1 + REG_RESISTANCE_MAX_BONUS);
      expect(sup).toBeGreaterThanOrEqual(SUPPORT_MOOD_FLOOR);
      expect(sup).toBeLessThanOrEqual(SUPPORT_MOOD_CEILING);
    }
  });
});

describe("regBaselineMultiplier (seeded party-baseline share)", () => {
  it("COMPATIBILITY CONTRACT: returns exactly 1.0 when the share is absent", () => {
    // Worlds without seeded registrationShare (all pre-existing worlds, every
    // US/DE/JP lane) must be byte-identical — exactly 1.0, not approximately.
    expect(regBaselineMultiplier(undefined)).toBe(1.0);
    expect(regBaselineMultiplier(NaN)).toBe(1.0);
  });

  it("is concave share^REG_BASELINE_EXPONENT when present", () => {
    expect(REG_BASELINE_EXPONENT).toBe(0.5);
    expect(regBaselineMultiplier(100)).toBeCloseTo(1.0, 10);
    expect(regBaselineMultiplier(48.8)).toBeCloseTo(Math.sqrt(0.488), 10);
    expect(regBaselineMultiplier(25)).toBeCloseTo(0.5, 10);
  });

  it("puts a 2.5%-share party at ~0.16x (single-digit vote share after normalization)", () => {
    // 1951 UK Liberals: 2.5% polling vs Labour ~49%. The old org^0.2 lane
    // alone left them at ~24% of the vote; sqrt(0.025) ≈ 0.158 fixes that.
    expect(regBaselineMultiplier(2.5)).toBeCloseTo(Math.sqrt(0.025), 10);
    expect(regBaselineMultiplier(2.5) / regBaselineMultiplier(49)).toBeLessThan(0.25);
  });

  it("floors seeded-zero shares at REG_BASELINE_MIN_SHARE instead of hard-zeroing", () => {
    // e.g. SNP's 1951 Scotland row is seeded 0 — crushed, but not literally 0
    // (Org gate and appeal still decide the rest).
    expect(regBaselineMultiplier(0)).toBeCloseTo(
      Math.pow(REG_BASELINE_MIN_SHARE, REG_BASELINE_EXPONENT),
      10
    );
    expect(regBaselineMultiplier(0)).toBeGreaterThan(0);
    expect(regBaselineMultiplier(-5)).toBe(regBaselineMultiplier(0));
  });

  it("clamps shares above 100 (defensive)", () => {
    expect(regBaselineMultiplier(150)).toBeCloseTo(1.0, 10);
  });

  it("is monotonically non-decreasing in share", () => {
    let last = 0;
    for (let s = 0; s <= 100; s += 5) {
      const m = regBaselineMultiplier(s);
      expect(m).toBeGreaterThanOrEqual(last);
      last = m;
    }
  });
});

describe("personalOrgFloor", () => {
  it("scales with reach × approval, capped at PERSONAL_ORG_FLOOR_CAP", () => {
    expect(PERSONAL_ORG_FLOOR_CAP).toBe(0.1);
    expect(personalOrgFloor(1, 1)).toBeCloseTo(0.1, 6); // the cap
    expect(personalOrgFloor(0.632, 0.5)).toBeCloseTo(0.0316, 4); // Ciarán (Midlands)
  });
  it("is zero when either reach or approval is zero", () => {
    expect(personalOrgFloor(0, 0.9)).toBe(0);
    expect(personalOrgFloor(0.9, 0)).toBe(0);
  });
  it("clamps negative inputs to zero (defensive)", () => {
    expect(personalOrgFloor(-1, 0.5)).toBe(0);
    expect(personalOrgFloor(0.5, -1)).toBe(0);
  });
});

describe("applyVoteReachFloor (#1034)", () => {
  it("is equivalent to normalizeNPI(1) ≈ √0.01", () => {
    expect(VOTE_REACH_FLOOR).toBeCloseTo(Math.sqrt(0.01), 10);
  });
  it("raises sub-floor reach up to VOTE_REACH_FLOOR", () => {
    expect(applyVoteReachFloor(0)).toBe(VOTE_REACH_FLOOR);
    expect(applyVoteReachFloor(0.05)).toBe(VOTE_REACH_FLOOR);
  });
  it("leaves above-floor reach unchanged", () => {
    expect(applyVoteReachFloor(0.5)).toBe(0.5);
    expect(applyVoteReachFloor(1)).toBe(1);
  });
});
