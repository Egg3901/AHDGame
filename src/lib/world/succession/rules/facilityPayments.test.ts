import { describe, expect, it } from "vitest";
import { planFacilityPayments } from "./facilityPayments";

describe("successor facility compensation allocation", () => {
  it("shares scarce cash by unpaid liability and conserves rounding", () => {
    const claims = [
      { id: "a", amountMinor: 100, paidMinor: 50 },
      { id: "b", amountMinor: 100, paidMinor: 0 },
    ];
    const plan = planFacilityPayments(101, claims);
    expect(plan.paidMinor).toBe(101);
    expect(plan.treasuryAfterMinor).toBe(0);
    expect(plan.claims.map((claim) => claim.paymentMinor)).toEqual([34, 67]);
    expect(plan.claims.every((claim) => !claim.complete)).toBe(true);
    expect(claims[0].paidMinor).toBe(50);
  });
  it("completes claims without consuming surplus cash", () => {
    expect(planFacilityPayments(300, [{ id: "a", amountMinor: 100, paidMinor: 40 }])).toEqual({
      paidMinor: 60,
      treasuryAfterMinor: 240,
      claims: [{ id: "a", paymentMinor: 60, paidMinor: 100, complete: true }],
    });
  });
  it("carries arrears forward without deepening an overdraft", () => {
    expect(planFacilityPayments(-50, [{ id: "a", amountMinor: 100, paidMinor: 0 }])).toEqual({
      paidMinor: 0,
      treasuryAfterMinor: -50,
      claims: [{ id: "a", paymentMinor: 0, paidMinor: 0, complete: false }],
    });
  });
  it("completes zero liabilities and handles an empty inventory", () => {
    expect(
      planFacilityPayments(0, [{ id: "zero", amountMinor: 0, paidMinor: 0 }]).claims[0].complete
    ).toBe(true);
    expect(planFacilityPayments(0, []).claims).toEqual([]);
  });
  it("allocates safely when aggregate liabilities exceed safe integer precision", () => {
    const claims = ["a", "b"].map((id) => ({
      id,
      amountMinor: Number.MAX_SAFE_INTEGER,
      paidMinor: 0,
    }));
    const result = planFacilityPayments(Number.MAX_SAFE_INTEGER, claims);
    expect(result.claims.reduce((sum, row) => sum + BigInt(row.paymentMinor), BigInt(0))).toBe(
      BigInt(Number.MAX_SAFE_INTEGER)
    );
    expect(result.treasuryAfterMinor).toBe(0);
  });
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid amounts %s",
    (amountMinor) => {
      expect(() => planFacilityPayments(10, [{ id: "a", amountMinor, paidMinor: 0 }])).toThrow(
        "claim"
      );
    }
  );
  it("rejects duplicate claims and overpayment", () => {
    const claim = { id: "a", amountMinor: 10, paidMinor: 0 };
    expect(() => planFacilityPayments(10, [claim, claim])).toThrow("claim");
    expect(() => planFacilityPayments(10, [{ ...claim, paidMinor: 11 }])).toThrow("claim");
    expect(() => planFacilityPayments(NaN, [claim])).toThrow("treasury");
  });
});
