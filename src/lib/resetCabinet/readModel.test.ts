import { describe, expect, it } from "vitest";
import { DEPARTMENT_DEFINITIONS } from "@/lib/governmentFinance/departmentCatalog";
import type { ResetDepartmentAccountSnapshot } from "@/lib/resetFinance/rules/liveDepartmentAccount";
import { buildResetDepartmentFinanceReadModel } from "./readModel";

const definition = DEPARTMENT_DEFINITIONS.find((entry) => entry.id === "us_health_department")!;
const account = {
  departmentId: definition.id,
  annualAuthority: 300,
  balance: 20,
  encumbered: 5,
  arrears: 0,
  unpaidAuthority: 35,
  lastAuthorityPaid: 10,
  externallySettled: false,
  familyAnnualDemand: { L18: 100, L19: 200 },
  programAllocationPercents: { L18: 50, L19: 150 },
  lastProgramDelivery: { L18: { requested: 2, outlaid: 1, implementationFactor: 0.5 } },
  accruedThroughTurn: 12,
  lastAllocationChangedTurn: 12,
} as unknown as ResetDepartmentAccountSnapshot;

describe("v2 Cabinet finance read model", () => {
  it("shows reconciled authority and independent family requests", () => {
    const model = buildResetDepartmentFinanceReadModel({
      definition,
      departmentName: "Health and Human Services",
      account,
    });
    expect(model).toMatchObject({
      allocationMode: "demand",
      annualAuthority: 300,
      availableBalance: 15,
      lastAllocationChangedTurn: 12,
      unpaidAuthority: 35,
      lastAuthorityPaid: 10,
    });
    expect(model.programs.map((program) => program.allocationPercent)).toEqual([50, 150]);
    expect(model.programs[0]).toMatchObject({ outlaid: 1, lastSettledTurn: 12 });
    expect(model.programs[1]?.outlaid).toBeUndefined();
    expect(
      model.programs.every((program) => program.explanation.includes("does not change enacted law"))
    ).toBe(true);
  });

  it("does not offer ordinary requests for a specialized account", () => {
    const model = buildResetDepartmentFinanceReadModel({
      definition,
      departmentName: "Health and Human Services",
      account: { ...account, externallySettled: true },
    });
    expect(model.programs).toEqual([]);
    expect(model.unpaidAuthority).toBeUndefined();
  });
});
