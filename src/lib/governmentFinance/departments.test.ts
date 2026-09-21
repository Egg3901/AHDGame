import { describe, expect, it } from "vitest";
import { createEmptyUsHealthDepartmentAccount, resolveUsHealthDepartmentName } from "./departments";

describe("US health department", () => {
  it("keeps stable identity across era display names", () => {
    expect(resolveUsHealthDepartmentName(1979)).toBe(
      "U.S. Department of Health, Education, and Welfare"
    );
    expect(resolveUsHealthDepartmentName(1980)).toBe(
      "U.S. Department of Health and Human Services"
    );
    expect(createEmptyUsHealthDepartmentAccount().departmentId).toBe("us_health_department");
  });

  it("initializes money to zero rather than manufacturing an allowance", () => {
    expect(createEmptyUsHealthDepartmentAccount()).toMatchObject({
      balance: 0,
      encumbered: 0,
      accruedThroughTurn: 0,
      programs: {},
    });
  });
});
