import { describe, expect, it } from "vitest";
import { buildRuntimeExchangeMeta, getStockMarketBasePath } from "./stockMarketRouting";

describe("stockMarketRouting", () => {
  it("keeps the selected exchange path in sync with the chosen market", () => {
    expect(getStockMarketBasePath("global", "us")).toBe("/stockmarket/global");
    expect(getStockMarketBasePath("UK", "us")).toBe("/country/uk/stockmarket");
  });

  it("falls back to the current country path when the selection is invalid", () => {
    expect(getStockMarketBasePath("unknown", "us")).toBe("/country/us/stockmarket");
    expect(getStockMarketBasePath("unknown", "global")).toBe("/stockmarket/global");
  });

  it("keeps the current country exchange available before country visibility resolves", () => {
    const meta = buildRuntimeExchangeMeta(null, "US");

    expect(meta.global.exchangeApi).toBe("global");
    expect(meta.US.exchangeApi).toBe("nyse");
    expect(meta.US.title).toBe("NYSE");
  });

  it("shows the NGX tab when Nigeria is economy-visible at runtime", () => {
    // Live activates NG via countryGameStates even though the static config
    // still says coming-soon; the runtime visibility set is what gates the tab.
    const meta = buildRuntimeExchangeMeta(new Set(["US", "UK", "NG"]), "US");

    expect(meta.NG).toEqual({
      title: "NGX",
      subtitle: "NGX - Nigeria",
      exchangeApi: "ngx",
    });
    expect(meta.US.exchangeApi).toBe("nyse");
    expect(meta.CN).toBeUndefined();
  });

  it("falls back to the current country's exchange when availability is unknown", () => {
    const meta = buildRuntimeExchangeMeta(null, "NG");

    expect(meta.NG).toBeDefined();
    expect(meta.NG.title).toBe("NGX");
  });

  it("omits a country that is not in the visible set from the pill row", () => {
    // The visibility set is built by the page from /api/countries and now
    // contains only enabledForPlayers countries; this asserts the meta builder
    // respects whatever set it is handed.
    const meta = buildRuntimeExchangeMeta(new Set(["US", "UK"]), "US");

    expect(meta.BR).toBeUndefined();
    expect(meta.IE).toBeUndefined();
    expect(meta.US).toBeDefined();
    expect(meta.UK).toBeDefined();
  });

  it("still gives the current country its own pill when it is not enabled", () => {
    // "Gate the pill, keep the page": landing directly on a non-enabled
    // country's market page must show that country's listings, not fall
    // through to Global. The page adds the current country to the set.
    const meta = buildRuntimeExchangeMeta(new Set(["US", "BR"]), "BR");

    expect(meta.BR).toBeDefined();
    expect(meta.BR.exchangeApi).toBe("b3");
  });

  it("does not offer a command economy's register as a pill unless it is visible", () => {
    const meta = buildRuntimeExchangeMeta(new Set(["US"]), "US");

    expect(meta.RU).toBeUndefined();
    expect(meta.DD).toBeUndefined();
  });

  it("uses the registry's hyphenated api key for a multi-word register", () => {
    // Deriving the key locally as exchangeName.toLowerCase() would yield
    // "gosplan ssr" — a space-bearing key that matches no snapshot _id.
    const meta = buildRuntimeExchangeMeta(null, "BAL");

    expect(meta.BAL.title).toBe("GOSPLAN SSR");
    expect(meta.BAL.exchangeApi).toBe("gosplan-ssr");
    expect(meta.BAL.exchangeApi).not.toMatch(/\s/);
  });
});
