import { describe, it, expect } from "vitest";
import { computeBondWriteDownSeverity } from "../writeDownSeverity";

describe("computeBondWriteDownSeverity", () => {
  it("repudiate severity = 1 - REPUDIATE_BOND_MARKET_PRICE", () => {
    expect(computeBondWriteDownSeverity("repudiate")).toBeCloseTo(0.95);
  });

  it("restructure severity = RESTRUCTURE_HAIRCUT", () => {
    expect(computeBondWriteDownSeverity("restructure")).toBeCloseTo(0.4);
  });

  it("corp-default severity is full loss (1.0)", () => {
    expect(computeBondWriteDownSeverity("corp-default")).toBe(1.0);
  });
});
