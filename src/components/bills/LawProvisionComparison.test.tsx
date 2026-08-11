/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BillFiscalImpactStrip, LawProvisionComparison } from "./LawProvisionComparison";

// RU infrastructure primary: level 1 enacted, proposing level 3.
const LT = {
  estimates: [
    { level: 0, cost: 0, revenue: 0, net: 0 },
    { level: 1, cost: 2_000_000_000, revenue: 0, net: -2_000_000_000 },
    { level: 2, cost: 5_000_000_000, revenue: 0, net: -5_000_000_000 },
    { level: 3, cost: 9_000_000_000, revenue: 0, net: -9_000_000_000 },
    { level: 4, cost: 14_000_000_000, revenue: 0, net: -14_000_000_000 },
  ],
  estimatesGdp: 1_400_000_000_000,
  politicalMetricTargets: [
    { metricId: "infrastructure.transit", weight: 1 },
    { metricId: "economy.productivity", weight: 0.4 },
  ],
  policyOptions: [
    { id: "l0", name: "No Programme" },
    { id: "l1", name: "Network Maintenance" },
    { id: "l2", name: "Reconstruction Programme" },
    { id: "l3", name: "Expansion and Electrification" },
    { id: "l4", name: "Total Network Buildout" },
  ],
};

describe("LawProvisionComparison", () => {
  it("shows current law (name + est cost), proposed cost, delta with %GDP, and metric directions", () => {
    render(<LawProvisionComparison countryId="RU" lt={LT} currentIndex={1} proposedIndex={3} />);
    expect(screen.getByText("Current law")).toBeTruthy();
    expect(screen.getByText("Network Maintenance")).toBeTruthy();
    expect(screen.getByText("руб2.00B")).toBeTruthy();
    expect(screen.getByText("Proposed")).toBeTruthy();
    expect(screen.getByText("Expansion and Electrification")).toBeTruthy();
    expect(screen.getByText(/руб9\.00B/)).toBeTruthy();
    // Costs 7B more: +руб7.00B with the %GDP delta on its own line.
    expect(document.body.textContent).toContain("+руб7.00B");
    expect(screen.getByText("+0.5% GDP")).toBeTruthy();
    // Raising the level raises every target metric; primary = double arrow.
    expect(screen.getByText(/Rail Network and Urban Transit/)).toBeTruthy();
    const primary = screen.getByText(/Rail Network and Urban Transit/);
    expect(primary.textContent).toContain("▲▲");
    const secondary = screen.getByText(/Industrial Output and Capital Formation/);
    expect(secondary.textContent).toContain("▲");
    expect(secondary.textContent).not.toContain("▲▲");
  });

  it("lowering the level flips metric directions and reads as savings", () => {
    render(<LawProvisionComparison countryId="RU" lt={LT} currentIndex={3} proposedIndex={1} />);
    expect(document.body.textContent).toContain("saves руб7.00B");
    expect(screen.getByText(/Rail Network and Urban Transit/).textContent).toContain("▼▼");
  });

  it("renders nothing without estimates or a known current level", () => {
    const { container } = render(
      <LawProvisionComparison countryId="RU" lt={{}} currentIndex={1} proposedIndex={2} />
    );
    expect(container.innerHTML).toBe("");
    const { container: c2 } = render(
      <LawProvisionComparison countryId="RU" lt={LT} currentIndex={undefined} proposedIndex={2} />
    );
    expect(c2.innerHTML).toBe("");
  });
});

describe("BillFiscalImpactStrip", () => {
  it("rolls up current vs enacted annual cost with the net change", () => {
    render(
      <BillFiscalImpactStrip
        countryId="RU"
        rows={[{ lt: LT, currentIndex: 1, proposedIndex: 3 }]}
      />
    );
    expect(screen.getByText("Current laws")).toBeTruthy();
    expect(screen.getByText("руб2.00B/yr")).toBeTruthy();
    expect(screen.getByText("руб9.00B/yr")).toBeTruthy();
    expect(screen.getByText(/\+руб7\.00B\/yr/)).toBeTruthy();
  });

  it("renders nothing when no priced provisions are selected", () => {
    const { container } = render(
      <BillFiscalImpactStrip
        countryId="RU"
        rows={[{ lt: LT, currentIndex: 1, proposedIndex: -1 }]}
      />
    );
    expect(container.innerHTML).toBe("");
  });
});
