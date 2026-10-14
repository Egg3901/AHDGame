import { describe, expect, it } from "vitest";
import { primaryMetricById } from "../catalog";
import { resetMetricConditionScore } from "../conditionScore";
import {
  POLICY_PRESSURE_SCORE_POINTS,
  driftProxyValue,
  policyDriftCadence,
  policyDriftFraction,
  policyDriftTarget,
} from "./policyDrift";

const energySecurity = primaryMetricById("58")!;
const roadCondition = primaryMetricById("26")!;
const gradRate = primaryMetricById("11")!;

describe("v2 proxy policy drift", () => {
  it("closes a cadence-sized share of the gap with a 34 turn half-life", () => {
    expect(policyDriftFraction(1)).toBeCloseTo(0.02, 10);
    expect(policyDriftFraction(12)).toBeCloseTo(1 - 0.98 ** 12, 10);
    expect(policyDriftFraction(48)).toBeCloseTo(1 - 0.98 ** 48, 10);
    expect(policyDriftCadence(energySecurity)).toBe(12);
    expect(policyDriftCadence(roadCondition)).toBe(12);
    expect(policyDriftCadence(gradRate)).toBe(1);
  });

  it("settles a favorable law at opening score plus scaled pressure, in the metric's own unit", () => {
    // Energy security is a risk band: lower is better, and the opening score
    // is 100 - value. Japan opened at 80.24 (ticket 1539).
    const target = policyDriftTarget({
      metric: energySecurity,
      currentValue: 80.24,
      openingValue: 80.24,
      pressure: 0.73,
      countryId: "JP",
      year: 1994,
    });
    expect(target).not.toBeNull();
    const openingScore = resetMetricConditionScore(energySecurity, 80.24, "JP", 1994)!;
    const targetScore = resetMetricConditionScore(energySecurity, target!, "JP", 1994)!;
    expect(targetScore - openingScore).toBeCloseTo(0.73 * POLICY_PRESSURE_SCORE_POINTS, 3);
    expect(target!).toBeLessThan(80.24);
  });

  it("moves toward the settlement each refresh and never overshoots it", () => {
    const input = {
      metric: energySecurity,
      currentValue: 80.24,
      openingValue: 80.24,
      pressure: 0.73,
      countryId: "JP" as const,
      year: 1994,
    };
    const target = policyDriftTarget(input)!;
    const first = driftProxyValue(input);
    expect(first).toBeLessThan(80.24);
    expect(first).toBeGreaterThan(target);
    expect((80.24 - first) / (80.24 - target)).toBeCloseTo(policyDriftFraction(12), 3);
    let value = first;
    for (let i = 0; i < 200; i += 1) value = driftProxyValue({ ...input, currentValue: value });
    expect(value).toBe(target);
    expect(driftProxyValue({ ...input, currentValue: target })).toBe(target);
  });

  it("drifts back toward the opening once the pressure lapses, so nothing is a permanent bonus", () => {
    const lifted = driftProxyValue({
      metric: roadCondition,
      currentValue: 72,
      openingValue: 72,
      pressure: 0.89,
      countryId: "JP",
      year: 1994,
    });
    expect(lifted).toBeGreaterThan(72);
    const relaxed = driftProxyValue({
      metric: roadCondition,
      currentValue: lifted,
      openingValue: 72,
      pressure: 0,
      countryId: "JP",
      year: 1994,
    });
    expect(relaxed).toBeLessThan(lifted);
    expect(relaxed).toBeGreaterThan(72);
  });

  it("is a plain carry-forward without pressure at the opening value", () => {
    expect(
      driftProxyValue({
        metric: roadCondition,
        currentValue: 72,
        openingValue: 72,
        pressure: 0,
        countryId: "JP",
        year: 1994,
      })
    ).toBe(72);
  });

  it("applies unfavorable pressure in the unfavorable direction", () => {
    const value = driftProxyValue({
      metric: roadCondition,
      currentValue: 72,
      openingValue: 72,
      pressure: -0.5,
      countryId: "JP",
      year: 1994,
    });
    expect(value).toBeLessThan(72);
  });

  it("keeps the value when the metric cannot be scored", () => {
    const unscored = { ...roadCondition, id: "99", path: "nowhere.unknownMetric" };
    expect(
      driftProxyValue({
        metric: unscored,
        currentValue: 40,
        openingValue: 40,
        pressure: 0.9,
        countryId: "JP",
        year: 1994,
      })
    ).toBe(40);
  });
});
