import { describe, expect, it } from "vitest";
import { reviewedLawMetricEffectDeltas } from "./provisionImpact";

describe("reviewedLawMetricEffectDeltas", () => {
  const primaryResponse = [0.91, 0.73, 0.65, 0.49, 0.36];

  it("compares every proposed metric pressure with the current reviewed choice", () => {
    expect(
      reviewedLawMetricEffectDeltas({
        currentChoice: "center_right",
        primaryResponse,
        proposedEffects: [
          { metricId: "16", favorableNormalizedPoints: 0.91 },
          { metricId: "17", favorableNormalizedPoints: 0.91 },
          { metricId: "19", favorableNormalizedPoints: 0.91 },
        ],
      })
    ).toEqual([
      { metricId: "16", favorableNormalizedPoints: 0.42 },
      { metricId: "17", favorableNormalizedPoints: 0.42 },
      { metricId: "19", favorableNormalizedPoints: 0.42 },
    ]);
  });

  it("uses zero pressure for leave-to-states current law", () => {
    expect(
      reviewedLawMetricEffectDeltas({
        currentChoice: "leave_to_states",
        primaryResponse,
        proposedEffects: [{ metricId: "16", favorableNormalizedPoints: 0.73 }],
      })
    ).toEqual([{ metricId: "16", favorableNormalizedPoints: 0.73 }]);
  });

  it("refuses an incomplete profile instead of inventing a comparison", () => {
    expect(
      reviewedLawMetricEffectDeltas({
        currentChoice: "far_right",
        primaryResponse: [0.91],
        proposedEffects: [{ metricId: "16", favorableNormalizedPoints: 0.36 }],
      })
    ).toEqual([]);
  });

  it("shows the reduction when a federal program is left to the states", () => {
    expect(
      reviewedLawMetricEffectDeltas({
        currentChoice: "center_right",
        primaryResponse,
        proposedEffects: [{ metricId: "16", favorableNormalizedPoints: 0 }],
      })
    ).toEqual([{ metricId: "16", favorableNormalizedPoints: -0.49 }]);
  });

  it("preserves zero changes and omits non-finite forecasts", () => {
    expect(
      reviewedLawMetricEffectDeltas({
        currentChoice: "center_right",
        primaryResponse,
        proposedEffects: [
          { metricId: "16", favorableNormalizedPoints: 0.49 },
          { metricId: "17", favorableNormalizedPoints: NaN },
          { metricId: "19", favorableNormalizedPoints: Infinity },
        ],
      })
    ).toEqual([{ metricId: "16", favorableNormalizedPoints: 0 }]);
  });
});
