import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  INDEX_INCLUSION_MAX_PREMIUM,
  INDEX_INCLUSION_PREMIUM_SATURATION,
  INDEX_INCLUSION_THRESHOLD,
  indexFundOwnershipFraction,
  indexInclusionPriceMultiplier,
  qualifiesForIndexInclusionBenefit,
} from "./indexOwnership";
import { calculateCreditScore } from "@/lib/constants/bonds";
import { CREDIT_RATINGS } from "@/lib/db/types/centralBank";

/**
 * Suggestion #62: index-fund inclusion has to be worth something to the ISSUER.
 * Before this, funds absorbed float and paid their unit holders while the corp
 * being held got nothing, so nobody cared whether they were in the Global Top 50.
 */

const fundId = () => new ObjectId();

describe("indexFundOwnershipFraction", () => {
  it("counts only fund positions, not characters, corps or NPPs", () => {
    const fraction = indexFundOwnershipFraction({
      totalShares: 1_000,
      shareholders: [
        { fundId: fundId(), shares: 150 },
        { characterId: new ObjectId(), shares: 400 },
        { corporationId: new ObjectId(), shares: 200 },
        { nppId: new ObjectId(), shares: 100 },
      ],
    });
    expect(fraction).toBeCloseTo(0.15, 10);
  });

  it("sums across multiple funds", () => {
    const fraction = indexFundOwnershipFraction({
      totalShares: 1_000,
      shareholders: [
        { fundId: fundId(), shares: 80 },
        { fundId: fundId(), shares: 45 },
      ],
    });
    expect(fraction).toBeCloseTo(0.125, 10);
  });

  it("returns 0 rather than dividing by zero when there is no share structure", () => {
    expect(indexFundOwnershipFraction({ totalShares: 0, shareholders: [] })).toBe(0);
    expect(
      indexFundOwnershipFraction({
        totalShares: undefined as unknown as number,
        shareholders: [{ fundId: fundId(), shares: 10 }],
      })
    ).toBe(0);
  });

  it("clamps at 1 even if holdings exceed the recorded share count", () => {
    const fraction = indexFundOwnershipFraction({
      totalShares: 100,
      shareholders: [{ fundId: fundId(), shares: 400 }],
    });
    expect(fraction).toBe(1);
  });
});

describe("indexInclusionPriceMultiplier", () => {
  it("is neutral below the threshold and continuous at it", () => {
    expect(indexInclusionPriceMultiplier(0)).toBe(1);
    expect(indexInclusionPriceMultiplier(INDEX_INCLUSION_THRESHOLD)).toBe(1);
    // Just above must be a hair over 1, not a jump to the cap — otherwise a
    // holder could farm the step by cycling across the threshold.
    expect(indexInclusionPriceMultiplier(INDEX_INCLUSION_THRESHOLD + 1e-6)).toBeGreaterThan(1);
    expect(indexInclusionPriceMultiplier(INDEX_INCLUSION_THRESHOLD + 1e-6)).toBeLessThan(1.001);
  });

  it("tops out at the cap and stays there", () => {
    const atCap = indexInclusionPriceMultiplier(INDEX_INCLUSION_PREMIUM_SATURATION);
    expect(atCap).toBeCloseTo(1 + INDEX_INCLUSION_MAX_PREMIUM, 10);
    expect(indexInclusionPriceMultiplier(1)).toBeCloseTo(1 + INDEX_INCLUSION_MAX_PREMIUM, 10);
  });
});

describe("credit notch for index inclusion", () => {
  // A mid-table balance sheet, so there are notches available in both directions.
  const score = (options: Parameters<typeof calculateCreditScore>[5]) =>
    calculateCreditScore(500_000, 400_000, 300_000, 40_000, 1_000_000, options);

  it("upgrades one notch", () => {
    const base = score({});
    const upgraded = score({ indexInclusionUpgrade: true });
    const baseIdx = CREDIT_RATINGS.indexOf(base.rating);
    expect(CREDIT_RATINGS.indexOf(upgraded.rating)).toBe(Math.max(0, baseIdx - 1));
  });

  it("nets against the insider-concentration downgrade rather than stacking", () => {
    const base = score({});
    const both = score({ insiderConcentrationPenalty: true, indexInclusionUpgrade: true });
    expect(both.rating).toBe(base.rating);
  });

  it("does not override a live default penalty", () => {
    const defaulted = score({
      bondDefaultCreditPenaltyActive: true,
      indexInclusionUpgrade: true,
    });
    expect(defaulted.rating).toBe("CCC");
  });

  it("cannot push past the top of the scale", () => {
    // Pristine balance sheet: already at the best rating, upgrade must be a no-op.
    const top = calculateCreditScore(10_000_000, 0, 5_000_000, 0, 20_000_000, {
      indexInclusionUpgrade: true,
    });
    expect(CREDIT_RATINGS.indexOf(top.rating)).toBe(0);
  });
});

describe("qualifiesForIndexInclusionBenefit", () => {
  it("gates exactly at the threshold", () => {
    expect(qualifiesForIndexInclusionBenefit(INDEX_INCLUSION_THRESHOLD - 1e-9)).toBe(false);
    expect(qualifiesForIndexInclusionBenefit(INDEX_INCLUSION_THRESHOLD)).toBe(true);
  });
});
