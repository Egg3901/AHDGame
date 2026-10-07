import { describe, expect, it } from "vitest";
import {
  POLICY_SHIFT_ACTION_COST,
  POLICY_SHIFT_INFAMY_COST,
  POLICY_SHIFT_INFLUENCE_MULTIPLIER,
  resolvePolicyShiftPayment,
} from "./rules";

describe("resolvePolicyShiftPayment", () => {
  it("returns the standard policy-shift costs", () => {
    expect(resolvePolicyShiftPayment(false)).toEqual({
      actionCost: POLICY_SHIFT_ACTION_COST,
      voucherCost: 0,
      infamyCost: POLICY_SHIFT_INFAMY_COST,
      influenceMultiplier: POLICY_SHIFT_INFLUENCE_MULTIPLIER,
    });
  });

  it("uses one voucher and waives every standard cost", () => {
    expect(resolvePolicyShiftPayment(true)).toEqual({
      actionCost: 0,
      voucherCost: 1,
      infamyCost: 0,
      influenceMultiplier: 1,
    });
  });
});
