import { describe, it, expect } from "vitest";
import {
  SUPERSHARE_MIN_MULTIPLIER,
  SUPERSHARE_MAX_MULTIPLIER,
  isValidSuperShareMultiplier,
  hasSuperShares,
  effectiveSuperShares,
  shareholderVotingPower,
  totalVotingPower,
} from "./superShares";

describe("isValidSuperShareMultiplier", () => {
  it("accepts integers within [min, max]", () => {
    expect(isValidSuperShareMultiplier(SUPERSHARE_MIN_MULTIPLIER)).toBe(true);
    expect(isValidSuperShareMultiplier(SUPERSHARE_MAX_MULTIPLIER)).toBe(true);
    expect(isValidSuperShareMultiplier(5)).toBe(true);
  });

  it("rejects out-of-range, fractional, and non-number values", () => {
    expect(isValidSuperShareMultiplier(SUPERSHARE_MIN_MULTIPLIER - 1)).toBe(false);
    expect(isValidSuperShareMultiplier(SUPERSHARE_MAX_MULTIPLIER + 1)).toBe(false);
    expect(isValidSuperShareMultiplier(2.5)).toBe(false);
    expect(isValidSuperShareMultiplier(undefined)).toBe(false);
    expect(isValidSuperShareMultiplier("10")).toBe(false);
  });
});

describe("hasSuperShares", () => {
  it("is false for single-class corps and legacy docs", () => {
    expect(hasSuperShares({})).toBe(false);
    expect(hasSuperShares({ superShareMultiplier: undefined })).toBe(false);
  });

  it("is true once a valid multiplier is stamped", () => {
    expect(hasSuperShares({ superShareMultiplier: 10 })).toBe(true);
  });
});

describe("effectiveSuperShares", () => {
  it("is the recorded count while the holder still holds at least that many shares", () => {
    expect(effectiveSuperShares({ shares: 10_000_000, superShares: 10_000_000 })).toBe(10_000_000);
    expect(effectiveSuperShares({ shares: 12_000_000, superShares: 10_000_000 })).toBe(10_000_000);
  });

  it("erodes to the held share count when the founder sells below it", () => {
    expect(effectiveSuperShares({ shares: 4_000_000, superShares: 10_000_000 })).toBe(4_000_000);
    expect(effectiveSuperShares({ shares: 0, superShares: 10_000_000 })).toBe(0);
  });

  it("is zero for holders without supershares", () => {
    expect(effectiveSuperShares({ shares: 5_000 })).toBe(0);
  });
});

describe("shareholderVotingPower", () => {
  const corp = { superShareMultiplier: 10 };

  it("is plain share count for single-class corps", () => {
    expect(shareholderVotingPower({}, { shares: 5_000, superShares: 5_000 })).toBe(5_000);
  });

  it("multiplies supershares and adds common shares", () => {
    // 1M supershares ×10 + 2M common = 12M votes
    expect(shareholderVotingPower(corp, { shares: 3_000_000, superShares: 1_000_000 })).toBe(
      12_000_000
    );
  });

  it("is share count for common-only holders in a dual-class corp", () => {
    expect(shareholderVotingPower(corp, { shares: 5_000 })).toBe(5_000);
  });
});

describe("totalVotingPower", () => {
  it("equals totalShares for single-class corps", () => {
    expect(
      totalVotingPower({
        totalShares: 20_000_000,
        shareholders: [{ characterId: undefined, shares: 10_000_000 } as never],
      })
    ).toBe(20_000_000);
  });

  it("adds the supershare bonus on top of totalShares (float counts 1 each)", () => {
    // Founder 10M supershares ×10 = 100M votes; 10M float = 10M votes → 110M total.
    expect(
      totalVotingPower({
        superShareMultiplier: 10,
        totalShares: 20_000_000,
        shareholders: [{ shares: 10_000_000, superShares: 10_000_000 } as never],
      })
    ).toBe(110_000_000);
  });

  it("keeps founder voting majority at a 75% float with a 10× multiplier", () => {
    // 10M founder supershares + 30M float = 40M shares (75% float).
    const corp = {
      superShareMultiplier: 10,
      totalShares: 40_000_000,
      shareholders: [{ shares: 10_000_000, superShares: 10_000_000 } as never],
    };
    const founderVotes = shareholderVotingPower(corp, {
      shares: 10_000_000,
      superShares: 10_000_000,
    });
    expect(founderVotes / totalVotingPower(corp)).toBeGreaterThan(0.5);
  });

  it("reflects eroded supershares after the founder sells down", () => {
    // Founder sold to 2M shares; recorded 10M supershares → only 2M still super.
    expect(
      totalVotingPower({
        superShareMultiplier: 10,
        totalShares: 20_000_000,
        shareholders: [{ shares: 2_000_000, superShares: 10_000_000 } as never],
      })
    ).toBe(20_000_000 + 2_000_000 * 9);
  });
});
