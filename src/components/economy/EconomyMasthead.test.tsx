/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EconomyMasthead } from "./EconomyMasthead";
import { getEconomyIdentity } from "@/lib/constants/economyIdentity";

describe("EconomyMasthead", () => {
  it("renders registry, title, office, turn badge, verdict pill, and the strip", () => {
    render(
      <EconomyMasthead
        countryId="US"
        identity={getEconomyIdentity("US")}
        currentTurn={412}
        verdict="STEADY"
        reasoning="growth at trend (+1.9% vs ~2%) · price pressure elevated"
        strip={<div data-testid="pulse-strip">strip</div>}
      />
    );
    expect(screen.getByText("United States · National Accounts Registry")).toBeTruthy();
    expect(screen.getByText("Economic Outlook")).toBeTruthy();
    expect(screen.getByText("Bureau of National Accounts")).toBeTruthy();
    expect(screen.getByText(/Live · turn 412/)).toBeTruthy();
    // the verdict is a single badge-row pill at every breakpoint (no rotated seal)
    expect(screen.getAllByText("STEADY").length).toBe(1);
    expect(screen.queryByText("economic outlook")).toBeNull();
    expect(screen.getByText(/price pressure elevated/)).toBeTruthy();
    expect(screen.getByTestId("pulse-strip")).toBeTruthy();
    const budgetLink = screen.getByRole("link", { name: /National budget/ });
    expect(budgetLink.getAttribute("href")).toBe("/country/us/budget");
  });

  it("omits the verdict pill and reasoning bar when no verdict can be derived", () => {
    render(
      <EconomyMasthead
        countryId="US"
        identity={getEconomyIdentity("US")}
        currentTurn={1}
        verdict={null}
        reasoning={null}
        strip={<div />}
      />
    );
    expect(screen.queryByText(/^(EXPANDING|STEADY|COOLING|CONTRACTING|OVERHEATING)$/)).toBeNull();
    expect(screen.queryByText("Verdict")).toBeNull();
  });

  it("shows the CJK title with English parenthetical for CN", () => {
    render(
      <EconomyMasthead
        countryId="CN"
        identity={getEconomyIdentity("CN")}
        currentTurn={412}
        verdict="EXPANDING"
        reasoning="broad growth"
        strip={<div />}
      />
    );
    expect(screen.getByText("国民经济展望")).toBeTruthy();
    expect(screen.getByText(/\(Economic Outlook\)/)).toBeTruthy();
  });
});
