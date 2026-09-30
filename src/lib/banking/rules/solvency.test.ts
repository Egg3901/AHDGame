import { describe, expect, it } from "vitest";
import { depositTakerFails } from "./solvency";
describe("deposit-taker insolvency", () => {
  it("resolves exhausted equity even when loan write-off improves the confidence denominator", () => {
    expect(
      depositTakerFails({
        priorBand: "green",
        cashReserves: 9_000_000,
        requiredLiquidity: 1_500_000,
        netAssets: -1_000_000,
      })
    ).toBe(true);
  });
  it("does not confuse illiquid but solvent securities with an exhausted estate", () => {
    expect(
      depositTakerFails({
        priorBand: "green",
        cashReserves: 1_000_000,
        requiredLiquidity: 1_500_000,
        netAssets: 5_000_000,
      })
    ).toBe(false);
    expect(
      depositTakerFails({
        priorBand: "green",
        cashReserves: 1,
        requiredLiquidity: 1,
        netAssets: -0.000001,
      })
    ).toBe(false);
    expect(
      depositTakerFails({
        priorBand: "red",
        cashReserves: 0,
        requiredLiquidity: 1_500_000,
        netAssets: 5_000_000,
      })
    ).toBe(true);
  });
});
