import { describe, expect, it } from "vitest";
import { aggregateExchangeTotals } from "./aggregate";

describe("aggregateExchangeTotals", () => {
  it("sums the anchor fields, not the local ones", () => {
    const t = aggregateExchangeTotals([
      { marketCap: 1_000_000, marketCapAnchor: 10_000 },
      { marketCap: 2_000_000, marketCapAnchor: 20_000 },
    ]);
    expect(t.marketCap).toBe(30_000);
  });

  it("falls back to the local field when no anchor was written", () => {
    expect(aggregateExchangeTotals([{ marketCap: 500 }]).marketCap).toBe(500);
  });

  it("treats an anchor of 0 as a real value, not a missing one", () => {
    // A worthless listing anchors at 0. Falling back to its local figure would
    // resurrect it at full local face value.
    expect(aggregateExchangeTotals([{ marketCap: 999, marketCapAnchor: 0 }]).marketCap).toBe(0);
  });

  it("weights price change by anchored market cap", () => {
    // 90% of anchored cap moved +10, 10% moved 0 => +9.
    const t = aggregateExchangeTotals([
      { marketCapAnchor: 900, priceChange24h: 10 },
      { marketCapAnchor: 100, priceChange24h: 0 },
    ]);
    expect(t.weightedChange24h).toBe(9);
  });

  it("weights each timeframe independently", () => {
    const t = aggregateExchangeTotals([
      { marketCapAnchor: 100, priceChange1h: 1, priceChange24h: 2, priceChange48h: 3 },
    ]);
    expect(t.weightedChange1h).toBe(1);
    expect(t.weightedChange24h).toBe(2);
    expect(t.weightedChange48h).toBe(3);
  });

  it("sums revenue and income on the anchor basis too", () => {
    const t = aggregateExchangeTotals([
      { totalRevenue: 5_000, totalRevenueAnchor: 50, income: 1_000, incomeAnchor: 10 },
    ]);
    expect(t.revenue).toBe(50);
    expect(t.income).toBe(10);
  });

  it("returns zero changes when the exchange has no market cap", () => {
    const t = aggregateExchangeTotals([{ priceChange24h: 10 }]);
    expect(t.marketCap).toBe(0);
    expect(t.weightedChange24h).toBe(0);
  });

  it("returns zeroes for an empty exchange", () => {
    expect(aggregateExchangeTotals([])).toEqual({
      marketCap: 0,
      revenue: 0,
      income: 0,
      weightedChange1h: 0,
      weightedChange24h: 0,
      weightedChange48h: 0,
    });
  });

  it("ignores non-finite values rather than propagating NaN", () => {
    const t = aggregateExchangeTotals([
      { marketCapAnchor: 100, priceChange24h: 4 },
      { marketCapAnchor: Number.NaN, priceChange24h: 999 },
    ]);
    expect(t.marketCap).toBe(100);
    expect(t.weightedChange24h).toBe(4);
  });
});
