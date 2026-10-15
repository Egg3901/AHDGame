import { describe, expect, it } from "vitest";
import { incomeTaxPolicyOptionId } from "./incomeTaxPolicy";

describe("income-tax policy parity", () => {
  const input = {
    currentOptionId: "standard",
    options: [{ id: "standard", rate: 18 }],
    effectiveRate: 22,
  };
  it("represents a calibrated rate between legacy options exactly", () => {
    expect(incomeTaxPolicyOptionId(input)).toBe("rate:22");
  });
  it("preserves matching options and is idempotent for exact-rate records", () => {
    expect(incomeTaxPolicyOptionId({ ...input, effectiveRate: 18 })).toBe("standard");
    expect(incomeTaxPolicyOptionId({ ...input, currentOptionId: "rate:22" })).toBe("rate:22");
  });
  it("records the enacted target while the budget phases toward it", () => {
    expect(incomeTaxPolicyOptionId({ ...input, pendingRate: 24 })).toBe("rate:24");
    expect(incomeTaxPolicyOptionId({ ...input, pendingRate: 0 })).toBe("rate:0");
  });
  it.each([undefined, NaN, Infinity, -1, 101])(
    "refuses invalid fiscal rates: %s",
    (effectiveRate) => {
      expect(incomeTaxPolicyOptionId({ ...input, effectiveRate })).toBeUndefined();
    }
  );
});
