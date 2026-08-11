import { describe, it, expect } from "vitest";
import { resolveSourceRate } from "./resolveSourceRate";

const RATES = { USD: 1.11, GBP: 0.75, JPY: 108.59 };

describe("resolveSourceRate", () => {
  it("returns 1 for 'internal' preference regardless of rates", () => {
    expect(resolveSourceRate("internal", "JPY", RATES)).toBe(1);
    expect(resolveSourceRate("internal", "USD", null)).toBe(1);
  });

  it("returns home rate for 'home' preference", () => {
    expect(resolveSourceRate("home", "JPY", RATES)).toBe(108.59);
    expect(resolveSourceRate("home", "USD", RATES)).toBe(1.11);
    expect(resolveSourceRate("home", "GBP", RATES)).toBe(0.75);
  });

  it("returns home rate for 'local' preference (the single-input case)", () => {
    expect(resolveSourceRate("local", "JPY", RATES)).toBe(108.59);
  });

  it("returns pinned-currency rate when preference is a CurrencyCode", () => {
    // JP player with preference pinned to USD — the bug scenario.
    expect(resolveSourceRate("USD", "JPY", RATES)).toBe(1.11);
    expect(resolveSourceRate("GBP", "JPY", RATES)).toBe(0.75);
    expect(resolveSourceRate("JPY", "USD", RATES)).toBe(108.59);
  });

  it("falls back to 1 when pinned currency has no rate", () => {
    // e.g. pref = "CAD" but rate map only has USD/GBP/JPY
    expect(resolveSourceRate("CAD", "JPY", RATES)).toBe(1);
  });

  it("returns 1 when rates are null (forex disabled / loading)", () => {
    expect(resolveSourceRate("home", "JPY", null)).toBe(1);
    expect(resolveSourceRate("USD", "JPY", null)).toBe(1);
  });

  it("returns 1 when home rate is missing and no pinned currency resolves", () => {
    expect(resolveSourceRate("home", "JPY", {})).toBe(1);
  });
});
