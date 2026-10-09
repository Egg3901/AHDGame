/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { clearMarketJsonCache } from "./useMarketJson";

vi.mock("@/contexts/AuthDataContext", () => ({ useAuthMe: () => ({ navData: null }) }));
vi.mock("@/hooks/useGameEvents", () => ({ useGameTurnStatus: () => null }));
vi.mock("@/contexts/RegisteredCountriesContext", () => ({
  useEnabledCountries: () => ["US", "UK", "JP"],
  useCountryDisplayName: () => (id: string) => id,
}));

let search = "";
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/market",
  useRouter: () => ({ replace }),
}));
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (x: number) => `A${x}`,
    formatPrice: (x: number) => `P${x}`,
    formatListingPrice: (x: number) => `P${x}`,
  }),
}));
vi.mock("@/app/country/[code]/stockmarket/components/MarketOverview", () => ({
  StockMarketChart: ({ exchangeFilter }: { exchangeFilter: string }) => (
    <div data-testid="market-chart" data-exchange={exchangeFilter} />
  ),
}));
vi.mock("@/app/country/[code]/stockmarket/components/StockList", () => ({
  StockList: () => <div>stock-list</div>,
}));
vi.mock("@/app/country/[code]/stockmarket/components/BondTable", () => ({
  BondTable: () => <div>bond-table</div>,
}));
vi.mock("@/app/country/[code]/stockmarket/components/FundTable", () => ({
  FundTable: () => <div>fund-table</div>,
}));

import { MarketHub } from "./MarketHub";

const commodity = (id: string, price: number) => ({
  commodity: id,
  label: id,
  icon: "",
  colors: "",
  unit: "t",
  basePrice: 100,
  globalPrice: price,
  globalSupply: 10,
  globalDemand: 20,
  exchangeSupply: 0,
  exchangeDemand: 0,
  priceChange: 1,
});
const offer = (ai: boolean) => ({
  id: "o1",
  corporationId: "c1",
  corporationName: "Acme",
  slot: 1,
  own: false,
  ai,
  side: "sell",
  commodity: "oil",
  volumeCap: 5,
  pricePremium: 0.1,
  expiresAtTurn: 50,
});

let calls: string[];
beforeEach(() => {
  cleanup();
  clearMarketJsonCache();
  window.localStorage.clear();
  replace.mockClear();
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      const json = (b: unknown) => ({ ok: true, json: async () => b });
      if (url.startsWith("/api/commodities"))
        return json({
          commodities: [commodity("oil", 120), commodity("coal", 80), commodity("gas", 100)],
        });
      if (url.startsWith("/api/supply-offers"))
        return json({
          enabled: true,
          offers: [offer(true)],
          myCorporations: [],
          currentTurn: 1,
          page: 1,
          hasMore: false,
          total: 7,
        });
      if (url.startsWith("/api/sectors"))
        return json({
          page: 1,
          totalPages: 1,
          totalItems: 3,
          sectors: [],
          counts: { unowned: 0, owned: 0, forSale: 3 },
        });
      if (url.includes("market-cap-history"))
        return json({
          points: [
            { turn: 1, marketCap: 100 },
            { turn: 2, marketCap: 110 },
          ],
        });
      return json({});
    })
  );
});

describe("MarketHub", () => {
  it("puts the chart on top, without headline tiles, and collapses it", async () => {
    search = "";
    window.localStorage.clear();
    render(<MarketHub />);
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe(
      "true"
    );
    expect(screen.getByTestId("market-chart")).toBeTruthy();
    expect(screen.queryByText("Market index")).toBeNull();
    expect(screen.queryByText("Open supply offers")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hide chart" }));
    expect(screen.queryByTestId("market-chart")).toBeNull();
    expect(window.localStorage.getItem("market.chartOpen")).toBe("0");
    await waitFor(() => expect(calls.some((u) => u.startsWith("/api/bonds"))).toBe(true));
  });

  it("restores a collapsed chart from storage", async () => {
    search = "";
    window.localStorage.setItem("market.chartOpen", "0");
    render(<MarketHub />);
    await waitFor(() => expect(screen.queryByTestId("market-chart")).toBeNull());
    expect(screen.getByRole("button", { name: "Show chart" })).toBeTruthy();
  });

  it("does not fetch bonds or funds on an unrelated tab", async () => {
    search = "tab=commodities";
    render(<MarketHub />);
    await waitFor(() => expect(screen.getAllByText("Detail", { selector: "a" })[0]).toBeTruthy());
    expect(
      calls.some((u) => u.startsWith("/api/bonds") || u.startsWith("/api/investment-funds"))
    ).toBe(false);
  });

  it("syncs the tab to the url", () => {
    search = "";
    render(<MarketHub />);
    fireEvent.click(screen.getByRole("tab", { name: "Bonds" }));
    expect(replace).toHaveBeenCalledWith("/market?tab=bonds", { scroll: false });
  });

  it("restores exchange selection on the chart and writes the selected venue to the URL", async () => {
    search = "tab=stocks";
    render(<MarketHub />);
    expect(screen.getByTestId("market-chart").getAttribute("data-exchange")).toBe("global");
    fireEvent.click(screen.getAllByRole("button", { name: "NYSE" })[0]);
    expect(replace).toHaveBeenCalledWith("/market?tab=stocks&exchange=US", { scroll: false });
    await waitFor(() => expect(screen.getByText("No listed corporations yet.")).toBeTruthy());
  });

  it("restores a selected exchange from the URL and loads compare totals only when requested", async () => {
    search = "tab=stocks&exchange=JP";
    render(<MarketHub />);
    expect(screen.getByTestId("market-chart").getAttribute("data-exchange")).toBe("JP");
    await waitFor(() => expect(screen.getByText("No listed corporations yet.")).toBeTruthy());
    const initialNikkeiRequests = calls.filter((url) => url.includes("exchange=nikkei")).length;
    expect(initialNikkeiRequests).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    await waitFor(() =>
      expect(calls.filter((url) => url.includes("exchange=nikkei")).length).toBeGreaterThan(
        initialNikkeiRequests
      )
    );
    await waitFor(() => expect(screen.getByText("No listed corporations yet.")).toBeTruthy());
  });

  it("labels NPP offers and defaults the supply tab to players", async () => {
    search = "tab=supply";
    render(<MarketHub />);
    await waitFor(() => expect(screen.getAllByText("NPP").length).toBeGreaterThan(0));
    expect(screen.queryByText("AI")).toBeNull();
    expect(screen.getByRole("button", { name: "Players" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(calls.some((u) => u.startsWith("/api/supply-offers") && u.includes("kind=player"))).toBe(
      true
    );
    fireEvent.click(screen.getByRole("button", { name: "Seeking (buy)" }));
    await waitFor(() =>
      expect(calls.some((u) => u.includes("side=buy") && u.includes("kind=player"))).toBe(true)
    );
  });

  it("shows volume, value and a premium chip for an offer", async () => {
    search = "tab=supply";
    render(<MarketHub />);
    await waitFor(() => expect(screen.getByText("+10%")).toBeTruthy());
    expect(screen.getByText("Offering")).toBeTruthy();
    expect(screen.getByText("~A660")).toBeTruthy();
  });

  it("falls back to the overview for an unknown tab", () => {
    search = "tab=bogus";
    render(<MarketHub />);
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe(
      "true"
    );
  });
});
