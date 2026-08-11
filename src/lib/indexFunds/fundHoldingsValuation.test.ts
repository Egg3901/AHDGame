import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { recomputeNav } from "./fundCron";
import {
  convertLocalPriceToAnchor,
  holdingsNeedMarkToMarketRefresh,
  refreshFundHoldingsMarkToMarket,
} from "./fundHoldingsValuation";
import type { IndexFund } from "@/lib/db/types";

describe("fundHoldingsValuation", () => {
  const corpId = new ObjectId();
  const fund: IndexFund = {
    _id: new ObjectId(),
    slug: "us_top_25",
    name: "US Top 25",
    tickerSymbol: "US25",
    scope: "country",
    kind: "broad",
    countryId: "US",
    anchorCurrencyCode: "USD",
    status: "active",
    quotedNav: 100,
    unitSupply: 100_000,
    reserveUnits: 0,
    cashAnchor: 0,
    targetConstituents: [],
    holdings: [
      {
        corporationId: corpId,
        shares: 1000,
        avgCostPerShareAnchor: 10,
        lastValueAnchor: 10_000,
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("detects stale lastValueAnchor vs current quotes", () => {
    const corpById = new Map([
      [
        corpId.toString(),
        {
          _id: corpId,
          sharePrice: 20,
          totalShares: 10_000,
          publicFloat: 5_000,
          liquidCurrencyCode: "USD" as const,
        },
      ],
    ]);

    expect(holdingsNeedMarkToMarketRefresh(fund, corpById, {})).toBe(true);
    const refreshed = refreshFundHoldingsMarkToMarket(fund, corpById, {});
    expect(refreshed[0].lastValueAnchor).toBe(20_000);
  });

  it("cross-currency: converts JPY share price to USD anchor (rates are local-per-₳)", () => {
    // Rates: local currency per 1 ₳. USD≈1.005, JPY=102.23.
    // ¥30,000 share → ₳ first: 30,000 / 102.23 ≈ 293.5 ₳ → USD: 293.5 × 1.005 ≈ 294.9
    const rates = { USD: 1.005, JPY: 102.23 };
    const result = convertLocalPriceToAnchor(30_000, "JPY", "USD", rates);
    expect(result).toBeCloseTo(294.9, 0);
  });

  it("cross-currency: converts CNY share price to USD anchor", () => {
    // ¥3,221 CNY at rate 7.138 CNY/₳, USD 1.005/₳ → 3221 / 7.138 * 1.005 ≈ 453.5
    const rates = { USD: 1.005, CNY: 7.138 };
    const result = convertLocalPriceToAnchor(3_221, "CNY", "USD", rates);
    expect(result).toBeCloseTo(453.5, 0);
  });

  it("cross-currency: converts GBP share price to USD anchor", () => {
    // £100 at GBP 0.8385/₳, USD 1.005/₳ → 100 / 0.8385 * 1.005 ≈ 119.9
    const rates = { USD: 1.005, GBP: 0.8385 };
    const result = convertLocalPriceToAnchor(100, "GBP", "USD", rates);
    expect(result).toBeCloseTo(119.9, 0);
  });

  it("same-currency short-circuit returns localPrice unchanged", () => {
    expect(convertLocalPriceToAnchor(50, "USD", "USD", { USD: 1.005 })).toBe(50);
  });

  it("MTM refresh applies correct cross-currency conversion for JPY corp in USD fund", () => {
    const jId = new ObjectId();
    const jpyFund = {
      ...fund,
      anchorCurrencyCode: "USD" as const,
      holdings: [{ corporationId: jId, shares: 10, avgCostPerShareAnchor: 0, lastValueAnchor: 0 }],
    };
    const corpById = new Map([
      [
        jId.toString(),
        {
          _id: jId,
          sharePrice: 30_000,
          totalShares: 1_000,
          publicFloat: 100,
          liquidCurrencyCode: "JPY" as const,
        },
      ],
    ]);
    const rates = { USD: 1.005, JPY: 102.23 };
    const refreshed = refreshFundHoldingsMarkToMarket(jpyFund, corpById, rates);
    // 10 shares × ¥30,000 at JPY=102.23, USD=1.005 → 10 × 294.9 ≈ 2,949
    expect(refreshed[0].lastValueAnchor).toBeCloseTo(2_949, 0);
  });

  it("updates NAV when holdings are marked to market", () => {
    const staleNav = recomputeNav(fund);
    expect(staleNav).toBeCloseTo(0.1, 5);

    const corpById = new Map([
      [
        corpId.toString(),
        {
          _id: corpId,
          sharePrice: 20,
          totalShares: 10_000,
          publicFloat: 5_000,
          liquidCurrencyCode: "USD" as const,
        },
      ],
    ]);
    const refreshedFund = {
      ...fund,
      holdings: refreshFundHoldingsMarkToMarket(fund, corpById, {}),
    };
    expect(recomputeNav(refreshedFund)).toBeCloseTo(0.2, 5);
  });
});
