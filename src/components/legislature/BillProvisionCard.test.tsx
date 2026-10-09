/** @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BillProvisionCard } from "./BillProvisionCard";
import type { BillProvisionView } from "@/lib/legislature/dto/provisionView";

vi.mock("@/components/PositionBadges", () => ({ PositionBadges: () => null }));
vi.mock("@/components/legislation/PolicyEffectIndicators", () => ({
  PolicyEffectIndicators: () => null,
}));
vi.mock("@/components/legislature/dispatch", () => ({
  CurrentToProposed: () => <div>Current to proposed</div>,
}));
vi.mock("@/app/congress/bills/[id]/components/NationalizationProvisionDetailCard", () => ({
  NationalizationProvisionDetailCard: () => null,
}));

afterEach(cleanup);

describe("BillProvisionCard impacts", () => {
  const baseView: BillProvisionView = {
    legislationTypeName: "Provision",
    current: { title: "Current law" },
    proposed: { title: "Proposed law" },
    effectDirection: 0,
  };

  it.each([undefined, { currencyCode: "USD" }])(
    "keeps both impact labels when fiscal information is missing or incomplete",
    (fiscal) => {
      render(<BillProvisionCard index={0} view={{ ...baseView, fiscal }} />);
      expect(screen.getByText("Budget effect")).toBeTruthy();
      expect(screen.getByText("Budget effect information unavailable")).toBeTruthy();
      expect(screen.getByText("Metric effect information unavailable")).toBeTruthy();
      expect(screen.queryByText(/No direct/)).toBeNull();
    }
  );

  it("does not mistake a missing tax revenue estimate for zero revenue", () => {
    render(
      <BillProvisionCard
        index={0}
        view={{
          ...baseView,
          fiscal: { currencyCode: "USD", currentRate: 10, proposedRate: 20 },
        }}
      />
    );
    expect(screen.getByText("Rate 10% → 20%")).toBeTruthy();
    expect(screen.getByText("Revenue change information unavailable")).toBeTruthy();
    expect(screen.queryByText(/\$0\/yr revenue/)).toBeNull();
  });

  it("derives the treasury change from both fiscal profiles when the delta is absent", () => {
    render(
      <BillProvisionCard
        index={0}
        view={{
          ...baseView,
          fiscal: {
            currencyCode: "USD",
            current: { cost: 90_000_000, revenue: 0, net: -90_000_000 },
            proposed: { cost: 100_000_000, revenue: 0, net: -100_000_000 },
          },
        }}
      />
    );
    expect(screen.getByText("Net change −$10M/yr to the treasury")).toBeTruthy();
  });

  it("renders zero fiscal and metric changes neutrally", () => {
    render(
      <BillProvisionCard
        index={0}
        view={{
          ...baseView,
          fiscal: { currencyCode: "USD", currentRate: 10, proposedRate: 10, revenueDelta: 0 },
          metricEffects: [{ metric: "Care affordability", favorableNormalizedDelta: 0 }],
        }}
      />
    );
    expect(screen.getByText("$0/yr revenue").className).toContain("text-muted");
    expect(screen.getByText("No change").className).toContain("text-muted");
  });

  it("identifies an unchanged legacy policy without claiming that its forecast is missing", () => {
    render(
      <BillProvisionCard
        index={0}
        view={{ ...baseView, currentPolicyIndex: 2, proposedPolicyIndex: 2 }}
      />
    );
    expect(screen.getByText("No modeled change from current law")).toBeTruthy();
    expect(screen.queryByText("Metric effect information unavailable")).toBeNull();
  });

  it("shows the budget and every primary metric effect for a reviewed law", () => {
    render(
      <BillProvisionCard
        index={1}
        view={{
          legislationTypeName: "Universal Care Guarantee",
          current: { title: "Current health law" },
          proposed: { title: "Universal Care Guarantee" },
          effectDirection: 0,
          fiscal: {
            currencyCode: "USD",
            current: { cost: 95_000_000, revenue: 0, net: -95_000_000 },
            proposed: { cost: 125_000_000, revenue: 0, net: -125_000_000 },
            netDelta: -30_000_000,
            transitionCost: 4_000_000,
          },
          metricEffects: [
            { metric: "Effective health coverage", favorableNormalizedDelta: 0.42 },
            { metric: "Care affordability", favorableNormalizedDelta: 0.42 },
            { metric: "Preventable mortality", favorableNormalizedDelta: -0.1 },
          ],
        }}
      />
    );

    expect(screen.getByText("Budget effect")).toBeTruthy();
    expect(screen.getByText(/Cost \$95M → \$125M\/yr/)).toBeTruthy();
    expect(screen.getByText(/Net change −\$30M\/yr/)).toBeTruthy();
    expect(screen.getByText(/One-time transition cost \$4M/)).toBeTruthy();
    expect(screen.getByText("Metric effect")).toBeTruthy();
    expect(screen.getByText("Effective health coverage")).toBeTruthy();
    expect(screen.getByText("Care affordability")).toBeTruthy();
    expect(screen.getByText("Preventable mortality")).toBeTruthy();
    expect(screen.getAllByText("Favorable")).toHaveLength(2);
    expect(screen.getByText("Unfavorable")).toBeTruthy();
  });

  it("does not invent a metric effect for tax provisions without a forecast", () => {
    render(
      <BillProvisionCard
        index={0}
        view={{
          legislationTypeName: "Foreign Corporation Tax Act",
          current: { title: "Rate", description: "36%" },
          proposed: { title: "Rate", description: "45%" },
          effectDirection: 0,
          fiscal: {
            currencyCode: "USD",
            currentRate: 36,
            proposedRate: 45,
            revenueDelta: 8_300_000_000,
          },
        }}
      />
    );

    expect(screen.getByText("Metric effect information unavailable")).toBeTruthy();
  });
});
