/**
 * @vitest-environment happy-dom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MarketPositionPanel from "./MarketPositionPanel";
import type { Market, SectorData, CorporationRef, PlantsData } from "../types";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (value: number) => `$${value}`,
    formatAmountChip: (value: number) => `$${value}`,
    toInternalFrom: (value: number) => value,
  }),
}));

const market: Market = {
  totalMarket: 240_000,
  marketShare: 100,
  competitors: [],
  unownedRevenue: 0,
  unownedPercent: 0,
};

const sector = {
  _id: "sec-1",
  stateName: "Greater London",
  sectorLabel: "Agriculture",
  countryId: "UK",
} as unknown as SectorData;

const corporation = {
  _id: "corp-1",
  name: "OVO Farms",
  brandColor: "#3b82f6",
} as CorporationRef;

const plants = {
  demandGapUnits: 12_000,
  buildQueue: [{ unitsOrdered: 90_000, unitsDelivered: 30_000 }],
} as unknown as PlantsData;

describe("MarketPositionPanel (ticket #1155)", () => {
  it("labels a sole-producer pie as of producers and explains buyer room", () => {
    render(
      <MarketPositionPanel
        market={market}
        sector={sector}
        corporation={corporation}
        financials={null}
        plants={plants}
      />
    );

    expect(screen.getByText("of producers")).toBeTruthy();
    expect(screen.getByText(/only producer here right now/)).toBeTruthy();
    expect(screen.getByText(/not a cap on demand/)).toBeTruthy();
    expect(screen.getByText(/Capacity still being built does not count/)).toBeTruthy();
    expect(screen.getByText(/12,000 more units a day/)).toBeTruthy();
  });
});
