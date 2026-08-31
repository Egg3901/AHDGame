import { describe, expect, it } from "vitest";
import { parseMoneyAmountInput } from "./parseMoneyAmountInput";

describe("parseMoneyAmountInput", () => {
  it("parses plain integers", () => {
    expect(parseMoneyAmountInput("1000")).toBe(1000);
    expect(parseMoneyAmountInput(" 50000 ")).toBe(50000);
  });

  it("strips thousands separators so values are not truncated", () => {
    expect(parseMoneyAmountInput("1,000")).toBe(1000);
    expect(parseMoneyAmountInput("1,000,000")).toBe(1000000);
  });

  it("handles nbsp and ideographic space as grouping", () => {
    expect(parseMoneyAmountInput("1\u00a0000")).toBe(1000);
    expect(parseMoneyAmountInput("1\u3000000")).toBe(1000);
  });

  it("normalizes full-width digits", () => {
    expect(parseMoneyAmountInput("\uFF11\uFF10\uFF10\uFF10")).toBe(1000);
  });

  it("returns NaN for empty or non-numeric", () => {
    expect(parseMoneyAmountInput("")).toBeNaN();
    expect(parseMoneyAmountInput("   ")).toBeNaN();
    expect(parseMoneyAmountInput("x")).toBeNaN();
  });

  it("parses the K/M/B/T shorthand money figures are printed in", () => {
    // Every amount a player reads on screen is abbreviated ("spend at least
    // $4.0M"), so the field has to take the same token back (ticket #1236).
    expect(parseMoneyAmountInput("4.0M")).toBe(4_000_000);
    expect(parseMoneyAmountInput("49m")).toBe(49_000_000);
    expect(parseMoneyAmountInput("2B")).toBe(2_000_000_000);
    expect(parseMoneyAmountInput("900k")).toBe(900_000);
    expect(parseMoneyAmountInput("1.5T")).toBe(1_500_000_000_000);
    expect(parseMoneyAmountInput("4 m")).toBe(4_000_000);
    expect(parseMoneyAmountInput("1,000M")).toBe(1_000_000_000);
  });

  it("keeps scientific notation and refuses unknown or misplaced suffixes", () => {
    // `Number` accepted these before the shorthand existed; the fallback keeps
    // that, so no previously valid input changes meaning.
    expect(parseMoneyAmountInput("1e3")).toBe(1000);
    expect(parseMoneyAmountInput("-5")).toBe(-5);
    expect(parseMoneyAmountInput("5x")).toBeNaN();
    expect(parseMoneyAmountInput("5mm")).toBeNaN();
    expect(parseMoneyAmountInput("M5")).toBeNaN();
    expect(parseMoneyAmountInput("5M5")).toBeNaN();
  });

  it("normalizes full-width shorthand letters, so IME input parses", () => {
    expect(parseMoneyAmountInput("\uFF14\uFF2D")).toBe(4_000_000);
    expect(parseMoneyAmountInput("\uFF11\uFF10\uFF10\uFF10\uFF4B")).toBe(1_000_000);
  });
});
