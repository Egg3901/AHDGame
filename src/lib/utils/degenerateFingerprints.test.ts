import { describe, expect, it } from "vitest";
import { DEGENERATE_FINGERPRINTS, isDegenerateFingerprint } from "./degenerateFingerprints";

describe("isDegenerateFingerprint", () => {
  it("treats every known placeholder as degenerate", () => {
    for (const value of ["", "server-side", "unknown", "error", "not-supported"]) {
      expect(isDegenerateFingerprint(value)).toBe(true);
    }
  });

  it("treats null and undefined as degenerate", () => {
    expect(isDegenerateFingerprint(null)).toBe(true);
    expect(isDegenerateFingerprint(undefined)).toBe(true);
  });

  it("treats a real hash as non-degenerate", () => {
    expect(isDegenerateFingerprint("51275d91aa762657ccb6cd12bd14c178")).toBe(false);
  });

  it("exports the set so callers can enumerate it", () => {
    expect(DEGENERATE_FINGERPRINTS.has("server-side")).toBe(true);
    expect(DEGENERATE_FINGERPRINTS.size).toBe(5);
  });
});
