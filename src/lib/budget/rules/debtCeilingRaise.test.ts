import { describe, expect, it } from "vitest";
import { DEBT_CEILING_RAISE_HEADROOM, raisedDebtCeiling } from "./debtCeilingRaise";

describe("raisedDebtCeiling", () => {
  it("leaves a ceiling alone while the stock is well below it", () => {
    expect(raisedDebtCeiling({ principal: 900, ceiling: 1000 })).toBeNull();
  });

  it("raises when the stock reaches the trigger band", () => {
    expect(raisedDebtCeiling({ principal: 960, ceiling: 1000 })).toBe(
      Math.round(960 * DEBT_CEILING_RAISE_HEADROOM)
    );
  });

  it("raises a ceiling that has already been breached (US at 1.03)", () => {
    const raised = raisedDebtCeiling({ principal: 4_259_000_000_000, ceiling: 4_145_000_000_000 });
    expect(raised).toBe(Math.round(4_259_000_000_000 * 1.1));
    expect(4_259_000_000_000 / raised!).toBeLessThan(1);
  });

  it("never lowers a ceiling and ignores bad inputs", () => {
    expect(raisedDebtCeiling({ principal: 1000, ceiling: 5000 })).toBeNull();
    expect(raisedDebtCeiling({ principal: 0, ceiling: 1000 })).toBeNull();
    expect(raisedDebtCeiling({ principal: Number.NaN, ceiling: 1000 })).toBeNull();
    expect(raisedDebtCeiling({ principal: 1000, ceiling: 0 })).toBeNull();
  });
});
