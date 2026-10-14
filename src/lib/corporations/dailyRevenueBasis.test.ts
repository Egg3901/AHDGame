import { describe, expect, it } from "vitest";
import type { CorporateSector } from "@/lib/db/types";
import { sectorDailyRevenueBasis } from "./dailyRevenueBasis";

const identity = (amount: number) => amount;
const doubled = (amount: number) => amount * 2;

function sector(overrides: Partial<CorporateSector> = {}): CorporateSector {
  return {
    revenue: 1_000,
    countryId: "US",
    productionPolicyLevel: 0,
    ...overrides,
  } as CorporateSector;
}

describe("sectorDailyRevenueBasis", () => {
  it("uses realized sales instead of a larger nameplate figure", () => {
    const basis = sectorDailyRevenueBasis(
      sector({ revenue: 10_000, realizedRevenue: 250 }),
      0.1,
      identity
    );

    expect(basis.nameplateRevenueLocal).toBe(10_000);
    expect(basis.realizedRevenueLocal).toBe(250);
    expect(basis.financialRevenueLocal).toBe(250);
  });

  it("uses nameplate safely for a new sector with no realization history", () => {
    const basis = sectorDailyRevenueBasis(sector({ revenue: 1_000 }), 1, identity);
    expect(basis.financialRevenueLocal).toBe(1_000);
  });

  it("keeps zero realized revenue at zero instead of falling back to nameplate", () => {
    const basis = sectorDailyRevenueBasis(
      sector({ revenue: 1_000, realizedRevenue: 0 }),
      1,
      identity
    );
    expect(basis.financialRevenueLocal).toBe(0);
  });

  it("converts realized sales and freight credit from host to corp currency", () => {
    const basis = sectorDailyRevenueBasis(
      sector({ revenue: 1_000, realizedRevenue: 300, freightBillingCredit: 50 }),
      0.1,
      doubled
    );
    expect(basis.realizedRevenueLocal).toBe(600);
    expect(basis.freightIncomeLocal).toBe(100);
    expect(basis.financialRevenueLocal).toBe(700);
  });

  it("treats non-finite stored amounts as zero instead of poisoning the cap", () => {
    const basis = sectorDailyRevenueBasis(
      sector({
        revenue: Number.NaN,
        realizedRevenue: Number.NaN,
        freightBillingCredit: Number.NaN,
      }),
      1,
      identity
    );
    expect(basis.financialRevenueLocal).toBe(0);
  });

  it("uses the history realization ratio for legacy sectors and clamps invalid negative ratios", () => {
    const legacy = sector({ revenue: 1_000 });
    expect(sectorDailyRevenueBasis(legacy, 0.25, identity).financialRevenueLocal).toBe(250);
    expect(sectorDailyRevenueBasis(legacy, -1, identity).financialRevenueLocal).toBe(0);
    expect(sectorDailyRevenueBasis(legacy, Number.NaN, identity).financialRevenueLocal).toBe(1_000);
  });
});
