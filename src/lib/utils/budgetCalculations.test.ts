import { describe, it, expect } from "vitest";
import { getCurrencyPrefix } from "./budgetCalculations";

describe("getCurrencyPrefix", () => {
  it("resolves home currency symbols per country via the canonical map", () => {
    expect(getCurrencyPrefix("US")).toBe("$");
    expect(getCurrencyPrefix("UK")).toBe("£");
    expect(getCurrencyPrefix("JP")).toBe("¥");
    expect(getCurrencyPrefix("DE")).toBe("€");
    expect(getCurrencyPrefix("IE")).toBe("IR£"); // own IEP currency, not EUR
  });

  it("resolves sterlingized seceded nations to GBP (regression: SCO/WAL showed USD)", () => {
    expect(getCurrencyPrefix("SCO")).toBe("£");
    expect(getCurrencyPrefix("WAL")).toBe("£");
  });

  it("resolves era currencies from the symbols SSOT (regression: RU budget showed $)", () => {
    expect(getCurrencyPrefix("RU")).toBe("руб");
    expect(getCurrencyPrefix("DD")).toBe("M");
    expect(getCurrencyPrefix("SE")).toBe("kr");
    expect(getCurrencyPrefix("TR")).toBe("₺");
  });

  it("honors an explicit currency-code override and falls back to $ for unknown input", () => {
    expect(getCurrencyPrefix("SCO", "JPY")).toBe("¥");
    expect(getCurrencyPrefix(undefined)).toBe("$");
    expect(getCurrencyPrefix("ZZ")).toBe("$");
  });
});
