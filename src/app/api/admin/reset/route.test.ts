import { describe, it, expect } from "vitest";

// The actual HTTP handler is hard to unit-test in isolation; we instead test
// the validation logic directly by importing the guard.
import { isKnownPreset } from "@/lib/seeds/presetSelector";

describe("reset preset guard", () => {
  it("isKnownPreset accepts all valid preset strings", () => {
    for (const p of [
      "1979-default",
      "1991-default",
      "1999-default",
      "2007-default",
      "2019-default",
      "2023-default",
      "empty",
      "2019-no-parties",
    ]) {
      expect(isKnownPreset(p)).toBe(true);
    }
  });

  it("isKnownPreset rejects unknown strings", () => {
    for (const p of ["", "custom", "1991", "2024-default", "1991-defualt"]) {
      expect(isKnownPreset(p)).toBe(false);
    }
  });
});
