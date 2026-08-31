/** @vitest-environment happy-dom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlantSplitPlannerModal } from "./PlantSplitPlannerModal";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount: (value: number) => `₳${value.toLocaleString("en-US")}` }),
}));

const quote = {
  seizureFraction: 0.13,
  plantsAtRisk: 130,
  trancheBookValueAnchor: 260_000,
  cashCostAnchor: 130_000,
  marketingStrengthCost: 20,
  successProbability: 0.6,
};

describe("PlantSplitPlannerModal", () => {
  it("shows the automatic share, whole plants, odds, and failure cost before confirmation", () => {
    render(
      <PlantSplitPlannerModal
        open
        targetName="Rival Steel"
        defenderPlantCount={1_000}
        quote={quote}
        userLiquidCapitalAnchor={500_000}
        userMarketingStrength={150}
        submitting={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText("13%")).toBeTruthy();
    expect(screen.getByText("130")).toBeTruthy();
    expect(screen.getByText("60.0%")).toBeTruthy();
    expect(screen.getByText(/not selectable/i)).toBeTruthy();
    expect(screen.getByText(/still spent/i)).toBeTruthy();
    expect(screen.getByText("₳130,000")).toBeTruthy();
    expect(screen.getByText("20 MS")).toBeTruthy();
  });

  it("requires an explicit confirmation", () => {
    const onConfirm = vi.fn();
    render(
      <PlantSplitPlannerModal
        open
        targetName="Rival Steel"
        defenderPlantCount={1_000}
        quote={quote}
        userLiquidCapitalAnchor={500_000}
        userMarketingStrength={150}
        submitting={false}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /confirm sector split/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("blocks confirmation when either committed resource is insufficient", () => {
    render(
      <PlantSplitPlannerModal
        open
        targetName="Rival Steel"
        defenderPlantCount={1_000}
        quote={quote}
        userLiquidCapitalAnchor={10}
        userMarketingStrength={10}
        submitting={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText(/enough cash or MS/i)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /confirm sector split/i }) as HTMLButtonElement).disabled
    ).toBe(true);
  });
});
