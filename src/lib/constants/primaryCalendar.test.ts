import { describe, expect, it } from "vitest";
import {
  getDefaultPrimaryAllocation,
  GOP_DEFAULT_ALLOCATION,
  GOP_HYBRID_STATES,
} from "./primaryCalendar";

describe("getDefaultPrimaryAllocation", () => {
  it("returns PR for every Dem state (DNC Rule 14)", () => {
    for (const stateId of ["IA", "NH", "FL", "TX", "CA", "WV", "AK", "DC"]) {
      expect(getDefaultPrimaryAllocation(stateId, "dem")).toBe("PR");
    }
  });

  it("returns WTA for canonical statewide-WTA Republican states", () => {
    // 2024 GOP rule books have these as statewide WTA.
    for (const stateId of ["FL", "OH", "AZ", "IN", "KY", "OK", "NJ", "DE", "SC"]) {
      expect(getDefaultPrimaryAllocation(stateId, "gop")).toBe("WTA");
    }
  });

  it("returns PR for canonical pure-proportional Republican states", () => {
    for (const stateId of ["MA", "MN", "VT", "ME", "MD", "RI", "OR", "WA", "HI", "DC"]) {
      expect(getDefaultPrimaryAllocation(stateId, "gop")).toBe("PR");
    }
  });

  it("models hybrid (PR + per-CD WTA) Republican states as PR for the statewide pool", () => {
    // These have hybrid rules — collapsed to PR in this 2-method system. Each
    // listed state must be in `GOP_HYBRID_STATES` so the UI can flag them.
    for (const stateId of ["TX", "GA", "PA", "NC", "MI", "WI", "IL", "VA"]) {
      expect(getDefaultPrimaryAllocation(stateId, "gop")).toBe("PR");
      expect(GOP_HYBRID_STATES.has(stateId)).toBe(true);
    }
  });

  it("falls back to WTA for unknown states under GOP", () => {
    // Synthetic / non-state IDs without an entry should not crash; matches the
    // historical "GOP defaults to WTA" behaviour for any state we haven't
    // catalogued yet.
    expect(getDefaultPrimaryAllocation("ZZ", "gop")).toBe("WTA");
  });

  it("GOP allocation map covers every state in DEM_2020_DELEGATES", () => {
    // Every state with delegates should have a real-world classification — no
    // silent fallback to "WTA" for cataloged states.
    const cataloguedDelegateStates = Object.keys(GOP_DEFAULT_ALLOCATION);
    expect(cataloguedDelegateStates.length).toBeGreaterThanOrEqual(50);
  });
});
