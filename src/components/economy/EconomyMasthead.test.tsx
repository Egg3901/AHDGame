/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EconomyMasthead } from "./EconomyMasthead";
import { getEconomyIdentity } from "@/lib/constants/economyIdentity";

describe("EconomyMasthead", () => {
  it("renders registry, title, office, turn badge, verdict seal, and the strip", () => {
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
    expect(screen.getByText(/Live · Turn 412/)).toBeTruthy();
    // verdict appears twice: the rotated seal (sm+) and the mobile badge pill
    expect(screen.getAllByText("STEADY").length).toBe(2);
    // seal caption (distinct from the "Economic Outlook" title by case)
    expect(screen.getByText("economic outlook")).toBeTruthy();
    expect(screen.getByText(/price pressure elevated/)).toBeTruthy();
    expect(screen.getByTestId("pulse-strip")).toBeTruthy();
    const budgetLink = screen.getByRole("link", { name: /National Budget/ });
    expect(budgetLink.getAttribute("href")).toBe("/country/us/budget");
  });

  it("omits the verdict seal and reasoning bar when no verdict can be derived", () => {
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
    expect(screen.queryByText("economic outlook")).toBeNull();
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
