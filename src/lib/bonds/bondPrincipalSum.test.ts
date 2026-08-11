import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Bond } from "@/lib/db/types/bond";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { sumBondPrincipalAnchor, sumBondAnnualInterestAnchor } from "./bondPrincipalSum";

// Realistic v0.2.6 rates (local per 1 ₳): USD 1.0416, GBP 0.795, JPY 113.88.
const FX_RATES = new Map<CurrencyCode, number>([
  ["USD", 1.0416],
  ["GBP", 0.795],
  ["JPY", 113.88],
]);

function bond(overrides: Partial<Bond> = {}): Bond {
  return {
    _id: new ObjectId(),
    corporationId: new ObjectId(),
    faceValue: 1000,
    couponRate: 5,
    maturityTurns: 48,
    issuedAtTurn: 0,
    maturityTurn: 48,
    marketPrice: 1.0,
    totalIssued: 1_000_000,
    publicFloat: 1000,
    holders: [],
    defaulted: false,
    defaultedAtTurn: null,
    matured: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

describe("sumBondPrincipalAnchor", () => {
  it("USD-only bonds divide by USD rate", () => {
    const bonds = [
      bond({ currencyCode: "USD", totalIssued: 1_041_600 }),
      bond({ currencyCode: "USD", totalIssued: 520_800 }),
    ];
    // 1,041,600 USD / 1.0416 = 1,000,000 ₳; 520,800 / 1.0416 = 500,000 ₳
    expect(sumBondPrincipalAnchor(bonds, FX_RATES)).toBeCloseTo(1_500_000, 0);
  });

  it("GBP-only bonds divide by GBP rate", () => {
    const bonds = [bond({ currencyCode: "GBP", totalIssued: 795_000 })];
    // 795,000 GBP / 0.795 = 1,000,000 ₳
    expect(sumBondPrincipalAnchor(bonds, FX_RATES)).toBeCloseTo(1_000_000, 0);
  });

  it("JPY-only bonds divide by JPY rate", () => {
    const bonds = [bond({ currencyCode: "JPY", totalIssued: 113_880_000 })];
    // 113,880,000 JPY / 113.88 = 1,000,000 ₳
    expect(sumBondPrincipalAnchor(bonds, FX_RATES)).toBeCloseTo(1_000_000, 0);
  });

  it("mixed-currency corp bonds sum coherently in ₳", () => {
    const bonds = [
      bond({ currencyCode: "USD", totalIssued: 1_041_600 }), // 1M ₳
      bond({ currencyCode: "GBP", totalIssued: 795_000 }), // 1M ₳
      bond({ currencyCode: "JPY", totalIssued: 113_880_000 }), // 1M ₳
    ];
    expect(sumBondPrincipalAnchor(bonds, FX_RATES)).toBeCloseTo(3_000_000, 0);
  });

  it("empty bonds array returns 0", () => {
    expect(sumBondPrincipalAnchor([], FX_RATES)).toBe(0);
  });

  it("pre-v0.2.6 bond without currencyCode passes through (treated as ₳)", () => {
    // Simulates bonds issued before the bondCurrencyStamp migration runs.
    // corpCapitalToAnchor returns amountLocal unchanged when no code is set.
    const unstamped = bond({ totalIssued: 500_000 });
    delete (unstamped as { currencyCode?: CurrencyCode }).currencyCode;
    expect(sumBondPrincipalAnchor([unstamped], FX_RATES)).toBe(500_000);
  });

  it("bond with currencyCode set but missing from fx map passes through", () => {
    // Simulates admin mis-seeding, new currency without rate row, or turn running
    // before rate refresh. Defensive: same behavior as M1 USD-hardcode surfaced.
    const sparseMap = new Map<CurrencyCode, number>([["USD", 1.0416]]);
    const bonds = [bond({ currencyCode: "JPY", totalIssued: 113_880_000 })];
    // JPY missing from sparseMap → rate=1 fallback → 113,880,000 / 1 = 113,880,000 (passthrough)
    expect(sumBondPrincipalAnchor(bonds, sparseMap)).toBe(113_880_000);
  });

  it("zero totalIssued contributes 0", () => {
    const bonds = [bond({ currencyCode: "JPY", totalIssued: 0 })];
    expect(sumBondPrincipalAnchor(bonds, FX_RATES)).toBe(0);
  });
});

describe("sumBondAnnualInterestAnchor", () => {
  it("computes (couponRate% × totalIssued) per bond, anchor-normalized", () => {
    const bonds = [
      // 5% × 1,041,600 USD = 52,080 USD / 1.0416 = 50,000 ₳
      bond({ currencyCode: "USD", couponRate: 5, totalIssued: 1_041_600 }),
      // 4% × 113,880,000 JPY = 4,555,200 JPY / 113.88 = 40,000 ₳
      bond({ currencyCode: "JPY", couponRate: 4, totalIssued: 113_880_000 }),
    ];
    expect(sumBondAnnualInterestAnchor(bonds, FX_RATES)).toBeCloseTo(90_000, 0);
  });

  it("mixed-currency corp bonds sum coherently", () => {
    const bonds = [
      bond({ currencyCode: "USD", couponRate: 5, totalIssued: 1_041_600 }), // 50K ₳
      bond({ currencyCode: "GBP", couponRate: 6, totalIssued: 795_000 }), // 60K ₳
    ];
    expect(sumBondAnnualInterestAnchor(bonds, FX_RATES)).toBeCloseTo(110_000, 0);
  });

  it("empty bonds array returns 0", () => {
    expect(sumBondAnnualInterestAnchor([], FX_RATES)).toBe(0);
  });

  it("pre-v0.2.6 bond without currencyCode passes through", () => {
    const unstamped = bond({ couponRate: 5, totalIssued: 1_000_000 });
    delete (unstamped as { currencyCode?: CurrencyCode }).currencyCode;
    // 5% × 1,000,000 = 50,000, passthrough
    expect(sumBondAnnualInterestAnchor([unstamped], FX_RATES)).toBe(50_000);
  });

  it("bond with currencyCode set but missing from fx map passes through", () => {
    const sparseMap = new Map<CurrencyCode, number>();
    const bonds = [bond({ currencyCode: "JPY", couponRate: 4, totalIssued: 113_880_000 })];
    // 4% × 113,880,000 = 4,555,200, rate=1 fallback → passthrough
    expect(sumBondAnnualInterestAnchor(bonds, sparseMap)).toBe(4_555_200);
  });

  it("zero coupon rate contributes 0 even with non-zero principal", () => {
    const bonds = [bond({ currencyCode: "JPY", couponRate: 0, totalIssued: 113_880_000 })];
    expect(sumBondAnnualInterestAnchor(bonds, FX_RATES)).toBe(0);
  });
});
