// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { CurrencyProvider, useCurrency } from "./CurrencyContext";

const state = vi.hoisted(() => ({
  countryId: "DE",
  preference: "home",
  eurozoneEnabled: false,
  rates: { EUR: 0.85, IEP: 0.7, GBP: 0.6 } as Record<string, number>,
  baseRates: {} as Record<string, number>,
}));
vi.mock("@/contexts/AuthDataContext", () => ({
  useAuthMe: () => ({
    user: {
      forexEnabled: true,
      character: { countryId: state.countryId, displayCurrencyPreference: state.preference },
    },
  }),
}));
vi.mock("@/hooks/useWorldFlags", () => ({
  useWorldFlags: () => ({ preset: "1991-default", eurozoneEnabled: state.eurozoneEnabled }),
}));
vi.mock("@/hooks/useGameEvents", () => ({ useGameEvents: () => {} }));

beforeEach(() => {
  state.countryId = "DE";
  state.preference = "home";
  state.eurozoneEnabled = false;
  state.rates = { EUR: 0.85, IEP: 0.7, GBP: 0.6 };
  state.baseRates = {};
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rates: state.rates, baseRates: state.baseRates }),
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function currency() {
  const hook = renderHook(() => useCurrency(), { wrapper: CurrencyProvider });
  await waitFor(() => expect(hook.result.current.forexRates).not.toBeNull());
  return hook.result;
}

describe("historical currency presentation through the provider", () => {
  it("displays marks and accepts marks while preserving raw ledger conversion", async () => {
    const result = await currency();
    const display = result.current.resolveDisplayAt(100, undefined);
    expect(display.symbol).toBe("DM");
    expect(display.value).toBeCloseTo(166.24555);
    expect(result.current.inputSymbol).toBe("DM");
    expect(result.current.toDisplay(100)).toBeCloseTo(display.value);
    expect(result.current.toInternal(display.value)).toBeCloseTo(100);
    expect(result.current.toLocalOf(display.value, "GBP")).toBeCloseTo(60);
    expect(result.current.convert(100)).toBe(85);
    expect(result.current.currencySymbol).toBe("€ eq.");
    expect(result.current.toInternalFrom(85, "EUR")).toBe(100);
  });

  it("shows euros using their actual rate after Irish adoption", async () => {
    state.countryId = "IE";
    state.eurozoneEnabled = true;
    const result = await currency();
    expect(result.current.resolveDisplayAt(100, undefined)).toEqual({ value: 85, symbol: "€" });
    expect(result.current.toInternal(85)).toBe(100);
    expect(result.current.toLocalOf(85, "IEP")).toBe(70);
    expect(result.current.convert(100)).toBe(70);
    expect(result.current.currencySymbol).toBe("IR£");
  });

  it("uses historical snapshot rates before applying the marks conversion", async () => {
    const result = await currency();
    const display = result.current.resolveDisplayAt(100, { EUR: 0.5 });
    expect(display.value).toBeCloseTo(97.7915);
    expect(display.symbol).toBe("DM");
  });

  it("uses EUR snapshot rates for adopted Irish displays", async () => {
    state.countryId = "IE";
    state.eurozoneEnabled = true;
    const result = await currency();
    expect(result.current.resolveDisplayAt(100, { EUR: 0.4, IEP: 0.3 })).toEqual({
      value: 40,
      symbol: "€",
    });
  });

  it("keeps a pinned IEP display in IEP", async () => {
    state.countryId = "IE";
    state.preference = "IEP";
    state.eurozoneEnabled = true;
    const result = await currency();
    expect(result.current.resolveDisplayAt(100, undefined)).toEqual({ value: 70, symbol: "IR£" });
    expect(result.current.inputSymbol).toBe("IR£");
    expect(result.current.toInternal(70)).toBe(100);
  });

  it("round-trips a pinned base-rate display when its live rate is missing", async () => {
    state.preference = "GBP";
    state.rates = { EUR: 0.85 };
    state.baseRates = { GBP: 0.6 };
    const result = await currency();
    expect(result.current.resolveDisplayAt(100, undefined)).toEqual({ value: 60, symbol: "£" });
    expect(result.current.toInternal(60)).toBe(100);
  });

  it("shows and accepts anchor units if an adopted EUR rate is unavailable", async () => {
    state.countryId = "IE";
    state.eurozoneEnabled = true;
    state.rates = { IEP: 0.7 };
    const result = await currency();
    expect(result.current.resolveDisplayAt(100, undefined)).toEqual({ value: 100, symbol: "₳" });
    expect(result.current.inputSymbol).toBe("₳");
    expect(result.current.toInternal(100)).toBe(100);
  });
});
