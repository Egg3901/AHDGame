import { describe, expect, it } from "vitest";
import { getPublicShareQuote, getRoundedPublicMarketCap } from "./marketQuote";

describe("marketQuote", () => {
  it("getPublicShareQuote returns sharePrice", () => {
    expect(getPublicShareQuote({ sharePrice: 9.5 })).toBe(9.5);
  });

  it("getPublicShareQuote returns default when no sharePrice", () => {
    expect(getPublicShareQuote({})).toBe(0.1);
  });

  it("getRoundedPublicMarketCap multiplies quote by shares", () => {
    expect(getRoundedPublicMarketCap({ sharePrice: 10 }, 1_000_000)).toBe(10_000_000);
  });
});
