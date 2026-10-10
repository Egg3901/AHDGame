import { describe, expect, it } from "vitest";
import { applyModifiers, type ActiveModifier } from "@/lib/utils/approvalModifiers";
import {
  buildApprovalBreakdown,
  displayEffect,
  NATIONAL_CAP_ADJUSTMENT_ID,
} from "./approvalBreakdown";

const mod = (id: string, effect: number): ActiveModifier => ({ id, label: id, effect });

describe("buildApprovalBreakdown", () => {
  it("reconciles state average plus adjustments to the stored rating", () => {
    const national = [mod("public_expectations", -5), mod("cabinet_none", -7.5)];
    const rating = applyModifiers(53.7, national);
    expect(rating).toBe(41.2);
    const b = buildApprovalBreakdown(rating, national);
    expect(b.stateAverage).toBe(53.7);
    expect(b.nationalNet).toBe(-12.5);
    expect(b.nationalAdjustments.map((m) => m.effect)).toEqual([-5, -7.5]);
  });

  it("adds a cap line when positives exceed the cap", () => {
    const national = [mod("a", 6), mod("b", 6), mod("c", -2)];
    const rating = applyModifiers(50, national);
    const b = buildApprovalBreakdown(rating, national);
    expect(b.stateAverage).toBe(50);
    const sum = b.nationalAdjustments.reduce((s, m) => s + m.effect, 0);
    expect(Math.round((b.stateAverage + sum) * 10) / 10).toBe(rating);
    expect(b.nationalAdjustments.some((m) => m.id === NATIONAL_CAP_ADJUSTMENT_ID)).toBe(true);
  });

  it("drops adjustments that round to zero", () => {
    const b = buildApprovalBreakdown(50, [mod("bank_failure_backstop", -0.0000499)]);
    expect(b.nationalAdjustments).toEqual([]);
    expect(b.stateAverage).toBe(50);
  });

  it("handles no national modifiers", () => {
    expect(buildApprovalBreakdown(48.3, [])).toEqual({
      stateAverage: 48.3,
      nationalAdjustments: [],
      nationalNet: 0,
    });
  });
});

describe("displayEffect", () => {
  it("rounds tiny values away and keeps real ones", () => {
    expect(displayEffect(-0.0000499)).toBeNull();
    expect(displayEffect(-0.04)).toBeNull();
    expect(displayEffect(-0.26)).toBe(-0.3);
    expect(displayEffect(0)).toBe(0);
    expect(displayEffect(-7.5)).toBe(-7.5);
    expect(displayEffect(NaN)).toBeNull();
  });
});
