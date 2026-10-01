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
          unpaidAuthority: 35,
          lastAuthorityPaid: 15,
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
    expect(screen.getByText("Unpaid treasury authority").parentElement?.textContent).toContain(
      "£35"
    );
    expect(screen.getByText("Last treasury payment").parentElement?.textContent).toContain("£15");
    expect(screen.getByText("Unpaid treasury authority").getAttribute("title")).toContain(
      "cannot be spent"
    );
  });

  it("shows independent v2 requests without forcing them to total 100 percent", () => {
    render(
      <DepartmentFinancePanel
        currencySymbol="$"
        department={{
          enabled: true,
          allocationMode: "demand",
          departmentId: "us_health_department",
          departmentName: "Health and Human Services",
          kind: "spending_department",
          explanation: "Paid funds limit delivery.",
          programs: [
            {
              enabled: true,
              departmentName: "Health and Human Services",
              programId: "L18",
              programName: "Treatment waits",
              explanation: "Existing service",
              status: "operating",
              allocationPercent: 50,
            },
            {
              enabled: true,
              departmentName: "Health and Human Services",
              programId: "L19",
              programName: "Prevention",
              explanation: "Existing service",
              status: "operating",
              allocationPercent: 150,
            },
          ],
        }}
      />
    );
    expect(screen.getByText("Independent requests")).toBeTruthy();
    expect(screen.getByDisplayValue("50").getAttribute("max")).toBe("200");
    expect(screen.getByDisplayValue("150").getAttribute("step")).toBe("1");
  });
});
