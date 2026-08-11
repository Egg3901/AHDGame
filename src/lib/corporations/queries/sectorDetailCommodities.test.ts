import { describe, expect, it } from "vitest";
import {
  computeCapitalUsage,
  perUnitAnchorAmount,
} from "@/lib/corporations/queries/sectorDetailCommodities";

describe("sector detail capital economics", () => {
  it("computes per-unit labour from an anchor-normalized total", () => {
    // A host-currency labour total must be converted before reaching this helper.
    // 37,400 ₳ / 11 output units = 3,400 ₳ per unit.
    expect(perUnitAnchorAmount(37_400, 11)).toBe(3_400);
    expect(perUnitAnchorAmount(null, 11)).toBeNull();
    expect(perUnitAnchorAmount(37_400, 0)).toBeNull();
  });

  it("distinguishes actual capacity usage from capacity coverage", () => {
    const usage = computeCapitalUsage(1_125, 11);
    expect(usage.capacityUsed).toBe(11);
    expect(usage.utilization).toBeCloseTo(11 / 1_125, 10);
  });

  it("caps actual usage at installed capacity", () => {
    const usage = computeCapitalUsage(50, 100);
    expect(usage.capacityUsed).toBe(50);
    expect(usage.utilization).toBe(1);
  });

  it("handles missing and exhausted capacity", () => {
    expect(computeCapitalUsage(null, 10)).toEqual({
      utilization: null,
      capacityUsed: null,
    });
    expect(computeCapitalUsage(0, 10)).toEqual({
      utilization: 0,
      capacityUsed: 0,
    });
  });
});
