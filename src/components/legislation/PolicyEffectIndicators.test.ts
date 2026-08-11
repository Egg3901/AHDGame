import { describe, expect, it } from "vitest";
import { computeMetricEffects } from "./PolicyEffectIndicators";

describe("computeMetricEffects — delta vs current law (Path B fallback)", () => {
  it("shows per-metric direction as a delta honoring weight sign + isHigherBetter when options lack metricEffects", () => {
    // Proposing the statist option (effectDirection +1) over the market option
    // currently active (-1): industrial-policy execution (positively weighted)
    // rises, GDP growth (negatively weighted) falls — each metric independently,
    // matching the bill-detail page and the metric-detail page.
    const result = computeMetricEffects({
      effectTargetsWeighted: [
        { metricCategoryId: "economic", metricId: "industrialPolicyExecution", weight: 0.7 },
        { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.3 },
      ],
      effectDirection: 1,
      currentPolicyIndex: 1,
      proposedPolicyIndex: 0,
      policyOptions: [
        { id: "opt0", effectDirection: 1 }, // proposed (left/statist)
        { id: "opt1", effectDirection: -1 }, // current (right/market)
      ],
    });

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "industrialPolicyExecution",
          direction: "up",
          isGood: true,
        }),
        expect.objectContaining({ name: "GDP Growth", direction: "down", isGood: false }),
      ])
    );
  });

  it("hides metrics with zero delta (same-side shift produces no metric movement)", () => {
    const result = computeMetricEffects({
      effectTargetsWeighted: [
        { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.3 },
      ],
      effectDirection: 1,
      currentPolicyIndex: 0,
      proposedPolicyIndex: 1,
      policyOptions: [
        { id: "opt0", effectDirection: 1 }, // current (left)
        { id: "opt1", effectDirection: 1 }, // proposed (left) — same direction
      ],
    });

    expect(result).toEqual([]);
  });

  it("Path B: emits a chip for a same-side intensity increase (#0962)", () => {
    // A 7-option ladder: proposing Maximum (idx0) while Moderate (idx2) is active.
    // Both are effectDirection +1 (same side), which the OLD 3-valued delta hid.
    // Graded intensity gives +1 vs +1/3 → a real delta → a chip.
    const policyOptions = [
      { id: "max", effectDirection: 1 },
      { id: "mod", effectDirection: 1 },
      { id: "less", effectDirection: 1 },
      { id: "center", effectDirection: 0 },
      { id: "cut", effectDirection: -1 },
      { id: "cut2", effectDirection: -1 },
      { id: "cut3", effectDirection: -1 },
    ];
    const result = computeMetricEffects({
      effectTargetsWeighted: [
        { metricCategoryId: "governance", metricId: "voterTurnout", weight: 1 },
      ],
      effectDirection: 1,
      currentPolicyIndex: 2, // Moderate (same side)
      proposedPolicyIndex: 0, // Maximum
      policyOptions,
    });
    expect(result.length).toBeGreaterThan(0);
  });
});
