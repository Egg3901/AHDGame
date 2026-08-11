import { describe, it, expect } from "vitest";
import { proposeBillSchema, stateBillProvisionSchema } from "./congress";

const base = { title: "T", summary: "S", chamber: "house" as const };

describe("proposeBillSchema — custom category", () => {
  it("accepts a custom bill with no provisions", () => {
    const r = proposeBillSchema.safeParse({ ...base, category: "custom", provisions: [] });
    expect(r.success).toBe(true);
  });

  it("rejects a non-custom bill with no provisions", () => {
    const r = proposeBillSchema.safeParse({ ...base, category: "economy", provisions: [] });
    expect(r.success).toBe(false);
  });

  it("still rejects more than MAX_PROVISIONS for a custom bill", () => {
    const policy = { legislationTypeId: "x", effectDirection: 0 };
    const r = proposeBillSchema.safeParse({
      ...base,
      category: "custom",
      provisions: [policy, policy, policy, policy],
    });
    expect(r.success).toBe(false);
  });
});

describe("stateBillProvisionSchema — strict governor-queue provisions (audit S6)", () => {
  it("accepts a policy provision", () => {
    const r = stateBillProvisionSchema.safeParse({
      legislationTypeId: "min_wage",
      effectDirection: 1,
      policyOptionId: "opt-2",
    });
    expect(r.success).toBe(true);
  });

  it("accepts subsidy and end_subsidy provisions", () => {
    expect(
      stateBillProvisionSchema.safeParse({
        type: "subsidy",
        scopeType: "economy_wide",
        domesticOnly: true,
      }).success
    ).toBe(true);
    expect(
      stateBillProvisionSchema.safeParse({ type: "end_subsidy", scopeType: "economy_wide" }).success
    ).toBe(true);
  });

  it("rejects national-only provision types (tariff, nationalize)", () => {
    expect(
      stateBillProvisionSchema.safeParse({
        type: "tariff",
        scopeType: "economy_wide",
        rate: 25,
      }).success
    ).toBe(false);
    expect(
      stateBillProvisionSchema.safeParse({
        type: "nationalize",
        targetCorporationId: "a".repeat(24),
      }).success
    ).toBe(false);
  });

  it("rejects unknown/garbage provisions and policy provisions missing required fields", () => {
    expect(
      stateBillProvisionSchema.safeParse({ type: "treasury_drain", amount: 1e12 }).success
    ).toBe(false);
    expect(stateBillProvisionSchema.safeParse({ legislationTypeId: "" }).success).toBe(false);
    expect(stateBillProvisionSchema.safeParse({ effectDirection: 1 }).success).toBe(false);
  });
});
