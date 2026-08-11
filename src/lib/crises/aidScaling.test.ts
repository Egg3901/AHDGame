import { describe, it, expect } from "vitest";
import { computeAidOutcome } from "./aidScaling";
import { AID_MAX_PCT_GDP, AID_SENDER_APPROVAL_CAP } from "@/lib/constants/crises";

describe("computeAidOutcome", () => {
  it("costs pct * GDP in local units", () => {
    expect(computeAidOutcome(0.01, 1_000_000).amountLocal).toBe(10_000);
  });

  it("returns no effects and zero cost at 0%", () => {
    const o = computeAidOutcome(0, 1_000_000);
    expect(o.amountLocal).toBe(0);
    expect(o.recoveryEffects).toEqual([]);
    expect(o.senderEffects).toEqual([]);
  });

  it("caps the sender approval bump at the cap when pledging the max", () => {
    const o = computeAidOutcome(AID_MAX_PCT_GDP, 1_000_000);
    const approval = o.senderEffects.find((e) => e.targetType === "approval");
    expect(approval?.value).toBeCloseTo(AID_SENDER_APPROVAL_CAP);
  });

  it("scales the sender bump linearly at half the cap", () => {
    const o = computeAidOutcome(AID_MAX_PCT_GDP / 2, 1_000_000);
    const approval = o.senderEffects.find((e) => e.targetType === "approval");
    expect(approval?.value).toBeCloseTo(AID_SENDER_APPROVAL_CAP / 2);
  });

  it("recovery effects repair damage (negative-signed) and grow in magnitude with the pledge", () => {
    const small = computeAidOutcome(AID_MAX_PCT_GDP / 4, 1_000_000).recoveryEffects[0].value;
    const big = computeAidOutcome(AID_MAX_PCT_GDP, 1_000_000).recoveryEffects[0].value;
    expect(big).toBeLessThan(0); // repair reduces infrastructure.damage
    expect(Math.abs(big)).toBeGreaterThan(Math.abs(small));
  });

  it("clamps a pledge above the cap to the cap", () => {
    const o = computeAidOutcome(AID_MAX_PCT_GDP * 2, 1_000_000);
    expect(o.amountLocal).toBe(Math.round(AID_MAX_PCT_GDP * 1_000_000));
  });
});
