import { describe, expect, it } from "vitest";
import { legacyStockTabToMarketTab, parseMarketTab } from "./hubTabs";

describe("hubTabs", () => {
  it("parses tabs with an overview fallback", () => {
    expect(parseMarketTab("supply")).toBe("supply");
    expect(parseMarketTab("x")).toBe("overview");
    expect(parseMarketTab(null)).toBe("overview");
  });
  it("maps legacy stock market tabs", () => {
    expect(legacyStockTabToMarketTab(undefined)).toBe("stocks");
    expect(legacyStockTabToMarketTab("listings")).toBe("stocks");
    expect(legacyStockTabToMarketTab("bonds")).toBe("bonds");
    expect(legacyStockTabToMarketTab("wealth")).toBeNull();
  });
});
