import { describe, expect, it } from "vitest";
import { decomposeGdpGrowth } from "./gdpDecomposition";

describe("decomposeGdpGrowth", () => {
  it("splits total into potential + cyclical (cyclical = total - potential)", () => {
    const d = decomposeGdpGrowth(3.2, 2.4);
    expect(d.total).toBe(3.2);
    expect(d.potential).toBe(2.4);
    expect(d.cyclical).toBeCloseTo(0.8, 9);
  });

  it("reports a negative cyclical when growth is below potential (recessionary)", () => {
    const d = decomposeGdpGrowth(1.0, 2.5);
    expect(d.cyclical).toBeCloseTo(-1.5, 9);
    expect(d.isExpansionary).toBe(false);
  });

  it("flags expansionary when total exceeds potential", () => {
    expect(decomposeGdpGrowth(3.0, 2.0).isExpansionary).toBe(true);
  });

  it("treats a non-finite potential as zero so it never yields NaN", () => {
    const d = decomposeGdpGrowth(2.0, Number.NaN);
    expect(d.potential).toBe(0);
    expect(d.cyclical).toBe(2.0);
  });
});
