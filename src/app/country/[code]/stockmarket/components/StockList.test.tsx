/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StockList } from "./StockList";
import type { StockListing } from "../types";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (x: number) => `Amt${x}`,
    formatPrice: (x: number) => `Px${x}`,
  }),
}));

vi.mock("@/contexts/RegisteredCountriesContext", () => ({
  useCountryDisplayName: () => (id: string) => id,
}));

const base: Omit<StockListing, "_id" | "name" | "totalShares" | "publicFloat"> = {
  sequentialId: 1,
  type: "manufacturing",
  typeLabel: "Manufacturing",
  headquartersState: "NY",
  headquartersStateName: "New York",
  sharePrice: 10,
  marketCap: 10000,
  totalRevenue: 1000,
  income: 100,
  priceChange1h: 1,
  priceChange24h: 5,
  priceChange48h: 5,
  avgSectorGrowth: 0,
  exchange: "NYSE",
  ceo: null,
};

const tradable: StockListing = {
  ...base,
  _id: "pub",
  name: "Pub Co",
  totalShares: 1000,
  publicFloat: 500,
  isTradable: true,
};

const soe = (id: string, name: string): StockListing => ({
  ...base,
  _id: id,
  name,
  totalShares: 0,
  publicFloat: 0,
  priceChange1h: NaN,
  priceChange24h: NaN,
  priceChange48h: NaN,
  isNatcorp: true,
  countryOwnerId: "RU",
  isTradable: false,
});

describe("StockList non-tradable state", () => {
  it("renders a non-tradable badge for zero-share SOEs and never NaN%", () => {
    render(<StockList listings={[tradable, soe("s1", "SoE One"), soe("s2", "SoE Two")]} />);

    expect(screen.getByText("+5.00%")).toBeDefined();
    expect(document.body.textContent).not.toContain("NaN%");
    // Collapsed SoE group row carries the non-tradable state.
    expect(screen.getByText("Non-tradable")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /state-owned enterprises/i }));
    expect(screen.getAllByText("Non-tradable").length).toBeGreaterThanOrEqual(2);
    expect(document.body.textContent).not.toContain("NaN%");
  });

  it("falls back to the canonical predicate for pre-flag legacy rows", () => {
    // Pre-#2033 snapshots persist no isTradable flag and can carry NaN
    // returns on zero-share rows. The UI must still classify them as
    // non-tradable from shares/float alone, never rendering NaN%.
    const { isTradable: _dropped, ...legacySoe } = soe("legacy", "Legacy SoE");
    void _dropped;
    expect("isTradable" in legacySoe).toBe(false);
    render(<StockList listings={[tradable, legacySoe]} />);

    expect(document.body.textContent).not.toContain("NaN%");
    expect(screen.getByText("Non-tradable")).toBeDefined();
  });
});
