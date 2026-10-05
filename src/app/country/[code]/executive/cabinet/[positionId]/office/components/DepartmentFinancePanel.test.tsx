/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    expect(screen.getByText("Last appropriation credit").parentElement?.textContent).toContain(
      "£15"
    );
    expect(screen.queryByText("Unpaid treasury authority")).toBeNull();
    expect(screen.getByText(/Enacted appropriations are credited in full/)).toBeTruthy();
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
    expect(screen.getByLabelText("Treatment waits allocation slider").getAttribute("max")).toBe(
      "200"
    );
    expect(screen.getByLabelText("Prevention allocation percent").getAttribute("step")).toBe("1");
    expect(screen.getByText("What funding levels mean")).toBeTruthy();
    expect(screen.getByText("Below 100%")).toBeTruthy();
    expect(screen.getByText("At 100%")).toBeTruthy();
    expect(screen.getByText("Above 100%")).toBeTruthy();
    expect(screen.getByText(/do not change the law's appropriation/i)).toBeTruthy();
  });

  it("keeps the allocation slider and number field synchronized", () => {
    render(
      <DepartmentFinancePanel
        currencySymbol="$"
        canAct
        currentTurn={1}
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
              annualDemand: 4_800,
              allocationPercent: 50,
            },
          ],
        }}
      />
    );

    const slider = screen.getByLabelText("Treatment waits allocation slider") as HTMLInputElement;
    const number = screen.getByLabelText("Treatment waits allocation percent") as HTMLInputElement;
    expect(slider.value).toBe("50");
    expect(number.value).toBe("50");
    expect(screen.getByText("Funding request per turn: $50")).toBeTruthy();

    fireEvent.change(slider, { target: { value: "135" } });
    expect(number.value).toBe("135");
    expect(screen.getByText("Funding request per turn: $135")).toBeTruthy();

    fireEvent.change(number, { target: { value: "80" } });
    expect(slider.value).toBe("80");
    expect(screen.getByText("Funding request per turn: $80")).toBeTruthy();
  });

  it("updates total requested funding and remaining allocation with the draft", () => {
    render(
      <DepartmentFinancePanel
        currencySymbol="$"
        canAct
        currentTurn={1}
        department={{
          enabled: true,
          allocationMode: "demand",
          departmentId: "us_health_department",
          departmentName: "Health and Human Services",
          kind: "spending_department",
          explanation: "Paid funds limit delivery.",
          annualAuthority: 4_800,
          balance: 100,
          availableBalance: 80,
          encumbered: 20,
          arrears: 10,
          programs: [
            {
              enabled: true,
              departmentName: "Health and Human Services",
              programId: "L18",
              programName: "Treatment waits",
              explanation: "Existing service",
              status: "operating",
              annualDemand: 4_800,
              allocationPercent: 50,
            },
            {
              enabled: true,
              departmentName: "Health and Human Services",
              programId: "L19",
              programName: "Prevention",
              explanation: "Existing service",
              status: "operating",
              annualDemand: 4_800,
              allocationPercent: 150,
            },
          ],
        }}
      />
    );

    expect(screen.getByText("Total funding requested").parentElement?.textContent).toContain(
      "$200"
    );
    const remaining = screen.getByText("Department funding remaining").parentElement!;
    expect(remaining.textContent).toContain("-$30");
    expect(remaining.querySelector("dd")?.className).toContain("text-error");

    fireEvent.change(screen.getByLabelText("Prevention allocation percent"), {
      target: { value: "100" },
    });
    expect(screen.getByText("Total funding requested").parentElement?.textContent).toContain(
      "$150"
    );
    expect(remaining.textContent).toContain("$20");
    expect(remaining.querySelector("dd")?.className).toContain("text-success");
  });

  it("locks legal obligations and removes meaningless zero-cost controls", () => {
    render(
      <DepartmentFinancePanel
        currencySymbol="$"
        canAct
        department={{
          enabled: true,
          allocationMode: "demand",
          departmentId: "us_treasury_department",
          departmentName: "Treasury",
          kind: "finance_ministry",
          explanation: "Paid funds limit delivery.",
          programs: [
            {
              enabled: true,
              departmentName: "Treasury",
              programId: "L08",
              programName: "Budget and debt framework",
              explanation: "Required obligation",
              status: "operating",
              annualDemand: 4_800,
              allocationPercent: 100,
              fundingControl: "required",
            },
            {
              enabled: true,
              departmentName: "Treasury",
              programId: "L01",
              programName: "Household relief and work credits",
              explanation: "Regulatory baseline",
              status: "operating",
              annualDemand: 0,
              allocationPercent: 100,
              fundingControl: "no_separate_allocation",
            },
          ],
        }}
      />
    );

    expect(screen.getByText("Required by law")).toBeTruthy();
    expect(
      (screen.getByLabelText("Budget and debt framework allocation slider") as HTMLInputElement)
        .disabled
    ).toBe(true);
    expect(
      (screen.getByLabelText("Budget and debt framework allocation percent") as HTMLInputElement)
        .value
    ).toBe("100");
    expect(screen.getByText("No separate allocation")).toBeTruthy();
    expect(screen.getByText("No separate per-turn funding request")).toBeTruthy();
    expect(screen.getByText(/no discretionary Cabinet funding control/i)).toBeTruthy();
    expect(
      screen.queryByLabelText("Household relief and work credits allocation slider")
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Save allocation" })).toBeNull();
  });

  it("tabs the allocation overview and each active program", () => {
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
              annualDemand: 100,
            },
            {
              enabled: true,
              departmentName: "Health and Human Services",
              programId: "L19",
              programName: "Prevention and public health",
              explanation: "Existing service",
              status: "authorized",
              annualDemand: 200,
            },
            {
              enabled: true,
              departmentName: "Health and Human Services",
              programId: "L20",
              programName: "Repealed service",
              explanation: "Winding down",
              status: "winding_down",
              annualDemand: 0,
            },
          ],
        }}
      />
    );

    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe(
      "true"
    );
    expect(screen.getByText("Program allocation")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Repealed service" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Treatment waits" }));
    expect(screen.getByRole("tabpanel", { name: "Treatment waits" })).toBeTruthy();
    expect(screen.getByText("Annual demand").parentElement?.textContent).toContain("$100");
    expect(screen.queryByText("Program allocation")).toBeNull();
  });

  it("offers scroll controls when the program tabs overflow", () => {
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
          programs: Array.from({ length: 6 }, (_, index) => ({
            enabled: true,
            departmentName: "Health and Human Services",
            programId: `L${index + 1}`,
            programName: `Program ${index + 1}`,
            explanation: "Existing service",
            status: "operating" as const,
            annualDemand: 100,
          })),
        }}
      />
    );

    const tabList = screen.getByRole("tablist", {
      name: "Health and Human Services programs",
    });
    Object.defineProperties(tabList, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, value: 900 },
    });
    const scrollBy = vi.fn();
    Object.defineProperty(tabList, "scrollBy", { configurable: true, value: scrollBy });
    fireEvent(window, new Event("resize"));

    const rightButton = screen.getByRole("button", { name: "Scroll program tabs right" });
    expect(rightButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(rightButton);
    expect(scrollBy).toHaveBeenCalledWith({ left: 192, behavior: "smooth" });

    Object.defineProperty(tabList, "scrollLeft", { configurable: true, value: 580 });
    fireEvent.scroll(tabList);
    expect(
      screen.getByRole("button", { name: "Scroll program tabs left" }).hasAttribute("disabled")
    ).toBe(false);
    expect(
      screen.getByRole("button", { name: "Scroll program tabs right" }).hasAttribute("disabled")
    ).toBe(true);
  });

  it("falls back to Overview when the selected law program disappears", () => {
    const department = {
      enabled: true,
      allocationMode: "demand" as const,
      departmentId: "us_health_department",
      departmentName: "Health and Human Services",
      kind: "spending_department" as const,
      explanation: "Paid funds limit delivery.",
      programs: [
        {
          enabled: true,
          departmentName: "Health and Human Services",
          programId: "L18",
          programName: "Treatment waits",
          explanation: "Existing service",
          status: "operating" as const,
          annualDemand: 100,
        },
        {
          enabled: true,
          departmentName: "Health and Human Services",
          programId: "L19",
          programName: "Prevention",
          explanation: "Existing service",
          status: "operating" as const,
          annualDemand: 200,
        },
      ],
    };
    const view = render(<DepartmentFinancePanel currencySymbol="$" department={department} />);
    fireEvent.click(screen.getByRole("tab", { name: "Treatment waits" }));

    view.rerender(
      <DepartmentFinancePanel
        currencySymbol="$"
        department={{
          ...department,
          programs: department.programs.map((program) =>
            program.programId === "L18"
              ? { ...program, status: "winding_down" as const, annualDemand: 0 }
              : program
          ),
        }}
      />
    );

    expect(screen.queryByRole("tab", { name: "Treatment waits" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe(
      "true"
    );
    expect(screen.getByText("Program allocation")).toBeTruthy();
  });
});
