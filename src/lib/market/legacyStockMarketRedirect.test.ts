import { describe, expect, it } from "vitest";
import { legacyStockMarketRedirectUrl } from "./legacyStockMarketRedirect";

describe("legacyStockMarketRedirectUrl", () => {
  it("moves a country stock-market URL into the market hub with the matching exchange", () => {
    expect(legacyStockMarketRedirectUrl("uk", { tab: "funds", keep: "ignored" })).toBe(
      "/market?tab=funds&exchange=UK"
    );
  });

  it("maps the old listings tab and keeps the wealth list and drops tabs that have no hub equivalent", () => {
    expect(legacyStockMarketRedirectUrl("US", { tab: "listings" })).toBe(
      "/market?tab=stocks&exchange=US"
    );
    expect(legacyStockMarketRedirectUrl("US", { tab: "wealth" })).toBe(
      "/market?tab=wealth&exchange=US"
    );
    expect(legacyStockMarketRedirectUrl("US", { tab: "auctions" })).toBe("/market?exchange=US");
  });

  it("uses global market when the old route has no exchange", () => {
    expect(legacyStockMarketRedirectUrl("global", {})).toBe("/market?tab=stocks");
  });
});
