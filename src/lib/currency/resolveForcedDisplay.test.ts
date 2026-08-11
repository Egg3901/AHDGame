import { describe, it, expect } from "vitest";
import { resolveForcedDisplay } from "./resolveForcedDisplay";

const RATES = { USD: 1.06, GBP: 0.77, JPY: 112 };

describe("resolveForcedDisplay", () => {
  it("converts an internal amount to the requested currency, ignoring viewer preference", () => {
    expect(resolveForcedDisplay(1000, "USD", RATES)).toEqual({ value: 1060, symbol: "$" });
    expect(resolveForcedDisplay(1000, "GBP", RATES)).toEqual({ value: 770, symbol: "£" });
    expect(resolveForcedDisplay(1000, "JPY", RATES)).toEqual({ value: 112000, symbol: "¥" });
  });

  it("falls back to the BASELINE local rate when rates are null — never the anchor symbol", () => {
    // US baseline: 1 local unit = 1 USD ≈ 1 anchor.
    expect(resolveForcedDisplay(42, "USD", null)).toEqual({ value: 42, symbol: "$" });
    // JP baseline: usdExchangeRate 0.00943 USD/JPY → ≈106 JPY per anchor.
    const jp = resolveForcedDisplay(1000, "JPY", null);
    expect(jp.symbol).toBe("¥");
    expect(jp.value).toBeCloseTo(1000 / 0.00943, 0);
  });

  it("falls back to the baseline rate when the requested currency has no live rate entry", () => {
    const eur = resolveForcedDisplay(42, "EUR", RATES);
    expect(eur.symbol).toBe("€");
    // CAD has no launched country config yet — stays on the last-resort path.
    expect(resolveForcedDisplay(42, "CAD", RATES).symbol).toBe("₳");
  });

  it("last-resort anchor passthrough only for a currency no config knows", () => {
    expect(resolveForcedDisplay(42, "XXX" as never, null)).toEqual({ value: 42, symbol: "₳" });
  });

  it("passes zero and negative amounts through unchanged before conversion", () => {
    expect(resolveForcedDisplay(0, "USD", RATES)).toEqual({ value: 0, symbol: "$" });
    expect(resolveForcedDisplay(-500, "GBP", RATES)).toEqual({ value: -385, symbol: "£" });
  });

  it("is insensitive to user display preference (pure function of amount + currency + rates)", () => {
    // Same inputs → same outputs across any caller context.
    const a = resolveForcedDisplay(5000, "GBP", RATES);
    const b = resolveForcedDisplay(5000, "GBP", RATES);
    expect(a).toEqual(b);
  });
});
