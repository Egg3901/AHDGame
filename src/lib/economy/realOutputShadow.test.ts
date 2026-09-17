import { describe, it, expect } from "vitest";
import {
  REAL_OUTPUT_SHADOW_CLI_FLAG,
  isRealOutputShadowEnabled,
  parseRealOutputShadowEnabled,
  selectShadowSectorSignal,
} from "./realOutputShadow";
import { DEFAULT_GAME_STATE_FLAGS } from "@/lib/seeds/reference/featureFlagDefaults";
import { FEATURE_GATE_BOOLEAN_KEYS } from "@/app/api/admin/feature-gates/route";

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

describe("parseRealOutputShadowEnabled (canonical queue CLI mapping)", () => {
  it("uses the canonical flag spelling", () => {
    expect(REAL_OUTPUT_SHADOW_CLI_FLAG).toBe("real-output-shadow");
  });

  it("maps explicit true and false, and leaves absent unset (off)", () => {
    expect(parseRealOutputShadowEnabled("true")).toBe(true);
    expect(parseRealOutputShadowEnabled("false")).toBe(false);
    expect(parseRealOutputShadowEnabled(undefined)).toBeUndefined();
  });

  it("rejects anything but explicit true/false so typos fail loudly", () => {
    for (const raw of ["yes", "1", "0", "", "True", "TRUE", "on"]) {
      expect(() => parseRealOutputShadowEnabled(raw)).toThrow(
        "--real-output-shadow must be true or false"
      );
    }
  });
});

describe("realOutputShadowEnabled exclusion (production-impossible)", () => {
  it("is not an all-feature-sweep flag: the sweep enables DEFAULT_GAME_STATE_FLAGS", () => {
    // runWorld --all-feature-flags writes exactly the boolean entries of
    // DEFAULT_GAME_STATE_FLAGS onto gameState. The shadow flag lives on
    // gameConfig and must never appear here, or a sweep run would enable it.
    expect(Object.keys(DEFAULT_GAME_STATE_FLAGS)).not.toContain("realOutputShadowEnabled");
  });

  it("is not an admin-mutable feature gate", () => {
    // The admin feature-gates endpoint validates against this exact key set,
    // so absence here means admin writes are refused at the schema boundary.
    expect([...FEATURE_GATE_BOOLEAN_KEYS]).not.toContain("realOutputShadowEnabled");
  });
});
