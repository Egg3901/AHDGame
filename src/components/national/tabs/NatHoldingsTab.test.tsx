/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NatHoldingsTab } from "./NatHoldingsTab";

const vm = {
  corporationId: "natcorp-1",
  currency: "EUR",
  holdingsByRegion: [
    {
      stateId: "DD-BE",
      stateName: "Berlin (Ost)",
      sectors: [
        {
          sectorId: "sector-1",
          sectorType: "manufacturing",
          stateId: "DD-BE",
          stateName: "Berlin (Ost)",
          revenue: 1_023_937,
          profitMargin: 12,
          operatingProfit: 37_783,
          workers: 113,
          marketSharePercent: 100,
          publicValuePerTurn: 0.09,
          efficiency: { base: -6, corruption: -3.4, governance: 3.6, mandate: -10, total: -23.3 },
          mappedMetricLabels: [],
          acquisitionTrigger: "Founding charter",
          acquisitionFrom: null,
          acquisitionTurn: null,
          priceControlled: true,
          employmentGuaranteed: true,
          mandateIsOverride: false,
        },
      ],
    },
  ],
} as never;

describe("NatHoldingsTab money semantics", () => {
  it("names the daily sector totals and links straight to the sector (ticket #1072)", () => {
    render(<NatHoldingsTab vm={vm} />);

    expect(screen.getByText("Revenue / financial day")).toBeTruthy();
    expect(screen.getByText("Operating profit / financial day")).toBeTruthy();
    expect(screen.queryByText("Revenue/turn")).toBeNull();
    expect(screen.queryByText("Profit/turn")).toBeNull();

    const link = screen.getByRole("link", { name: "Open sector" });
    expect(link.getAttribute("href")).toBe("/corporation/natcorp-1/sector/sector-1");

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Sector totals are not treasury remittance.")).toBeTruthy();
    const budgetLink = screen.getByRole("link", { name: "See corporation budget flow" });
    expect(budgetLink.getAttribute("href")).toBe("/corporation/natcorp-1?tab=overview");
  });
});
