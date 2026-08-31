/** @vitest-environment happy-dom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AttackPanel from "./AttackPanel";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (value: number) => `₳${value.toLocaleString("en-US")}`,
  }),
}));

describe("AttackPanel plant split", () => {
  it("opens the shared planner and waits for explicit confirmation", async () => {
    const onAttack = vi.fn().mockResolvedValue(true);

    render(
      <AttackPanel
        attackInfo={{
          attackCost: 0,
          splitCost: 0,
          splitEstimatedCapture: 0,
          splitMsCost: 0,
          userMarketingStrength: 150,
          userLiquidCapital: 500_000,
          stateId: "TX",
          countryId: "US",
          plantCount: 1_000,
          plantSplitQuote: {
            seizureFraction: 0.13,
            plantsAtRisk: 130,
            trancheBookValueAnchor: 260_000,
            cashCostAnchor: 130_000,
            marketingStrengthCost: 20,
            successProbability: 0.6,
          },
        }}
        plantsMode
        targetName="Rival Steel"
        showAttack
        showSplit={false}
        attacking={false}
        attackError=""
        attackMsg=""
        onAttack={onAttack}
        splitting={false}
        splitError=""
        splitMsg=""
        onSplit={vi.fn()}
        sectorCurrencyCode="USD"
      />
    );

    expect(screen.queryByRole("button", { name: "Attack Sector" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Plan sector split" }));
    expect(onAttack).not.toHaveBeenCalled();
    expect(screen.getByText("Target: Rival Steel")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Confirm sector split" }));
    await waitFor(() => expect(onAttack).toHaveBeenCalledTimes(1));
  });
});
