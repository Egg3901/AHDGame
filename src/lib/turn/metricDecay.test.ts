import { describe, it, expect } from "vitest";

describe("metricDecay", () => {
  it("decays metrics toward baseline by 0.25% of distance per turn", async () => {
    const { calculateDecay } = await import("./metricDecay");
    expect(calculateDecay(80, 50)).toBeCloseTo(79.925, 3);
  });

  it("decays metrics below baseline upward", async () => {
    const { calculateDecay } = await import("./metricDecay");
    expect(calculateDecay(20, 50)).toBeCloseTo(20.075, 3);
  });

  it("snaps metrics already at baseline", async () => {
    const { calculateDecay } = await import("./metricDecay");
    expect(calculateDecay(50, 50)).toBe(50);
    expect(calculateDecay(50.001, 50)).toBeCloseTo(50, 2);
  });

  it("does not write a competing metric decay pass", async () => {
    const { processMetricDecay } = await import("./metricDecay");
    await expect(processMetricDecay()).resolves.toBe(0);
  });
});
