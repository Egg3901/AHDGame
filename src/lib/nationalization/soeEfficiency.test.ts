import { describe, expect, it } from "vitest";
import { computeSoeEfficiencyPenalty } from "./soeEfficiency";
import { BASE_SOE_PENALTY, SOE_PENALTY_MIN, SOE_PENALTY_MAX } from "./constants";

describe("computeSoeEfficiencyPenalty", () => {
  it("returns the base penalty when metrics are unknown and no posture", () => {
    const p = computeSoeEfficiencyPenalty({
      corruptionIndex: null,
      governmentTransparency: null,
      priceControlled: false,
      employmentGuaranteed: false,
    });
    expect(p).toBe(BASE_SOE_PENALTY);
  });

  it("is less punishing for a clean, transparent state than a corrupt one", () => {
    const clean = computeSoeEfficiencyPenalty({
      corruptionIndex: 0,
      governmentTransparency: 100,
      priceControlled: false,
      employmentGuaranteed: false,
    });
    const corrupt = computeSoeEfficiencyPenalty({
      corruptionIndex: 100,
      governmentTransparency: 0,
      priceControlled: false,
      employmentGuaranteed: false,
    });
    expect(clean).toBeGreaterThan(corrupt); // less negative = less drag
  });

  it("adds extra drag when price-controlled", () => {
    const base = {
      corruptionIndex: 30,
      governmentTransparency: 50,
      priceControlled: false,
      employmentGuaranteed: false,
    };
    const withControl = { ...base, priceControlled: true };
    expect(computeSoeEfficiencyPenalty(withControl)).toBeLessThan(
      computeSoeEfficiencyPenalty(base)
    );
  });

  it("adds extra drag when employment-guaranteed (employer-of-last-resort payroll)", () => {
    const base = {
      corruptionIndex: 30,
      governmentTransparency: 50,
      priceControlled: false,
      employmentGuaranteed: false,
    };
    const withJobs = { ...base, employmentGuaranteed: true };
    expect(computeSoeEfficiencyPenalty(withJobs)).toBeLessThan(computeSoeEfficiencyPenalty(base));
  });

  it("stacks both postures' drag", () => {
    const base = {
      corruptionIndex: 30,
      governmentTransparency: 50,
      priceControlled: false,
      employmentGuaranteed: false,
    };
    const both = { ...base, priceControlled: true, employmentGuaranteed: true };
    const onlyPrice = { ...base, priceControlled: true };
    expect(computeSoeEfficiencyPenalty(both)).toBeLessThan(computeSoeEfficiencyPenalty(onlyPrice));
  });

  it("never exceeds the clamp bounds", () => {
    const best = computeSoeEfficiencyPenalty({
      corruptionIndex: 0,
      governmentTransparency: 100,
      priceControlled: false,
      employmentGuaranteed: false,
    });
    const worst = computeSoeEfficiencyPenalty({
      corruptionIndex: 100,
      governmentTransparency: 0,
      priceControlled: true,
      employmentGuaranteed: true,
    });
    expect(best).toBeLessThanOrEqual(SOE_PENALTY_MIN);
    expect(best).toBeGreaterThanOrEqual(SOE_PENALTY_MAX);
    expect(worst).toBeGreaterThanOrEqual(SOE_PENALTY_MAX);
    expect(worst).toBeLessThanOrEqual(SOE_PENALTY_MIN);
  });

  it("overreach deepens the penalty with concentration but never below the clamp floor", () => {
    const lean = computeSoeEfficiencyPenalty({
      corruptionIndex: 20,
      governmentTransparency: 60,
      priceControlled: false,
      employmentGuaranteed: false,
      concentrationMultiplier: 1, // SOCI below danger zone
    });
    const sprawling = computeSoeEfficiencyPenalty({
      corruptionIndex: 20,
      governmentTransparency: 60,
      priceControlled: false,
      employmentGuaranteed: false,
      concentrationMultiplier: 2.5, // deep in the danger zone
    });
    expect(sprawling).toBeLessThan(lean); // more drag at high SOCI
    expect(sprawling).toBeGreaterThanOrEqual(SOE_PENALTY_MAX); // clamp floor holds (not loss-locked)
  });

  it("omitting concentrationMultiplier is regression-safe (no overreach)", () => {
    const withDefault = computeSoeEfficiencyPenalty({
      corruptionIndex: 20,
      governmentTransparency: 60,
      priceControlled: false,
      employmentGuaranteed: false,
    });
    const withOne = computeSoeEfficiencyPenalty({
      corruptionIndex: 20,
      governmentTransparency: 60,
      priceControlled: false,
      employmentGuaranteed: false,
      concentrationMultiplier: 1,
    });
    expect(withDefault).toBe(withOne);
  });
});
