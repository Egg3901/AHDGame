/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FiscalMechanicsNote } from "./FiscalMechanicsNote";

describe("FiscalMechanicsNote", () => {
  it("explains the two debt ratios and the working fiscal controls", () => {
    render(
      <FiscalMechanicsNote
        sym="£"
        debtPrincipal={150}
        rawGdp={100}
        smoothedGdp={120}
        revenue={90}
        spending={105}
        debtInterest={20}
      />
    );

    expect(screen.getByText("Raw debt-to-GDP")).toBeTruthy();
    expect(screen.getByText("Solvency debt-to-GDP (smoothed)")).toBeTruthy();
    expect(screen.getByText("150.0%")).toBeTruthy();
    expect(screen.getByText("125.0%")).toBeTruthy();
    expect(screen.getByText("Primary balance")).toBeTruthy();
    expect(screen.getByText("Debt interest")).toBeTruthy();
    expect(screen.getByText(/Tax and spending settings change through enacted laws/)).toBeTruthy();
    expect(screen.getByText(/at most 1 percentage point per turn/)).toBeTruthy();
  });
});
