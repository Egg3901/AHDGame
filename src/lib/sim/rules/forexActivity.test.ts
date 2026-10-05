import { describe, expect, it } from "vitest";
import { summarizeForexActivity } from "./forexActivity";

describe("summarizeForexActivity (#2293)", () => {
  it("flags an enabled world with no orders or trades as macro-only and unexercised", () => {
    const record = summarizeForexActivity({
      forexEnabled: true,
      orders: [],
      trades: [],
      interventionCount: 0,
    });
    expect(record.exercised).toBe(false);
    expect(record.rateAttribution).toBe("macro_only");
    expect(record.fillRate).toBeNull();
    expect(record.spreadRate).toBeNull();
    expect(record.summary).toContain("UNEXERCISED");
  });

  it("reports a disabled product as disabled, never as unexercised", () => {
    const record = summarizeForexActivity({
      forexEnabled: false,
      orders: [],
      trades: [],
      interventionCount: 0,
    });
    expect(record.rateAttribution).toBe("disabled");
    expect(record.summary).toContain("disabled");
  });

  it("records orders, fill rate, volume, spread, interventions and unresolved orders", () => {
    const record = summarizeForexActivity({
      forexEnabled: true,
      orders: [
        { status: "filled", amount: 100, filledAmount: 100 },
        { status: "partial", amount: 100, filledAmount: 40 },
        { status: "open", amount: 100, filledAmount: 0 },
        { status: "expired", amount: 100, filledAmount: 0 },
      ],
      trades: [
        { amount: 200, rate: 2, spread: 4 },
        { amount: 100, rate: 1, spread: 2 },
      ],
      interventionCount: 3,
    });
    expect(record.orderCount).toBe(4);
    expect(record.filledOrderCount).toBe(1);
    expect(record.unresolvedOrderCount).toBe(2);
    expect(record.fillRate).toBe(0.5);
    expect(record.executedVolume).toBe(200);
    expect(record.spreadRate).toBeCloseTo(6 / 300, 12);
    expect(record.interventionCount).toBe(3);
    expect(record.rateAttribution).toBe("market_activity");
    expect(record.exercised).toBe(true);
  });

  it("does not attribute movement to trading when only intervention occurred", () => {
    const record = summarizeForexActivity({
      forexEnabled: true,
      orders: [],
      trades: [],
      interventionCount: 5,
    });
    expect(record.rateAttribution).toBe("macro_only");
    expect(record.interventionCount).toBe(5);
  });

  it("ignores non-finite trade values", () => {
    const record = summarizeForexActivity({
      forexEnabled: true,
      orders: [],
      trades: [{ amount: Number.NaN, rate: 0, spread: Number.NaN }],
      interventionCount: Number.NaN,
    });
    expect(record.executedVolume).toBe(0);
    expect(record.interventionCount).toBe(0);
    expect(record.rateAttribution).toBe("macro_only");
  });
});
