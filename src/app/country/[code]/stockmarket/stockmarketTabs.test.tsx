/**
 * Regression for #2168 (stockmarket half): inactive tab data must not load
 * until its tab is selected. The auctions endpoint used to fire on every
 * exchange change to populate its badge before the tab was visited.
 *
 * The page receives Next.js async `params` (a promise). The test resolves
 * that seam with a surgical `react.use` mock so the component mounts without
 * the Suspense boundary; tab state is driven through the `useSearchParams`
 * mock like the app drives it through the URL.
 *
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    use: (value: unknown) =>
      value != null && typeof (value as Promise<unknown>).then === "function"
        ? { code: "US" }
        : (actual.use as (v: unknown) => unknown)(value),
  };
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
  usePathname: () => "/US/stockmarket",
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (x: number) => `Amt${x}`,
    formatPrice: (x: number) => `Px${x}`,
    currencySymbol: "$",
    forexEnabled: false,
    playerCountryId: undefined,
    baseRates: {},
  }),
}));

vi.mock("@/contexts/AuthDataContext", () => ({
  useAuthMe: () => ({ navData: null }),
}));

vi.mock("@/contexts/RegisteredCountriesContext", () => {
  // Match the stable production callback; a new function every render makes
  // exchangeMeta change and repeatedly triggers the page fetch effect.
  const displayName = () => "United States";
  return {
    useCountryDisplayName: () => displayName,
    useActivePreset: () => "2019-default",
  };
});

vi.mock("@/hooks/useGameEvents", () => ({
  useGameTurnStatus: () => null,
}));

vi.mock("@/lib/observability/fetchJson", () => ({
  fetchJson: vi.fn().mockResolvedValue(null),
}));

import StockMarketPage from "./page";

let searchParams = new URLSearchParams();

const fetchedUrls: string[] = [];
function mockFetchFor(url: string) {
  fetchedUrls.push(url);
  if (url.startsWith("/api/countries")) {
    return Promise.resolve({ ok: true, json: async () => ({ countries: [] }) });
  }
  if (url.startsWith("/api/stock-exchange/auctions")) {
    return Promise.resolve({
      ok: true,
      json: async () => ({ auctions: [], viewerCountryId: null }),
    });
  }
  if (url.startsWith("/api/stock-exchange?")) {
    return Promise.resolve({ ok: true, json: async () => ({ listings: [] }) });
  }
  return Promise.resolve({ ok: true, json: async () => ({}) });
}

const params = Promise.resolve({ code: "US" });

describe("stockmarket inactive tabs (#2168)", () => {
  beforeEach(() => {
    fetchedUrls.length = 0;
    searchParams = new URLSearchParams();
    vi.stubGlobal("fetch", vi.fn(mockFetchFor));
    // happy-dom has no Web Animations: report reduced motion so the ticker
    // takes its static branch instead of calling el.animate.
    Object.defineProperty(window, "matchMedia", {
      value: () => ({
        matches: true,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
      writable: true,
      configurable: true,
    });
  });

  it("does not fetch auctions on the default stocks tab", async () => {
    render(<StockMarketPage params={params} />);
    await waitFor(() => {
      expect(fetchedUrls.some((u) => u.startsWith("/api/stock-exchange?"))).toBe(true);
    });
    // Listings serve the visible stats strip and ticker; other tab data waits.
    for (const endpoint of [
      "/auctions",
      "/api/bonds",
      "/api/commodities",
      "/wealth-list",
      "/market-cap-history",
    ]) {
      expect(fetchedUrls.some((u) => u.includes(endpoint))).toBe(false);
    }
  });

  it("fetches auctions once the auctions tab is selected", async () => {
    searchParams = new URLSearchParams("tab=auctions");
    render(<StockMarketPage params={params} />);
    await waitFor(() => {
      expect(fetchedUrls.some((u) => u.startsWith("/api/stock-exchange/auctions"))).toBe(true);
    });
  });

  it("selecting the auctions tab after mount triggers the deferred fetch", async () => {
    const { rerender } = render(<StockMarketPage params={params} />);
    await waitFor(() => {
      expect(fetchedUrls.some((u) => u.startsWith("/api/stock-exchange?"))).toBe(true);
    });
    expect(fetchedUrls.some((u) => u.includes("/auctions"))).toBe(false);
    searchParams = new URLSearchParams("tab=auctions");
    rerender(<StockMarketPage params={params} />);
    await waitFor(() => {
      expect(fetchedUrls.some((u) => u.startsWith("/api/stock-exchange/auctions"))).toBe(true);
    });
  });
});
