/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DepartmentFinancePanel } from "./DepartmentFinancePanel";

afterEach(cleanup);

describe("DepartmentFinancePanel", () => {
  it("shows institutional money separately from program delivery", () => {
    render(
      <DepartmentFinancePanel
        currencySymbol="£"
        department={{
          enabled: true,
          departmentId: "uk_health_department",
          departmentName: "Department of Health and Social Care",
          kind: "spending_department",
          accountPolicyId: "civil_operating",
          explanation: "Public money remains with the institution.",
          balance: 150,
          availableBalance: 100,
          encumbered: 40,
          arrears: 10,
          programs: [],
        }}
      />
    );
    expect(
      screen.getByRole("heading", { name: "Department of Health and Social Care" })
    ).toBeTruthy();
    expect(screen.getByText("Account balance").parentElement?.textContent).toContain("£150");
    expect(screen.getByText("Encumbered").parentElement?.textContent).toContain("£40");
    expect(screen.getByText("Arrears").parentElement?.textContent).toContain("£10");
  });
});
