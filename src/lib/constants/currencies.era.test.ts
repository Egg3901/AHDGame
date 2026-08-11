import { describe, it, expect } from "vitest";
import { getEraAwareCurrencySymbol } from "@/lib/constants/currencies";

describe("getEraAwareCurrencySymbol", () => {
  it("returns DM for EUR/DE in 1991-default when eurozone disabled", () => {
    expect(getEraAwareCurrencySymbol("EUR", "1991-default", false, "DE")).toBe("DM");
  });

  it("returns IR£ for IEP when eurozone disabled", () => {
    expect(getEraAwareCurrencySymbol("IEP", "1991-default", false, "IE")).toBe("IR£");
  });

  it("returns € for IEP when eurozone enabled", () => {
    expect(getEraAwareCurrencySymbol("IEP", "2019-default", true, "IE")).toBe("€");
  });

  it("returns IEP for legacy EUR/IE callers when eurozone disabled", () => {
    expect(getEraAwareCurrencySymbol("EUR", "1991-default", false, "IE")).toBe("IEP");
  });

  it("returns DM for EUR/DE in 1979-default when eurozone disabled", () => {
    expect(getEraAwareCurrencySymbol("EUR", "1979-default", false, "DE")).toBe("DM");
  });

  it("returns € for EUR/DE in 1991-default when eurozone IS enabled (adopted mid-game)", () => {
    expect(getEraAwareCurrencySymbol("EUR", "1991-default", true, "DE")).toBe("€");
  });

  it("returns € for EUR/DE in 2019-default (modern era, always enabled)", () => {
    expect(getEraAwareCurrencySymbol("EUR", "2019-default", true, "DE")).toBe("€");
  });

  it("returns € when anchorCountryId absent in 1991-default pre-eurozone", () => {
    expect(getEraAwareCurrencySymbol("EUR", "1991-default", false)).toBe("€");
  });

  it("returns Cr$ for BRL in 1991-default (pre-Real)", () => {
    expect(getEraAwareCurrencySymbol("BRL", "1991-default", false, "BR")).toBe("Cr$");
  });

  it("returns Cr$ for BRL in 1979-default (pre-Real)", () => {
    expect(getEraAwareCurrencySymbol("BRL", "1979-default", false, "BR")).toBe("Cr$");
  });

  it("returns R$ for BRL in 2019-default (Real era)", () => {
    expect(getEraAwareCurrencySymbol("BRL", "2019-default", false, "BR")).toBe("R$");
  });

  it("returns standard symbols for era-unaffected currencies (GBP, JPY, USD, NGN)", () => {
    expect(getEraAwareCurrencySymbol("GBP", "1991-default", false, "UK")).toBe("£");
    expect(getEraAwareCurrencySymbol("JPY", "1991-default", false, "JP")).toBe("¥");
    expect(getEraAwareCurrencySymbol("USD", "1991-default", false, "US")).toBe("$");
    expect(getEraAwareCurrencySymbol("NGN", "1991-default", false, "NG")).toBe("₦");
  });
});
