import { describe, expect, it } from "vitest";
import { fundingResponse, perCapitaSpending, maintenanceDecay } from "./spendingChannel";

describe("fundingResponse", () => {
  it("is 0 at zero (or negative) funding", () => {
    expect(fundingResponse(0)).toBe(0);
    expect(fundingResponse(-5)).toBe(0);
  });

  it("is monotonic increasing and bounded below max", () => {
    const a = fundingResponse(1);
    const b = fundingResponse(10);
    const c = fundingResponse(100);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(c).toBeLessThan(100); // saturates toward, never reaches, max
  });

  it("has diminishing returns (concave): equal funding steps yield shrinking gains", () => {
    const g1 = fundingResponse(10) - fundingResponse(0);
    const g2 = fundingResponse(20) - fundingResponse(10);
    const g3 = fundingResponse(30) - fundingResponse(20);
    expect(g2).toBeLessThan(g1);
    expect(g3).toBeLessThan(g2);
  });

  it("hits max/2 at the half-saturation point", () => {
    expect(fundingResponse(5, 5, 100)).toBeCloseTo(50, 5);
  });
});

describe("perCapitaSpending", () => {
  it("divides spending by population", () => {
    expect(perCapitaSpending(1000, 100)).toBe(10);
  });
  it("returns 0 for non-positive or non-finite population (safe divide)", () => {
    expect(perCapitaSpending(1000, 0)).toBe(0);
    expect(perCapitaSpending(1000, -1)).toBe(0);
    expect(perCapitaSpending(1000, NaN)).toBe(0);
  });
});

describe("maintenanceDecay", () => {
  it("decays toward target by `decay` when underfunded", () => {
    // prev 80, target (funding) 50, decay 5 → max(75, 50) = 75 (decaying, capped per turn)
    expect(maintenanceDecay(80, 50, 5)).toBe(75);
  });
  it("holds at target when funding meets/exceeds it", () => {
    // prev 60, target 90, decay 5 → max(55, 90) = 90 (funding holds it up)
    expect(maintenanceDecay(60, 90, 5)).toBe(90);
  });
  it("never drops below target in a single turn", () => {
    expect(maintenanceDecay(52, 50, 5)).toBe(50); // max(47, 50) = 50
  });
});
