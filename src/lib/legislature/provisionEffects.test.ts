import { describe, it, expect } from "vitest";
import { computeProvisionEffectChips } from "./provisionEffects";

describe("computeProvisionEffectChips", () => {
  it("returns no chips when proposed equals current intensity (true no-op)", () => {
    const chips = computeProvisionEffectChips({
      effectTargetsWeighted: [
        { metricCategoryId: "governance", metricId: "voterTurnout", weight: 0.6 },
      ],
      proposedIntensity: 0.6,
      currentIntensity: 0.6,
    });
    expect(chips).toEqual([]);
  });

  it("emits a chip for a SAME-SIDE intensity increase (the #0962 fix)", () => {
    const chips = computeProvisionEffectChips({
      effectTargetsWeighted: [
        { metricCategoryId: "governance", metricId: "voterTurnout", weight: 0.6 },
      ],
      proposedIntensity: 1.0, // Maximum
      currentIntensity: 0.33, // Moderate (same side — was hidden before)
    });
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ metric: expect.any(String), direction: "up", isGood: true });
  });

  it("emits a chip vs center default when no current intensity", () => {
    const chips = computeProvisionEffectChips({
      effectTargetsWeighted: [
        { metricCategoryId: "governance", metricId: "voterTurnout", weight: 0.6 },
      ],
      proposedIntensity: 1.0,
    });
    expect(chips).toHaveLength(1);
  });

  it("caps output at 4 chips and dedupes by metric", () => {
    const target = (metricId: string) => ({
      metricCategoryId: "governance",
      metricId,
      weight: 0.5,
    });
    const chips = computeProvisionEffectChips({
      effectTargetsWeighted: [
        target("a"),
        target("a"),
        target("b"),
        target("c"),
        target("d"),
        target("e"),
      ],
      proposedIntensity: 1,
      currentIntensity: 0,
    });
    expect(chips.length).toBeLessThanOrEqual(4);
  });
});
