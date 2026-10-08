import { describe, expect, it } from "vitest";
import {
  NON_LAW_CALIBRATION_MIN_SHARE,
  NON_LAW_CALIBRATION_VERSION,
  calibrateNonLawSpendingShare,
  needsNonLawCalibration,
  nonLawSpendingAmount,
  seededSpendingEnvelope,
} from "./nonLawSpending";

describe("calibrateNonLawSpendingShare", () => {
  // Plenty of revenue: the seeded envelope binds.
  const rich = { annualRevenue: 1_000_000, annualDebtService: 0 };

  it("returns the envelope the law book leaves out, as a share of GDP", () => {
    // Live 1991 Germany: envelope 32.9% of GDP, law book 12.3%, revenue 42.9%, debt service 3.3%.
    const share = calibrateNonLawSpendingShare({
      gdp: 1_600,
      baselineTotal: 526.4,
      lawTotal: 196.8,
      annualRevenue: 686.4,
      annualDebtService: 52.8,
    });
    expect(share).toBeCloseTo(0.206, 3);
    expect(nonLawSpendingAmount(1_600, share)).toBe(330);
  });

  it("fills only up to what receipts afford after debt service", () => {
    // Live 1991 Brazil: stale envelope 33.3% of GDP, law book 7.9%, revenue 25.2%, debt service 11.4%.
    const share = calibrateNonLawSpendingShare({
      gdp: 1_000,
      baselineTotal: 333,
      lawTotal: 79,
      annualRevenue: 252,
      annualDebtService: 114,
    })!;
    // Affordable operating = 252 + 5 - 114 = 143, so the residual is 143 - 79 = 64.
    expect(share).toBeCloseTo(0.064, 6);
    expect(79 + share * 1_000 + 114).toBeCloseTo(252 + 5, 6);
  });

  it("books nothing for a complete or over-full law book", () => {
    expect(
      calibrateNonLawSpendingShare({ gdp: 1_000, baselineTotal: 400, lawTotal: 398, ...rich })
    ).toBe(0);
    expect(
      calibrateNonLawSpendingShare({ gdp: 1_000, baselineTotal: 400, lawTotal: 450, ...rich })
    ).toBe(0);
  });

  it("calibrates a gap at the threshold", () => {
    const gap = 1_000 * NON_LAW_CALIBRATION_MIN_SHARE;
    expect(
      calibrateNonLawSpendingShare({ gdp: 1_000, baselineTotal: 400 + gap, lawTotal: 400, ...rich })
    ).toBeCloseTo(NON_LAW_CALIBRATION_MIN_SHARE, 9);
  });

  it("needs an envelope, a law book, a GDP and fiscal inputs", () => {
    const base = { gdp: 1_000, baselineTotal: 400, lawTotal: 100, ...rich };
    expect(calibrateNonLawSpendingShare({ ...base, gdp: 0 })).toBeUndefined();
    expect(calibrateNonLawSpendingShare({ ...base, baselineTotal: 0 })).toBeUndefined();
    expect(calibrateNonLawSpendingShare({ ...base, lawTotal: 0 })).toBeUndefined();
    expect(calibrateNonLawSpendingShare({ ...base, annualRevenue: Number.NaN })).toBeUndefined();
  });
});

describe("needsNonLawCalibration", () => {
  const envelope = { baselineSpendingByCategory: { welfare: 10 } };

  it("calibrates a non-law-book country with a seeded envelope, once per version", () => {
    expect(needsNonLawCalibration(envelope as never, "DE")).toBe(true);
    const current = {
      ...envelope,
      nonLawSpendingGdpShareBaseline: 0,
      nonLawSpendingCalibration: NON_LAW_CALIBRATION_VERSION,
    };
    expect(needsNonLawCalibration(current as never, "DE")).toBe(false);
  });

  it("recalibrates a share stored by an earlier version", () => {
    const stale = { ...envelope, nonLawSpendingGdpShareBaseline: 0.25 };
    expect(needsNonLawCalibration(stale as never, "BR")).toBe(true);
  });

  it("leaves the player law-book countries to their seed calibration", () => {
    for (const c of ["US", "UK", "RU", "DD"]) {
      expect(needsNonLawCalibration(envelope as never, c)).toBe(false);
    }
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
