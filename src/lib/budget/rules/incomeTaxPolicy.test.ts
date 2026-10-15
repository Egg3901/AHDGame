import { describe, expect, it } from "vitest";
import {
  incomeTaxPolicyOptionId,
  incomeTaxEffectOptionId,
  readTaxPolicyRate,
  alignIncomeTaxPolicyRecords,
} from "./incomeTaxPolicy";

describe("income-tax policy parity", () => {
  it.each([
    undefined,
    null,
    "rate:",
    "rate: ",
    "rate:0x16",
    "rate:1e",
    "rate:-1",
    "rate:101",
    "rate:Infinity",
    "rate:22\n",
    "rate:22\r",
    "rate:22\u2028",
    "rate:22\u2029",
    "rate:22 ",
    " rate:22",
  ])("rejects malformed rate ids: %s", (id) => {
    expect(readTaxPolicyRate(id)).toBeUndefined();
  });
  it.each([0, 0.5, 22, 24, 100, 1e-7, Number.MIN_VALUE])(
    "decodes a decimal percentage: %s",
    (rate) => {
      expect(readTaxPolicyRate(`rate:${rate}`)).toBe(rate);
    }
  );
  it.each([undefined, null])("tolerates legacy missing option ids: %s", (policyOptionId) => {
    expect(
      incomeTaxEffectOptionId({ legislationTypeId: "unrelated", policyOptionId, options: [] })
    ).toBeUndefined();
  });
  it("uses the current budget target during standalone reseeding", () => {
    const records = [
      {
        scope: "national",
        stateId: "br_national",
        legislationTypeId: "br_income_tax_rate",
        policyOptionId: "rate:22",
      },
    ];
    const budgets = [
      { countryId: "BR", taxRates: { incomeTax: 26 }, taxRatePhaseIn: { incomeTax: 30 } },
    ];
    const types = [{ _id: "br_income_tax_rate", policyOptions: [] }];
    expect(alignIncomeTaxPolicyRecords(records, budgets, types)[0].policyOptionId).toBe("rate:30");
    expect(alignIncomeTaxPolicyRecords(records, [], types)).toEqual(records);
    expect(alignIncomeTaxPolicyRecords(records, budgets, [])).toEqual(records);
  });
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
