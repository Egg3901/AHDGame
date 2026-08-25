import { describe, expect, it } from "vitest";
import { federalSurplus } from "./federalSurplus";

describe("federalSurplus", () => {
  it("returns revenue minus spending", () => {
    expect(federalSurplus({ revenue: { total: 100 }, spending: { total: 40 } })).toBe(60);
  });

  it("returns a negative number for a deficit", () => {
    expect(federalSurplus({ revenue: { total: 40 }, spending: { total: 100 } })).toBe(-60);
  });

  it("treats a missing revenue total as zero", () => {
    expect(federalSurplus({ spending: { total: 25 } })).toBe(-25);
  });

  it("treats a missing spending total as zero", () => {
    expect(federalSurplus({ revenue: { total: 25 } })).toBe(25);
  });

  it("treats a non-finite total as zero rather than propagating NaN", () => {
    expect(federalSurplus({ revenue: { total: Number.NaN }, spending: { total: 10 } })).toBe(-10);
  });

  it("returns zero for an empty budget", () => {
    expect(federalSurplus({})).toBe(0);
  });
});
