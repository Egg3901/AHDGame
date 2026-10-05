import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import type { Bond } from "@/lib/db/types/bond";
import type { CorporateSector } from "@/lib/db/types/corporation";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import {
  computeCorporateCreditAtTurn,
  corporateCashArrearsAnchor,
  isCorporateIssuerBond,
  sumCorporateSectorPerTurnIncome,
} from "./corporateCredit";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import { calculateCreditScore } from "@/lib/constants/bonds";

const corpId = new ObjectId();

function baseSector(overrides: Partial<CorporateSector> = {}): CorporateSector {
  const now = new Date();
  return {
    _id: new ObjectId(),
    corporationId: corpId,
    countryId: "US",
    stateId: "CA",
    sectorType: "manufacturing",
    revenue: 0,
    profitMargin: 50,
    targetGrowthRate: 0,
    currentGrowthRate: 0,
    currentGrowthCost: 0,
    workers: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function baseBond(overrides: Partial<Bond> = {}): Bond {
  const now = new Date();
  return {
    _id: new ObjectId(),
    corporationId: corpId,
    faceValue: 1000,
    couponRate: 5,
    maturityTurns: 48,
    issuedAtTurn: 1,
    maturityTurn: 49,
    marketPrice: 1,
    totalIssued: 1_000_000,
    publicFloat: 0,
    holders: [],
    defaulted: false,
    defaultedAtTurn: null,
    matured: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("sumCorporateSectorPerTurnIncome", () => {
  const primeRates = new Map<CountryId, number>([["US", 3.75]]);
  const noFx = new Map<CurrencyCode, number>();

  it("returns per-turn income from a profitable sector", () => {
    // revenue=48 (daily units) → hourlyRevenue=48/24=2, 50% margin → profit=1/turn
    const sector = baseSector({ revenue: 48, profitMargin: 50, currentGrowthRate: 0 });
    const result = sumCorporateSectorPerTurnIncome([sector], corpId, primeRates, null, noFx);
    expect(result).toBeCloseTo(48 / TURNS_PER_DAY / 2, 5);
  });

  it("includes negative-margin sectors (unlike sumCorporateSectorNpv)", () => {
    // One profitable sector (50% margin) and one loss-making sector (-20% margin)
    const profitable = baseSector({ revenue: 100, profitMargin: 50, currentGrowthRate: 0 });
    const losing = baseSector({ revenue: 100, profitMargin: -20, currentGrowthRate: 0 });
    const result = sumCorporateSectorPerTurnIncome(
      [profitable, losing],
      corpId,
      primeRates,
      null,
      noFx
    );
    // profitable: hourly=100/24≈4.167, margin 50% → profit ≈2.083/turn
    // losing: hourly=100/24≈4.167, margin -20% → profit ≈-0.833/turn (negative)
    const expected = (100 / TURNS_PER_DAY) * 0.5 + (100 / TURNS_PER_DAY) * -0.2;
    expect(result).toBeCloseTo(expected, 4);
    expect(result).toBeGreaterThan(0); // net positive but less than profitable-only
  });

  it("deducts growth cost from income", () => {
    // Zero-growth and high-growth sector with same revenue/margin — income should differ
    const noGrowth = baseSector({ revenue: 1000, profitMargin: 50, currentGrowthRate: 0 });
    const highGrowth = baseSector({ revenue: 1000, profitMargin: 50, currentGrowthRate: 3.5 });
    const incomeNoGrowth = sumCorporateSectorPerTurnIncome(
      [noGrowth],
      corpId,
      primeRates,
      null,
      noFx
    );
    const incomeHighGrowth = sumCorporateSectorPerTurnIncome(
      [highGrowth],
      corpId,
      primeRates,
      null,
      noFx
    );
    expect(incomeHighGrowth).toBeLessThan(incomeNoGrowth);
  });

  it("skips sectors belonging to other corps", () => {
    const otherCorpSector = baseSector({
      corporationId: new ObjectId(),
      revenue: 1000,
      profitMargin: 50,
    });
    const result = sumCorporateSectorPerTurnIncome(
      [otherCorpSector],
      corpId,
      primeRates,
      null,
      noFx
    );
    expect(result).toBe(0);
  });
});

describe("corporateCredit", () => {
  const cliff = {
    liquidCapitalAnchor: 20,
    incomePerTurn: 10 / 48,
    sectorNpv: 100,
    corporationId: corpId,
    currentTurn: 100,
    bondDefaultCreditPenaltyUntilTurn: null,
    fxByCurrency: new Map<CurrencyCode, number>(),
  };

  it("lowers the source-derived A69 rating before an uncovered principal cliff", () => {
    const baseline = calculateCreditScore(20, 100, 10, 5, 120);
    const result = computeCorporateCreditAtTurn({
      ...cliff,
      bonds: [baseBond({ totalIssued: 100, maturityTurn: 101 })],
    });
    expect(baseline).toMatchObject({ rating: "A", compositeScore: 69 });
    expect(result.creditRating).toMatchObject({ rating: "BBB", compositeScore: 53 });
    expect(result.creditRating.components.liquidity).toBe(20);
    expect(result.maturityLiquidity.principalDueAnchor).toBe(100);
  });

  it("preserves legacy scoring outside the maturity horizon", () => {
    const result = computeCorporateCreditAtTurn({
      ...cliff,
      bonds: [baseBond({ totalIssued: 100, maturityTurn: 125 })],
    });
    expect(result.creditRating).toEqual(calculateCreditScore(20, 100, 10, 5, 120));
    expect(result.maturityLiquidity.liquidityScore).toBeNull();
  });

  it("keeps covered near maturities neutral to the legacy score", () => {
    const result = computeCorporateCreditAtTurn({
      ...cliff,
      liquidCapitalAnchor: 200,
      bonds: [baseBond({ totalIssued: 100, maturityTurn: 101 })],
    });
    expect(result.creditRating).toEqual(calculateCreditScore(200, 100, 10, 5, 300));
    expect(result.maturityLiquidity.liquidityScore).toBe(100);
  });

  it("anchor-normalizes imminent principal before comparing cash coverage", () => {
    const anchor = computeCorporateCreditAtTurn({
      ...cliff,
      bonds: [baseBond({ totalIssued: 100, maturityTurn: 101 })],
    });
    const foreign = computeCorporateCreditAtTurn({
      ...cliff,
      fxByCurrency: new Map<CurrencyCode, number>([["JPY", 100]]),
      bonds: [baseBond({ totalIssued: 10_000, currencyCode: "JPY", maturityTurn: 101 })],
    });
    expect(foreign.creditRating).toEqual(anchor.creditRating);
    expect(foreign.maturityLiquidity).toEqual(anchor.maturityLiquidity);
  });

  it("smooths only the turn score and displays a persisted score verbatim", () => {
    const bonds = [baseBond({ totalIssued: 100, maturityTurn: 101 })];
    const turn = computeCorporateCreditAtTurn({ ...cliff, bonds, previousCompositeScore: 69 });
    expect(turn.creditRating.compositeScore).toBe(Math.round(0.75 * 53 + 0.25 * 69));
    const display = computeCorporateCreditAtTurn({
      ...cliff,
      bonds,
      persistedCompositeScore: turn.creditRating.compositeScore,
    });
    expect(display.creditRating.compositeScore).toBe(turn.creditRating.compositeScore);
  });

  it("retains the default floor despite passive inclusion or a maturity calculation", () => {
    const result = computeCorporateCreditAtTurn({
      ...cliff,
      bonds: [baseBond({ totalIssued: 100, maturityTurn: 101, defaulted: true })],
      bondDefaultCreditPenaltyUntilTurn: 120,
      indexFundOwnershipFraction: 0.75,
    });
    expect(result.creditRating.rating).toBe("CCC");
    expect(result.creditRating.compositeScore).toBeLessThanOrEqual(12);
    expect(result.maturityLiquidity.principalDueAnchor).toBe(0);
    expect(result.totalDebt).toBe(100);
  });

  it("isCorporateIssuerBond excludes sovereign", () => {
    expect(isCorporateIssuerBond(baseBond({ issuerType: "sovereign" }))).toBe(false);
  });

  it("computeCorporateCreditAtTurn anchor-normalizes bond principal via fxByCurrency", () => {
    // JP corp holding JPY-denominated bonds. Without FX normalization, totalDebt
    // would sum in JPY (~113× bigger than ₳), clamping debt/equity sub-score to
    // CCC even though the corp is only 0.1× leveraged in real terms.
    const fx = new Map<CurrencyCode, number>([["JPY", 113.88]]);
    const bonds = [
      baseBond({ currencyCode: "JPY", totalIssued: 113_880 }), // = ₳1K debt
      baseBond({ currencyCode: "JPY", totalIssued: 113_880, matured: true }), // filtered out
    ];
    const result = computeCorporateCreditAtTurn({
      liquidCapitalAnchor: 1_000_000, // ₳1M
      incomePerTurn: 10_000,
      sectorNpv: 0,
      bonds,
      corporationId: corpId,
      currentTurn: 100,
      bondDefaultCreditPenaltyUntilTurn: null,
      fxByCurrency: fx,
    });
    // 113,880 JPY / 113.88 = ₳1,000 debt. Coupon 5% of ₳1K = ₳50.
    expect(result.totalDebt).toBeCloseTo(1_000, 5);
    expect(result.annualCouponObligations).toBeCloseTo(50, 5);
    expect(result.totalEquity).toBe(1_000_000);
    // D/E = 1000 / 1M = 0.001 → essentially AAA.
    expect(result.creditRating.components.debtToEquity).toBeGreaterThan(99);
  });

  it("computeCorporateCreditAtTurn filters sovereign + matured + other-corp bonds", () => {
    const otherCorpId = new ObjectId();
    const bonds = [
      baseBond({ totalIssued: 500_000 }), // kept
      baseBond({ totalIssued: 500_000, matured: true }), // filtered (matured)
      baseBond({ totalIssued: 500_000, issuerType: "sovereign" }), // filtered (sovereign)
      baseBond({ corporationId: otherCorpId, totalIssued: 500_000 }), // filtered (other corp)
    ];
    const result = computeCorporateCreditAtTurn({
      liquidCapitalAnchor: 1_000_000,
      incomePerTurn: 10_000,
      sectorNpv: 0,
      bonds,
      corporationId: corpId,
      currentTurn: 100,
      bondDefaultCreditPenaltyUntilTurn: null,
      fxByCurrency: new Map(),
    });
    // Only the first bond survives filters → totalDebt = 500,000 passthrough (no currencyCode).
    expect(result.totalDebt).toBe(500_000);
  });

  it("counts cash arrears as debt and subtracts them from equity", () => {
    const liabilities = corporateCashArrearsAnchor({
      operatingByCurrency: { JPY: 226 },
      federalTaxByCountryAnchor: { US: 50 },
      fxByCurrency: new Map<CurrencyCode, number>([["JPY", 113]]),
    });
    const result = computeCorporateCreditAtTurn({
      liquidCapitalAnchor: 1_000,
      incomePerTurn: 100,
      sectorNpv: 500,
      bonds: [],
      corporationId: corpId,
      currentTurn: 100,
      bondDefaultCreditPenaltyUntilTurn: null,
      fxByCurrency: new Map(),
      otherLiabilitiesAnchor: liabilities,
    });

    expect(liabilities).toBe(52);
    expect(result.totalDebt).toBe(52);
    expect(result.totalEquity).toBe(1_448);
  });
});

describe("construction in progress in credit equity (P3a)", () => {
  const corpId2 = new ObjectId();
  const fx = new Map<CurrencyCode, number>();

  function credit(overrides: { sectorNpv?: number; constructionInProgressAnchor?: number }) {
    return computeCorporateCreditAtTurn({
      liquidCapitalAnchor: 0,
      incomePerTurn: 0,
      sectorNpv: overrides.sectorNpv ?? 0,
      constructionInProgressAnchor: overrides.constructionInProgressAnchor,
      bonds: [],
      corporationId: corpId2,
      currentTurn: 100,
      bondDefaultCreditPenaltyUntilTurn: null,
      fxByCurrency: fx,
    });
  }

  it("counts capitalized build spend as equity, not as destroyed capital", () => {
    // A corp mid-build (cash spent, plant not finished) must rate the same as
    // one still holding the equivalent going-concern value — investing is not
    // a downgrade event.
    expect(credit({ constructionInProgressAnchor: 5_000_000 }).totalEquity).toBe(5_000_000);
    expect(
      credit({ sectorNpv: 2_000_000, constructionInProgressAnchor: 3_000_000 }).totalEquity
    ).toBe(5_000_000);
  });

  it("is a no-op when absent (every pre-P3a corp) and ignores a negative value", () => {
    expect(credit({ sectorNpv: 1_000 }).totalEquity).toBe(1_000);
    expect(credit({ sectorNpv: 1_000, constructionInProgressAnchor: -500 }).totalEquity).toBe(
      1_000
    );
  });
});
