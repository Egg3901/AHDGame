import { describe, expect, it } from "vitest";
import { primaryMetricById } from "../catalog";
import { estimateObservedMetricChange } from "./effectForecast";

describe("observed metric effect forecast", () => {
  it("expresses favorable pressure in the metric's observed direction", () => {
    const unemployment = estimateObservedMetricChange({
      metric: primaryMetricById("01")!,
      currentValue: 5.6,
      favorableNormalizedPoints: 0.72,
      countryId: "US",
      year: 1991,
    });
    const coverage = estimateObservedMetricChange({
      metric: primaryMetricById("16")!,
      currentValue: 86,
      favorableNormalizedPoints: 0.24,
      countryId: "US",
      year: 1991,
    });

    expect(unemployment?.delta).toBeLessThan(0);
    expect(coverage?.delta).toBeGreaterThan(0);
  });

  it("expresses currency and preferred-band metrics in their observed units", () => {
    const purchasingPower = estimateObservedMetricChange({
      metric: primaryMetricById("02")!,
      currentValue: 30_000,
      favorableNormalizedPoints: 0.72,
      countryId: "US",
      year: 1991,
    });
    const priceStability = estimateObservedMetricChange({
      metric: primaryMetricById("07")!,
      currentValue: 4.2,
      favorableNormalizedPoints: 0.72,
      countryId: "US",
      year: 1991,
    });

    expect(purchasingPower?.delta).toBeGreaterThan(0);
    expect(purchasingPower?.delta).toBeLessThan(1_000);
    expect(priceStability?.delta).toBeLessThan(0);
  });

  it("reports no observed change for an equilibrium coefficient", () => {
    expect(
      estimateObservedMetricChange({
        metric: primaryMetricById("16")!,
        currentValue: 86,
        favorableNormalizedPoints: 0,
        countryId: "US",
        year: 1991,
      })
    ).toEqual({ delta: 0, projectedValue: 86 });
  });

  it("can express an option that is worse than current law", () => {
    const coverage = estimateObservedMetricChange({
      metric: primaryMetricById("16")!,
      currentValue: 86,
      favorableNormalizedPoints: -0.24,
      countryId: "US",
      year: 1991,
    });

    expect(coverage?.delta).toBeLessThan(0);
  });

  it("does not fabricate a forecast without a current observation", () => {
    expect(
      estimateObservedMetricChange({
        metric: primaryMetricById("16")!,
        currentValue: null,
        favorableNormalizedPoints: 0.24,
        countryId: "US",
        year: 1991,
      })
    ).toBeNull();
  });
});
