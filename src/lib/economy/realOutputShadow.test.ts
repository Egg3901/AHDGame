import { describe, it, expect } from "vitest";
import { isRealOutputShadowEnabled, selectShadowSectorSignal } from "./realOutputShadow";

describe("isRealOutputShadowEnabled (issue #1470 item 1)", () => {
  it("is off when the config is absent, null, or the field is missing", () => {
    expect(isRealOutputShadowEnabled(undefined)).toBe(false);
    expect(isRealOutputShadowEnabled(null)).toBe(false);
    expect(isRealOutputShadowEnabled({})).toBe(false);
  });

  it("is off for explicit false and for non-boolean values", () => {
    expect(isRealOutputShadowEnabled({ realOutputShadowEnabled: false })).toBe(false);
    expect(isRealOutputShadowEnabled({ realOutputShadowEnabled: "shadow" })).toBe(false);
    expect(isRealOutputShadowEnabled({ realOutputShadowEnabled: 1 })).toBe(false);
  });

  it("is on only for explicit true (never enabled in this slice)", () => {
    expect(isRealOutputShadowEnabled({ realOutputShadowEnabled: true })).toBe(true);
  });
});

describe("selectShadowSectorSignal (strict flag-off identity)", () => {
  it("returns the nominal print untouched with the flag off", () => {
    expect(
      selectShadowSectorSignal({ nominalSignal: -10, realSignal: 0, flagEnabled: false })
    ).toEqual({ signal: -10, shadow: null });
  });

  it("still returns the nominal print untouched with the flag on (shadow is diagnostic-only)", () => {
    expect(
      selectShadowSectorSignal({ nominalSignal: -10, realSignal: 0, flagEnabled: true })
    ).toEqual({ signal: -10, shadow: 0 });
  });

  it("records no shadow when the real leg is missing, even flag-on", () => {
    expect(
      selectShadowSectorSignal({ nominalSignal: 2, realSignal: null, flagEnabled: true })
    ).toEqual({ signal: 2, shadow: null });
  });
});
