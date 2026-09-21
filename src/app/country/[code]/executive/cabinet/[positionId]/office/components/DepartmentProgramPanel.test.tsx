/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DepartmentProgramPanel } from "./DepartmentProgramPanel";

afterEach(cleanup);

describe("DepartmentProgramPanel", () => {
  it("labels each delivery factor and communicates the constraint with text", () => {
    render(
      <DepartmentProgramPanel
        currencySymbol="$"
        program={{
          enabled: true,
          departmentName: "U.S. Department of Health and Human Services",
          programName: "Public Health Workforce Expansion",
          explanation: "Authorization permits the program.",
          status: "operating",
          annualDemand: 9_300,
          authorityThisTurn: 7_000,
          availableBalance: 500,
          encumbered: 1_500,
          outlaid: 5_000,
          arrears: 0,
          ratios: { funding: 0.75, capacity: 0.8, coverage: 1, ramp: 0.5, implementation: 0.3 },
          bindingConstraint: "ramp",
          outcome: {
            label: "Public Health Preparedness",
            deliveredShare: 0.3,
            reason: "current_settlement",
          },
        }}
      />
    );

    expect(screen.getByRole("heading", { name: "Public Health Workforce Expansion" })).toBeTruthy();
    expect(screen.getByLabelText("Funding ratio")).toBeTruthy();
    expect(screen.getByLabelText("Capacity ratio")).toBeTruthy();
    expect(screen.getByText(/Binding constraint:/).textContent).toContain("ramp");
    expect(screen.getByText(/Public Health Preparedness/).textContent).toContain("30%");
  });
});
