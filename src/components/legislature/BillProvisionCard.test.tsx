/** @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BillProvisionCard } from "./BillProvisionCard";

vi.mock("@/components/PositionBadges", () => ({ PositionBadges: () => null }));
vi.mock("@/components/legislature/PolicyEffectIndicators", () => ({
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

  it("makes a tax provision's lack of a direct primary metric effect explicit", () => {
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

    expect(screen.getByText("No direct metric effect")).toBeTruthy();
  });
});
