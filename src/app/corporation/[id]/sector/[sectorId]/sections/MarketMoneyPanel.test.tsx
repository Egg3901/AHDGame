/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MarketMoneyPanel from "./MarketMoneyPanel";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (value: number) => `M${value}`,
    formatPrice: (value: number) => `M${value}`,
    toInternalFrom: (value: number) => value,
  }),
}));

const plants = {
  producedUnits: 10_576,
  soldUnits: 6_944,
  unsoldUnits: 3_632,
  demandGapUnits: 0,
  fillRate: 0.66,
  pnl: {
    revenueAnchor: 895_000,
    inputsAnchor: 16_900,
    labourAnchor: 217_000,
    upkeepAnchor: 4_800,
    complianceAnchor: 0,
    otherOperatingAnchor: 569_000,
    growthAndBuildAnchor: 0,
    profitAnchor: 87_700,
    financialEventsAnchor: 0,
    avgSalePriceAnchor: 128.94,
    profitPerUnitAnchor: 8.3,
  },
  truth: {
    soldFraction: 0.66,
    soldByCommodity: [],
    receivedPerUnitAnchor: 84.66,
    costPerUnitAnchor: 76.36,
    fillAdjustedMarginPct: 9.8,
    breakEven: { status: "profitable_now", turns: null },
  },
} as never;

describe("MarketMoneyPanel period and scope labels", () => {
  it("separates per-unit averages, daily totals, turns, and SOE remittance (ticket #1072)", () => {
    render(
      <MarketMoneyPanel
        plants={plants}
        sectorType="manufacturing"
        financials={null}
        corporation={{ _id: "natcorp-1", name: "VEB Kombinat", isStateOwned: true }}
      />
    );

    expect(screen.getByText("Average per unit produced")).toBeTruthy();
    expect(screen.getByText("Total revenue / financial day")).toBeTruthy();
    expect(screen.getByText("Sector operating profit / financial day")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByText("Total revenue / turn (1 hour)")).toBeTruthy();
    expect(screen.getByText("Total revenue / game year (48 turns)")).toBeTruthy();
    expect(screen.getByText("From sector profit to the national budget")).toBeTruthy();

    const link = screen.getByRole("link", { name: "See corporation budget flow" });
    expect(link.getAttribute("href")).toBe("/corporation/natcorp-1?tab=overview");
  });
});
