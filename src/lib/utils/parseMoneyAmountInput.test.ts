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
});
