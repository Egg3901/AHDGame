import { describe, expect, it } from "vitest";
import type { ResetDepartmentAccountSnapshot } from "@/lib/resetFinance/rules/liveDepartmentAccount";
import { validateResetDepartmentAllocations } from "./allocation";

const account = {
  _id: "US:us_health_department",
  countryId: "US",
  externallySettled: false,
  familyAnnualDemand: { L18: 100, L19: 200 },
} as unknown as ResetDepartmentAccountSnapshot;

const treasuryAccount = {
  ...account,
  _id: "US:us_treasury_department",
  departmentId: "us_treasury_department",
  familyAnnualDemand: { L01: 0, L08: 100, L50: 0 },
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

  it("does not require a request for a family moved to regional control", () => {
    expect(
      validateResetDepartmentAllocations(
        { ...account, familyAnnualDemand: { L18: 0, L19: 200 } },
        { L19: 125 },
        [
          {
            country: "US",
            scope: "national",
            familyId: "L18",
            choice: "leave_to_states",
            fundingAccountId: "US:us_health_department",
          },
        ]
      )
    ).toEqual({ ok: true, allocations: { L19: 125 } });
  });

  it("enforces required and no-separate-allocation opening laws at 100%", () => {
    expect(
      validateResetDepartmentAllocations(treasuryAccount, { L01: 100, L08: 100, L50: 100 })
    ).toEqual({
      ok: true,
      allocations: { L01: 100, L08: 100, L50: 100 },
    });
    expect(
      validateResetDepartmentAllocations(treasuryAccount, { L01: 100, L08: 99, L50: 100 })
    ).toMatchObject({
      ok: false,
      reason: "Budget and debt framework is required by law and must remain at 100%",
    });
    expect(
      validateResetDepartmentAllocations(treasuryAccount, { L01: 0, L08: 100, L50: 100 })
    ).toMatchObject({
      ok: false,
      reason: "Household relief and work credits has no discretionary Cabinet allocation",
    });
  });

  it("applies the enacted option classification to mixed families", () => {
    const food = {
      ...account,
      _id: "US:us_agriculture_department",
      familyAnnualDemand: { L37: 100 },
    } as unknown as ResetDepartmentAccountSnapshot;
    const current = {
      country: "US" as const,
      scope: "national" as const,
      familyId: "L37",
      choice: "center" as const,
      fundingAccountId: food._id,
    };
    expect(validateResetDepartmentAllocations(food, { L37: 90 }, [current])).toMatchObject({
      ok: false,
      reason: "Food access and agricultural resilience is required by law and must remain at 100%",
    });
  });
});
