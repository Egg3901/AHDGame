import { describe, it, expect } from "vitest";
import { computeFiscalImpact } from "./fiscalImpact";

describe("computeFiscalImpact", () => {
  it("funds fully from surplus when balance covers the amount", () => {
    expect(computeFiscalImpact(1000, 400)).toEqual({ fromSurplus: 400, addedToDebt: 0 });
  });
  it("straddles zero: part surplus, part debt", () => {
    expect(computeFiscalImpact(300, 500)).toEqual({ fromSurplus: 300, addedToDebt: 200 });
  });
  it("is pure debt when already in deficit", () => {
    expect(computeFiscalImpact(-100, 250)).toEqual({ fromSurplus: 0, addedToDebt: 250 });
  });
  it("handles a zero amount", () => {
    expect(computeFiscalImpact(500, 0)).toEqual({ fromSurplus: 0, addedToDebt: 0 });
  });
});
