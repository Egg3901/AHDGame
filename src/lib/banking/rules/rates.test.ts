import { describe, expect, it } from "vitest";
import { playerDepositRatePercent } from "./rates";

describe("playerDepositRatePercent", () => {
  // Prime 4, inflation 0: base APY = max(0.5, 4) / 2 = 2.
  it("pays only the over-CB premium for pointer balances", () => {
    expect(playerDepositRatePercent(4, false, 4, 0)).toBe(2);
  });

  it("pays the full posted rate once player balances are cash-backed", () => {
    expect(playerDepositRatePercent(4, true, 4, 0)).toBe(4);
  });

  it("floors at zero when the posted rate sits below base", () => {
    expect(playerDepositRatePercent(0.05, false, 4, 0)).toBe(0);
  });

  it("treats a missing prime as zero prime, keeping the floor", () => {
    // Base = max(0.5, 0 - 0) / 2 = 0.25; 4 - 0.25 = 3.75.
    expect(playerDepositRatePercent(4, false, Number.NaN, 0)).toBeCloseTo(3.75, 10);
  });
});
