import { describe, expect, it } from "vitest";
import { runResetActionStress } from "./resetCabinetActions2026-09-29";

describe("240-turn reset Cabinet action stress fixture", () => {
  it("keeps action concurrency per office with a capped temporary target effect", () => {
    const result = runResetActionStress();
    expect(result.turns).toBe(240);
    expect(result.active1991Seats).toBeGreaterThan(4);
    expect(result.peakSimultaneousActions).toBeGreaterThan(4);
    expect(result.peakSameTargetEffect).toBeLessThanOrEqual(0.2);
    expect(result.activations).toBeGreaterThan(result.active1991Seats);
    expect(result.operatingCostShareOfCombinedAnnualGdp).toBeGreaterThan(0);
  });

  it("does not manufacture any outcome or fiscal draw without an action", () => {
    const result = runResetActionStress(false);
    expect(result.activations).toBe(0);
    expect(result.peakSameTargetEffect).toBe(0);
    expect(result.operatingCostShareOfCombinedAnnualGdp).toBe(0);
  });
});
