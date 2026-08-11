import { describe, expect, it } from "vitest";
import { planOpenMarketOperation } from "./quantitativeEasing";

describe("central-bank open-market operations", () => {
  it("QE creates deposits and moves sovereign bonds out of public float", () => {
    const trade = planOpenMarketOperation({
      operation: "qe",
      requestedUnits: 100,
      publicFloat: 250,
      centralBankHoldings: 0,
      totalIssued: 1_000_000,
      marketPrice: 0.9,
    });

    expect(trade.units).toBe(100);
    expect(trade.publicFloat).toBe(150);
    expect(trade.centralBankHoldings).toBe(100);
    expect(trade.moneySupplyDelta).toBe(90_000);
    expect(trade.qeSupportRatio).toBe(0.1);
  });

  it("QT cannot sell more bonds than the bank owns and retires deposits", () => {
    const trade = planOpenMarketOperation({
      operation: "qt",
      requestedUnits: 100,
      publicFloat: 150,
      centralBankHoldings: 40,
      totalIssued: 1_000_000,
      marketPrice: 1.05,
    });

    expect(trade.units).toBe(40);
    expect(trade.publicFloat).toBe(190);
    expect(trade.centralBankHoldings).toBe(0);
    expect(trade.moneySupplyDelta).toBe(-42_000);
  });
});
