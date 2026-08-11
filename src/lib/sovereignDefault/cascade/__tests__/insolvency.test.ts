import { describe, it, expect } from "vitest";
import { isCorporationInsolvent } from "../insolvency";

describe("isCorporationInsolvent — phase 7 simple rule", () => {
  it("liquidCapital below zero is insolvent", () => {
    expect(isCorporationInsolvent({ liquidCapital: -1 })).toBe(true);
  });

  it("liquidCapital exactly zero is solvent (boundary)", () => {
    expect(isCorporationInsolvent({ liquidCapital: 0 })).toBe(false);
  });

  it("positive liquidCapital is solvent", () => {
    expect(isCorporationInsolvent({ liquidCapital: 1 })).toBe(false);
  });

  it("treats NaN defensively as solvent (broken input shouldn't trigger cascade)", () => {
    expect(isCorporationInsolvent({ liquidCapital: Number.NaN })).toBe(false);
  });
});
