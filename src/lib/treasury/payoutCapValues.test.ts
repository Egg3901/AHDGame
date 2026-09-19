import { describe, expect, it } from "vitest";
import { formatPayoutCap, getPlayerPayoutCap } from "./payoutCapValues";

describe("getPlayerPayoutCap", () => {
  it("normalises the country id before lookup", () => {
    expect(getPlayerPayoutCap("us")).toBe(getPlayerPayoutCap("US"));
  });
});

describe("formatPayoutCap", () => {
  it("uses the country's own currency symbol", () => {
    // The cap is a local-currency figure. Printing it with "$" told a UK
    // player their limit was in dollars, while the Request Funds card
    // directly above rendered the same number with "£".
    expect(formatPayoutCap("UK", 2_000_000)).toBe("£2,000,000");
  });

  it("uses the dollar sign where the dollar is the local currency", () => {
    expect(formatPayoutCap("US", 2_000_000)).toBe("$2,000,000");
  });

  it("normalises the country id like the cap lookup does", () => {
    // A lowercase code reaching the formatter must not silently fall
    // back to a different country's symbol.
    expect(formatPayoutCap("uk", 2_000_000)).toBe("£2,000,000");
  });
});
