import { describe, expect, it } from "vitest";
import type { ResetDepartmentAccountSnapshot } from "@/lib/resetFinance/rules/liveDepartmentAccount";
import { validateResetDepartmentAllocations } from "./allocation";

const account = {
  externallySettled: false,
  familyAnnualDemand: { L18: 100, L19: 200 },
} as unknown as ResetDepartmentAccountSnapshot;

describe("reset Cabinet allocation requests", () => {
  it("accepts complete independent 0-200 percent family requests", () => {
    expect(validateResetDepartmentAllocations(account, { L19: 200, L18: 0 })).toEqual({
      ok: true,
      allocations: { L18: 0, L19: 200 },
    });
  });

  it("rejects partial, invented, fractional, and out-of-range requests", () => {
    const invalid: Record<string, number>[] = [
      { L18: 100 },
      { L18: 100, L19: 100, L20: 1 },
      { L18: 12.5, L19: 100 },
      { L18: -1, L19: 100 },
      { L18: 201, L19: 100 },
    ];
    for (const allocations of invalid) {
      expect(validateResetDepartmentAllocations(account, allocations).ok).toBe(false);
    }
  });

  it("keeps defense and intelligence on their established controls", () => {
    expect(
      validateResetDepartmentAllocations(
        { ...account, externallySettled: true },
        { L18: 50, L19: 50 }
      )
    ).toMatchObject({ ok: false });
  });
});
