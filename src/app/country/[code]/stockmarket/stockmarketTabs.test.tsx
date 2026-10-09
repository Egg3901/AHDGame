import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));

import StockMarketPage from "./page";

describe("legacy stock-market page", () => {
  beforeEach(() => redirect.mockClear());

  it("redirects country listings to the matching Market exchange", async () => {
    await StockMarketPage({
      params: Promise.resolve({ code: "uk" }),
      searchParams: Promise.resolve({ tab: "listings" }),
    });
    expect(redirect).toHaveBeenCalledWith("/market?tab=stocks&exchange=UK");
  });

  it("preserves supported tabs and drops obsolete query values", async () => {
    await StockMarketPage({
      params: Promise.resolve({ code: "us" }),
      searchParams: Promise.resolve({ tab: "funds", keep: "ignored" }),
    });
    expect(redirect).toHaveBeenCalledWith("/market?tab=funds&exchange=US");
  });

  it("redirects obsolete tabs without mounting the retired client page", async () => {
    await StockMarketPage({
      params: Promise.resolve({ code: "us" }),
      searchParams: Promise.resolve({ tab: "auctions" }),
    });
    expect(redirect).toHaveBeenCalledWith("/market?exchange=US");
  });
});
