import { describe, expect, it } from "vitest";
import {
  NON_LAW_CALIBRATION_MIN_SHARE,
  calibrateNonLawSpendingShare,
  needsNonLawCalibration,
  nonLawSpendingAmount,
  seededSpendingEnvelope,
} from "./nonLawSpending";

describe("calibrateNonLawSpendingShare", () => {
  it("returns the envelope the law book leaves out, as a share of GDP", () => {
    // Live 1991 Germany: seeded envelope 32.9% of GDP, law book 12.3%.
    const share = calibrateNonLawSpendingShare({
      gdp: 1_600,
      baselineTotal: 526.4,
      lawTotal: 196.8,
    });
    expect(share).toBeCloseTo(0.206, 3);
    expect(nonLawSpendingAmount(1_600, share)).toBe(330);
  });

  it("ignores a complete law book", () => {
    expect(
      calibrateNonLawSpendingShare({ gdp: 1_000, baselineTotal: 400, lawTotal: 398 })
    ).toBeUndefined();
    expect(
      calibrateNonLawSpendingShare({ gdp: 1_000, baselineTotal: 400, lawTotal: 450 })
    ).toBeUndefined();
  });

  it("calibrates a gap at the threshold", () => {
    const gap = 1_000 * NON_LAW_CALIBRATION_MIN_SHARE;
    expect(
      calibrateNonLawSpendingShare({ gdp: 1_000, baselineTotal: 400 + gap, lawTotal: 400 })
    ).toBeCloseTo(NON_LAW_CALIBRATION_MIN_SHARE, 9);
  });

  it("needs an envelope, a law book and a GDP", () => {
    expect(
      calibrateNonLawSpendingShare({ gdp: 0, baselineTotal: 400, lawTotal: 100 })
    ).toBeUndefined();
    expect(
      calibrateNonLawSpendingShare({ gdp: 1_000, baselineTotal: 0, lawTotal: 100 })
    ).toBeUndefined();
    expect(
      calibrateNonLawSpendingShare({ gdp: 1_000, baselineTotal: 400, lawTotal: 0 })
    ).toBeUndefined();
  });
});

describe("needsNonLawCalibration", () => {
  const envelope = { baselineSpendingByCategory: { welfare: 10 } } as never;
  it("calibrates a non-law-book country with a seeded envelope, once", () => {
    expect(needsNonLawCalibration(envelope, "DE")).toBe(true);
    expect(
      needsNonLawCalibration(
        { ...(envelope as object), nonLawSpendingGdpShareBaseline: 0 } as never,
        "DE"
      )
    ).toBe(false);
  });
  it("leaves the player law-book countries to their seed calibration", () => {
    for (const c of ["US", "UK", "RU", "DD"])
      expect(needsNonLawCalibration(envelope, c)).toBe(false);
  });
  it("needs a seeded envelope", () => {
    expect(needsNonLawCalibration({} as never, "CN")).toBe(false);
  });
});

describe("seededSpendingEnvelope", () => {
  it("sums categories and grants, skipping bad values", () => {
    expect(
      seededSpendingEnvelope({
        baselineSpendingByCategory: { a: 5, b: 7, c: Number.NaN },
        baselineStateGrants: 3,
      } as never)
    ).toBe(15);
    expect(seededSpendingEnvelope({} as never)).toBe(0);
  });
});
