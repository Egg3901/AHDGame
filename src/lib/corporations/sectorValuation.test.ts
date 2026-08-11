import { describe, expect, it } from "vitest";
import { computeSectorListingValuation } from "./sectorValuation";
import {
  NPV_ANNUAL_DISCOUNT_RATE,
  SECTOR_FOR_SALE_PRICE_FRACTION,
  TURNS_PER_DAY,
} from "@/lib/constants/corporations";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

const GAME_DAYS_PER_YEAR = TURNS_PER_YEAR / TURNS_PER_DAY;

describe("computeSectorListingValuation", () => {
  it("computes NPV and asking price from base profit (pre-forex / USD corp)", () => {
    // $1M revenue at 20% margin, no growth cost → $200K daily profit, $400K yearly,
    // $400K / 0.15 = ~2.67M NPV, × 0.75 = ~2M asking price.
    const valuation = computeSectorListingValuation(
      {
        revenue: 1_000_000,
        profitMargin: 20,
        currentGrowthCost: 0,
        realizedRevenue: undefined,
        countryId: "US",
      },
      { liquidCurrencyCode: undefined, countryId: "US" },
      1
    );
    const expectedDaily = 200_000;
    const expectedYearly = expectedDaily * GAME_DAYS_PER_YEAR;
    const expectedNpv = expectedYearly / NPV_ANNUAL_DISCOUNT_RATE;
    expect(valuation.dailyProfitAnchor).toBe(expectedDaily);
    expect(valuation.yearlyProfitAnchor).toBeCloseTo(expectedYearly, 5);
    expect(valuation.npvAnchor).toBe(Math.round(expectedNpv));
    expect(valuation.priceAnchor).toBe(Math.round(expectedNpv * SECTOR_FOR_SALE_PRICE_FRACTION));
  });

  it("returns 0 NPV when growth cost wipes out base profit", () => {
    const valuation = computeSectorListingValuation(
      {
        revenue: 100_000,
        profitMargin: 10,
        currentGrowthCost: 50_000,
        realizedRevenue: undefined,
        countryId: "US",
      },
      { liquidCurrencyCode: undefined, countryId: "US" },
      1
    );
    // Daily profit = 10000 - 50000 = -40K, NPV floored at 0.
    expect(valuation.npvAnchor).toBe(0);
    expect(valuation.priceAnchor).toBe(0);
  });

  it("normalizes a non-anchor corp's local currency to ₳ before computing NPV", () => {
    // JP corp: revenue stored in JPY at ~100 JPY per 1 ₳. So 100M JPY revenue
    // is really 1M ₳ revenue. The NPV math should run in ₳, then return ₳.
    const fxRate = 100; // local per ₳
    const valuation = computeSectorListingValuation(
      {
        revenue: 100_000_000,
        profitMargin: 20,
        currentGrowthCost: 0,
        realizedRevenue: undefined,
        countryId: "JP",
      },
      { liquidCurrencyCode: "JPY", countryId: "JP" },
      fxRate
    );
    // Equivalent to the USD case above: 1M ₳ × 0.20 = 200K ₳ daily profit
    const expectedDaily = 200_000;
    const expectedYearly = expectedDaily * GAME_DAYS_PER_YEAR;
    const expectedNpv = expectedYearly / NPV_ANNUAL_DISCOUNT_RATE;
    expect(valuation.dailyProfitAnchor).toBeCloseTo(expectedDaily, 5);
    expect(valuation.npvAnchor).toBe(Math.round(expectedNpv));
    expect(valuation.priceAnchor).toBe(Math.round(expectedNpv * SECTOR_FOR_SALE_PRICE_FRACTION));
  });

  it("price equals 75% of NPV by construction", () => {
    const v = computeSectorListingValuation(
      {
        revenue: 5_000_000,
        profitMargin: 25,
        currentGrowthCost: 0,
        realizedRevenue: undefined,
        countryId: "US",
      },
      { liquidCurrencyCode: undefined, countryId: "US" },
      1
    );
    expect(v.priceAnchor).toBe(Math.round(v.npvAnchor * SECTOR_FOR_SALE_PRICE_FRACTION));
  });
});
