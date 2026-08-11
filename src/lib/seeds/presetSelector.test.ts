import { beforeEach, describe, it, expect } from "vitest";
import {
  eraForPreset,
  isKnownPreset,
  selectPresetBundle,
  selectPresetBundleOptional,
  getPresetFallbacks,
  resetPresetFallbacks,
  type EraId,
} from "./presetSelector";

describe("eraForPreset", () => {
  it.each([
    ["1979-default", "1979"],
    ["1991-default", "1991"],
    ["1999-default", "1999"],
    ["2007-default", "2007"],
    ["2019-default", "2019"],
    ["2023-default", "2023"],
    ["empty", "2019"],
    ["2019-no-parties", "2019"],
    ["unknown-preset", "2019"],
  ])("maps %s to %s", (preset, expected) => {
    expect(eraForPreset(preset)).toBe(expected as EraId);
  });
});

describe("isKnownPreset", () => {
  it.each([
    "1979-default",
    "1991-default",
    "1999-default",
    "2007-default",
    "2019-default",
    "2023-default",
    "empty",
    "2019-no-parties",
  ])("returns true for %s", (preset) => {
    expect(isKnownPreset(preset)).toBe(true);
  });

  it.each(["custom", "2024-default", "", "random"])("returns false for %s", (preset) => {
    expect(isKnownPreset(preset)).toBe(false);
  });
});

describe("selectPresetBundle", () => {
  it("returns the requested bundle when present", () => {
    const bundles = {
      "2019-default": "a",
      "1991-default": "b",
    };
    expect(selectPresetBundle("1991-default", bundles, "test")).toBe("b");
  });

  it("falls back to 2019-default when preset is missing", () => {
    const bundles = {
      "2019-default": "fallback",
    };
    expect(selectPresetBundle("unknown", bundles, "test")).toBe("fallback");
  });

  it("throws when no fallback exists", () => {
    expect(() => selectPresetBundle("x", {}, "test")).toThrow();
  });
});

describe("selectPresetBundleOptional", () => {
  it("returns the requested bundle when present", () => {
    expect(selectPresetBundleOptional("1991-default", { "1991-default": "b" }, "test")).toBe("b");
  });

  it("falls back to 2019-default when preset is missing", () => {
    expect(selectPresetBundleOptional("unknown", { "2019-default": "fallback" }, "test")).toBe(
      "fallback"
    );
  });

  it("returns undefined (does NOT throw) when neither preset nor 2019-default exists", () => {
    // Mirrors FR/IT/ES/RU/DD/NG census in a 1991 world: render paths must
    // degrade to no-data, not crash the page.
    expect(
      selectPresetBundleOptional(
        "1991-default",
        { "1953-default": "x", "1979-default": "y" },
        "test"
      )
    ).toBeUndefined();
  });
});

describe("preset fallback recording", () => {
  beforeEach(() => resetPresetFallbacks());

  it("records the lane and preset when an era has no bundle", () => {
    // The whole point of step 7: a world set in another decade must not receive
    // 2019 data with nothing to notice.
    selectPresetBundle("1991-default", { "2019-default": "modern" }, "seedXX:xxRegions");
    expect(getPresetFallbacks()).toEqual([{ label: "seedXX:xxRegions", preset: "1991-default" }]);
  });

  it("records nothing when the era has its own bundle", () => {
    selectPresetBundle(
      "1991-default",
      { "2019-default": "modern", "1991-default": "authored" },
      "seedXX:xxRegions"
    );
    expect(getPresetFallbacks()).toEqual([]);
  });

  it("does NOT record an explicit mapping to the modern bundle", () => {
    // `"1979-default": trRegions` is an authoring DECISION — the era genuinely
    // uses the modern data. Recording it would bury the real gaps in noise.
    selectPresetBundle(
      "1979-default",
      { "2019-default": "modern", "1979-default": "modern" },
      "seedTR:trRegions"
    );
    expect(getPresetFallbacks()).toEqual([]);
  });

  it("does NOT record the 2019-era aliases — they ARE that era", () => {
    for (const preset of ["2019-default", "empty", "2019-no-parties"]) {
      selectPresetBundle(preset, { "2019-default": "modern" }, "seedXX:xxRegions");
    }
    expect(getPresetFallbacks()).toEqual([]);
  });

  it("records for the optional variant only when given a label", () => {
    selectPresetBundleOptional("1953-default", { "2019-default": "modern" });
    expect(getPresetFallbacks()).toEqual([]);
    selectPresetBundleOptional("1953-default", { "2019-default": "modern" }, "page:regionMetrics");
    expect(getPresetFallbacks()).toEqual([{ label: "page:regionMetrics", preset: "1953-default" }]);
  });
});
