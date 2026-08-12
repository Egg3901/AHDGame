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

  it("converts a JPY share price into ₳ (rates are local-per-₳)", () => {
    // Rates: local currency per 1 ₳. ¥30,000 / 102.23 ≈ 293.5 ₳. The fund's own
    // currency is irrelevant: every fund leg is ₳.
    const rates = { USD: 1.005, JPY: 102.23 };
    const result = convertLocalPriceToAnchor(30_000, "JPY", rates);
    expect(result).toBeCloseTo(293.5, 0);
  });

  it("converts a CNY share price into ₳", () => {
    // ¥3,221 CNY at 7.138 CNY/₳ → 451.2 ₳
    const rates = { USD: 1.005, CNY: 7.138 };
    const result = convertLocalPriceToAnchor(3_221, "CNY", rates);
    expect(result).toBeCloseTo(451.2, 0);
  });

  it("converts a GBP share price into ₳", () => {
    // £100 at 0.8385 GBP/₳ → 119.3 ₳
    const rates = { USD: 1.005, GBP: 0.8385 };
    const result = convertLocalPriceToAnchor(100, "GBP", rates);
    expect(result).toBeCloseTo(119.3, 0);
  });

  it("divides even a USD price by its rate: no currency is 1:1 with ₳", () => {
    // The old same-currency short-circuit against the FUND's currency is what
    // made a USD fund look correct while every other fund mispriced.
    expect(convertLocalPriceToAnchor(50, "USD", { USD: 1.005 })).toBeCloseTo(49.75, 2);
  });

  it("treats a pre-forex corp with no home currency as already ₳", () => {
    expect(convertLocalPriceToAnchor(50, undefined, { USD: 1.005 })).toBe(50);
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
    // 10 shares × ¥30,000 at JPY=102.23 → 10 × 293.5 ≈ 2,935 ₳
    expect(refreshed[0].lastValueAnchor).toBeCloseTo(2_935, 0);
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
