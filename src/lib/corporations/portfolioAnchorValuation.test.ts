import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Bond, Corporation } from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE } from "@/lib/constants/bonds";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  buildImfPrincipalAnchorByLenderCorpId,
  buildPortfolioAnchorValueByCorpId,
  crossCorpStockAnchorFromQuotes,
} from "./portfolioAnchorValuation";

// Empty FX map — corps/bonds without `liquidCurrencyCode` / `currencyCode`
// stay in passthrough (pre-forex) mode, mirroring legacy test expectations.
const EMPTY_FX = new Map<CurrencyCode, number>();

// Cross-currency FX map used to prove anchor-normalization works end-to-end.
const CROSS_FX = new Map<CurrencyCode, number>([
  ["USD", 1.04],
  ["JPY", 113.88],
]);

describe("buildImfPrincipalAnchorByLenderCorpId", () => {
  it("aggregates facility principal by IMF lender id (single-currency passthrough)", () => {
    const lenderId = new ObjectId();
    const borrowers: Corporation[] = [
      {
        _id: new ObjectId(),
        imfBailoutActive: true,
        imfBailoutImfCorporationId: lenderId,
        imfFacilityPrincipalOutstanding: 30,
      } as unknown as Corporation,
      {
        _id: new ObjectId(),
        imfBailoutActive: true,
        imfBailoutImfCorporationId: lenderId,
        imfFacilityPrincipalOutstanding: 20,
      } as unknown as Corporation,
    ];
    // Without `liquidCurrencyCode` / `countryId`, values passthrough as ₳.
    const map = buildImfPrincipalAnchorByLenderCorpId(borrowers, EMPTY_FX);
    expect(map.get(lenderId.toString())).toBe(50);
  });

  it("anchor-normalizes mixed-currency borrowers", () => {
    // JP borrower (JPY=113.88) + US borrower (USD=1.04) each owe LOCAL 10,000
    // to the same lender. Post-fix: lender sees ₳ sum ≈ 87.81 + 9615.38.
    const lenderId = new ObjectId();
    const borrowers: Corporation[] = [
      {
        _id: new ObjectId(),
        countryId: "JP",
        liquidCurrencyCode: "JPY",
        imfBailoutActive: true,
        imfBailoutImfCorporationId: lenderId,
        imfFacilityPrincipalOutstanding: 10_000, // JPY
      } as unknown as Corporation,
      {
        _id: new ObjectId(),
        countryId: "US",
        liquidCurrencyCode: "USD",
        imfBailoutActive: true,
        imfBailoutImfCorporationId: lenderId,
        imfFacilityPrincipalOutstanding: 10_000, // USD
      } as unknown as Corporation,
    ];
    const map = buildImfPrincipalAnchorByLenderCorpId(borrowers, CROSS_FX);
    const anchor = map.get(lenderId.toString())!;
    expect(anchor).toBeCloseTo(10_000 / 113.88 + 10_000 / 1.04, 0);
    // Pre-fix raw sum would have been 20,000 — reject explicitly.
    expect(anchor).not.toBeCloseTo(20_000, -1);
  });
});

describe("buildPortfolioAnchorValueByCorpId", () => {
  it("sums bond mark-to-market for the holder corporation (passthrough)", () => {
    const holderId = new ObjectId();
    const issuerId = new ObjectId();
    const bond = {
      _id: new ObjectId(),
      corporationId: issuerId,
      marketPrice: 1.05,
      couponRate: 5,
      maturityTurn: 100,
    } as Bond;
    const held = new Map([[holderId.toString(), [{ bond, units: 10 }]]]);
    const map = buildPortfolioAnchorValueByCorpId([], held, new Map(), EMPTY_FX);
    expect(map.get(holderId.toString())).toBe(Math.round(10 * BOND_UNIT_FACE_VALUE * 1.05));
  });

  it("anchor-normalizes JPY-denominated bond holdings (A22)", () => {
    // Holder corp owns 10 units of a JPY-denominated bond at marketPrice 1.0.
    // costLocal (JPY) = 10 × 1000 × 1.0 = 10,000 JPY.
    // Post-A22: corpCapitalToAnchor(10000, JPY, 113.88) ≈ 87.81 ₳.
    // Pre-A22 would have summed 10,000 ₳ (treating LOCAL as ₳) — 114× over.
    const holderId = new ObjectId();
    const bond = {
      _id: new ObjectId(),
      corporationId: new ObjectId(),
      currencyCode: "JPY",
      countryId: "JP",
      marketPrice: 1.0,
      couponRate: 5,
      maturityTurn: 100,
    } as unknown as Bond;
    const held = new Map([[holderId.toString(), [{ bond, units: 10 }]]]);
    const map = buildPortfolioAnchorValueByCorpId([], held, new Map(), CROSS_FX);
    const anchor = map.get(holderId.toString())!;
    expect(anchor).toBeCloseTo((10 * BOND_UNIT_FACE_VALUE * 1.0) / 113.88, 0);
    expect(anchor).not.toBeCloseTo(10 * BOND_UNIT_FACE_VALUE * 1.0, -1);
  });

  it("values corporate-held stock at the issuer listed quote (passthrough)", () => {
    const holderId = new ObjectId();
    const issuer: Corporation = {
      _id: new ObjectId(),
      sharePrice: 2.5,
      shareholders: [{ corporationId: holderId, shares: 1_000_000 }],
    } as unknown as Corporation;
    const map = buildPortfolioAnchorValueByCorpId([issuer], new Map(), new Map(), EMPTY_FX);
    expect(map.get(holderId.toString())).toBe(2_500_000);
  });

  it("anchor-normalizes cross-corp stock positions in non-anchor currencies (A22)", () => {
    // Holder corp owns 1,000,000 shares of a JP corp with sharePrice=200 JPY.
    // Post-A22: sharePrice → ₳ = 200 / 113.88 ≈ 1.7562 ₳, sum ≈ 1,756,200 ₳.
    // Pre-A22 would have summed 200 × 1M = 200,000,000 ₳ (raw LOCAL × shares).
    const holderId = new ObjectId();
    const issuer: Corporation = {
      _id: new ObjectId(),
      countryId: "JP",
      liquidCurrencyCode: "JPY",
      sharePrice: 200,
      shareholders: [{ corporationId: holderId, shares: 1_000_000 }],
    } as unknown as Corporation;
    const map = buildPortfolioAnchorValueByCorpId([issuer], new Map(), new Map(), CROSS_FX);
    const anchor = map.get(holderId.toString())!;
    expect(anchor).toBeCloseTo((200 * 1_000_000) / 113.88, 0);
    expect(anchor).not.toBeCloseTo(200 * 1_000_000, -4);
  });

  it("includes IMF receivable principal on the lender", () => {
    const lenderId = new ObjectId();
    const imfAnchorMap = new Map([[lenderId.toString(), 58_000_000]]);
    const map = buildPortfolioAnchorValueByCorpId([], new Map(), imfAnchorMap, EMPTY_FX);
    expect(map.get(lenderId.toString())).toBe(58_000_000);
  });

  it("crossCorpStockAnchorFromQuotes uses provided quotes for mutual holdings", () => {
    const a = new ObjectId().toString();
    const b = new ObjectId().toString();
    const holdings = new Map([
      [a, [{ issuerCorpId: b, shares: 100 }]],
      [b, [{ issuerCorpId: a, shares: 50 }]],
    ]);
    const quotes = new Map([
      [a, 10],
      [b, 20],
    ]);
    expect(crossCorpStockAnchorFromQuotes(a, holdings, quotes)).toBe(2000);
    expect(crossCorpStockAnchorFromQuotes(b, holdings, quotes)).toBe(500);
  });
});
