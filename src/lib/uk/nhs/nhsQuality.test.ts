import { describe, it, expect } from "vitest";
import {
  nhsTargetQuality,
  tickNhsQuality,
  nhsSalienceMultiplier,
  nhsApprovalModifier,
  NHS_QUALITY_MAX_STEP,
  NHS_TARGET_AT_PARITY,
  NHS_APPROVAL_SWING,
  NHS_SALIENCE_AMP,
} from "./nhsQuality";

describe("nhsTargetQuality", () => {
  it("is 0 with no funding, parity value at ratio 1", () => {
    expect(nhsTargetQuality(0)).toBe(0);
    expect(nhsTargetQuality(1)).toBeCloseTo(NHS_TARGET_AT_PARITY, 5);
  });
  it("rises above parity toward the ceiling but never exceeds it", () => {
    expect(nhsTargetQuality(1.5)).toBeGreaterThan(NHS_TARGET_AT_PARITY);
    expect(nhsTargetQuality(100)).toBeLessThanOrEqual(100);
  });
  it("is monotonic in funding", () => {
    expect(nhsTargetQuality(0.5)).toBeLessThan(nhsTargetQuality(0.8));
    expect(nhsTargetQuality(0.8)).toBeLessThan(nhsTargetQuality(1.2));
  });
});

describe("tickNhsQuality (gradual)", () => {
  it("moves toward target but no more than the per-turn step", () => {
    const next = tickNhsQuality(0, 1.5); // target well above 0
    expect(next).toBe(NHS_QUALITY_MAX_STEP);
  });
  it("degrades gradually when funding collapses", () => {
    const next = tickNhsQuality(100, 0); // target 0
    expect(next).toBe(100 - NHS_QUALITY_MAX_STEP);
  });
  it("converges to target over many turns", () => {
    let q = 0;
    for (let i = 0; i < 50; i++) q = tickNhsQuality(q, 1);
    expect(q).toBeCloseTo(NHS_TARGET_AT_PARITY, 5);
  });
  it("stays within bounds", () => {
    expect(tickNhsQuality(2, 0)).toBe(0);
    expect(tickNhsQuality(98, 5)).toBeLessThanOrEqual(100);
  });
});

describe("nhsSalienceMultiplier", () => {
  it("baseline at full quality, amplified when failing", () => {
    expect(nhsSalienceMultiplier(100)).toBeCloseTo(1, 5);
    expect(nhsSalienceMultiplier(0)).toBeCloseTo(1 + NHS_SALIENCE_AMP, 5);
    expect(nhsSalienceMultiplier(0)).toBeGreaterThan(nhsSalienceMultiplier(50));
  });
});

describe("nhsApprovalModifier", () => {
  it("is signed around quality 50", () => {
    expect(nhsApprovalModifier(50)).toBe(0);
    expect(nhsApprovalModifier(100)).toBeCloseTo(NHS_APPROVAL_SWING, 5);
    expect(nhsApprovalModifier(0)).toBeCloseTo(-NHS_APPROVAL_SWING, 5);
  });
});
