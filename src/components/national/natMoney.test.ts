import { describe, it, expect } from "vitest";
import { natMoney, currencySymbol } from "./natMoney";

describe("currencySymbol", () => {
  it("maps known currency codes to their symbol", () => {
    expect(currencySymbol("CNY")).toBe("¥");
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("GBP")).toBe("£");
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("NGN")).toBe("₦");
  });

  it("falls back to the code for an unknown currency", () => {
    expect(currencySymbol("XYZ")).toBe("XYZ");
  });
});

describe("natMoney", () => {
  it("prefixes the symbol with no space and groups thousands", () => {
    expect(natMoney(0, "CNY")).toBe("¥0");
    expect(natMoney(1_200_000, "CNY")).toBe("¥1,200,000");
    expect(natMoney(1200, "USD")).toBe("$1,200");
  });

  it("leads the symbol with the minus sign for negatives", () => {
    expect(natMoney(-7_300_000, "CNY")).toBe("-¥7,300,000");
  });

  it("treats negative-zero as zero (no minus)", () => {
    expect(natMoney(-0, "CNY")).toBe("¥0");
  });
});
