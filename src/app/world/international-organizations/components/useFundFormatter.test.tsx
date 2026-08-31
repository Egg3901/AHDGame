// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFundFormatter } from "./useFundFormatter";

// Anchor-unit formatter that echoes its inputs, so each assertion can see both
// the converted amount and which currency code the hook resolved.
const formatAmount = vi.fn((anchor: number, code?: string) => `${code ?? "?"}:${anchor}`);
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount }),
}));

describe("useFundFormatter", () => {
  it("resolves the currency from an org fund's currencyCountryId", () => {
    const { result } = renderHook(() =>
      useFundFormatter({ usdToFundRate: 2, currencyCountryId: "DE" })
    );
    expect(result.current(100)).toBe("EUR:200");
  });

  it("resolves the currency from an influence view's fundCurrencyCountryId", () => {
    // OrgInfluenceView names the fund country `fundCurrencyCountryId`. Before
    // the alias, passing a view here silently fell back to USD, so a Warsaw
    // Pact fund denominated in rubles priced its plays with a dollar sign.
    const { result } = renderHook(() =>
      useFundFormatter({ usdToFundRate: 0.1, fundCurrencyCountryId: "RU" })
    );
    expect(result.current(399_000_000)).toBe("SUR:39900000");
  });

  it("prefers an explicit currencyCode over either country id", () => {
    const { result } = renderHook(() =>
      useFundFormatter({ usdToFundRate: 1, currencyCode: "GBP", fundCurrencyCountryId: "RU" })
    );
    expect(result.current(5)).toBe("GBP:5");
  });

  it("prints the fund's own currency when the server sent no rate", () => {
    // Without an era rate there is nothing safe to convert with, so the amount
    // stays in the fund's units rather than a client-side guess (refs #3778).
    const { result } = renderHook(() => useFundFormatter({ fundCurrencyCountryId: "RU" }));
    expect(result.current(26_000_000_000)).toBe("SUR 26B");
    expect(formatAmount).not.toHaveBeenCalledWith(26_000_000_000, expect.anything());
  });
});
