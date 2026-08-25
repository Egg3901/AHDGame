import { describe, expect, it } from "vitest";
import { getPublicShareQuote, getRoundedPublicMarketCap } from "./marketQuote";

describe("marketQuote", () => {
  it("getPublicShareQuote returns sharePrice", () => {
    expect(getPublicShareQuote({ sharePrice: 9.5 })).toBe(9.5);
  });

  it("getPublicShareQuote returns default when no sharePrice", () => {
    expect(getPublicShareQuote({})).toBe(0.1);
  });

  it("getPublicShareQuote returns 0 for an explicitly zero price, not the default", () => {
    // `??` does not fire on 0, so a corp deliberately priced at 0 stays at 0 and
    // only a MISSING price falls back. Every valuation surface shares this
    // accessor, so they must all agree on which of the two is happening.
    expect(getPublicShareQuote({ sharePrice: 0 })).toBe(0);
  });

  it("getRoundedPublicMarketCap multiplies quote by shares", () => {
    expect(getRoundedPublicMarketCap({ sharePrice: 10 }, 1_000_000)).toBe(10_000_000);
  });
});
