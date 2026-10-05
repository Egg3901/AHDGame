import { describe, expect, it } from "vitest";
import { DEPARTMENT_ACCOUNT_POLICIES, getDepartmentAccountPolicy } from "./accountPolicies";

describe("department account policies", () => {
  it("keeps defense overdraft behavior distinct from intelligence stop-when-empty behavior", () => {
    expect(getDepartmentAccountPolicy("defense")).toMatchObject({
      canOverdraft: true,
      usesEncumbrance: true,
      arrearsMode: "sovereign_overdraft",
    });
    expect(getDepartmentAccountPolicy("intelligence")).toMatchObject({
      canOverdraft: false,
      usesEncumbrance: false,
      arrearsMode: "none",
    });
  });

  it("gives every registry key the same durable id", () => {
    for (const [id, policy] of Object.entries(DEPARTMENT_ACCOUNT_POLICIES)) {
      expect(policy.id).toBe(id);
    }
  });
});
