import { describe, expect, it } from "vitest";
import {
  getDefaultPrimaryAllocation,
  getPrimaryWaveSchedule,
  getAllStaggerStates,
  GOP_DEFAULT_ALLOCATION,
  GOP_HYBRID_STATES,
  PRIMARY_WAVES,
  PRIMARY_WAVES_STRETCHED,
  STAGGER_WINDOW_TURNS,
  STAGGER_WINDOW_TURNS_STRETCHED,
} from "./primaryCalendar";
import { presidentialRulesetFor } from "@/lib/elections/presidentialRuleset";

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

describe("getPrimaryWaveSchedule", () => {
  it("resolves compressed for v1 and v2 (unstamped / pre-rework live races)", () => {
    const v1 = getPrimaryWaveSchedule(presidentialRulesetFor({ rulesetVersion: 1 }));
    const v2 = getPrimaryWaveSchedule(presidentialRulesetFor({ rulesetVersion: 2 }));
    expect(v1.waves).toBe(PRIMARY_WAVES);
    expect(v1.windowTurns).toBe(STAGGER_WINDOW_TURNS);
    expect(v2.waves).toBe(PRIMARY_WAVES);
    expect(v2.windowTurns).toBe(STAGGER_WINDOW_TURNS);
  });

  it("resolves stretched for v3 (the calendar-rework version)", () => {
    const v3 = getPrimaryWaveSchedule(presidentialRulesetFor({ rulesetVersion: 3 }));
    expect(v3.waves).toBe(PRIMARY_WAVES_STRETCHED);
    expect(v3.windowTurns).toBe(STAGGER_WINDOW_TURNS_STRETCHED);
  });

  it("unstamped races resolve to compressed (1960 protection)", () => {
    const unstamped = getPrimaryWaveSchedule(presidentialRulesetFor(undefined));
    expect(unstamped.windowTurns).toBe(STAGGER_WINDOW_TURNS);
    expect(unstamped.waves).toBe(PRIMARY_WAVES);
  });
});

describe("stretched wave schedule", () => {
  it("spaces the six waves at exactly [40, 32, 24, 16, 8, 0]", () => {
    expect(PRIMARY_WAVES_STRETCHED.map((w) => w.turnsRemaining)).toEqual([40, 32, 24, 16, 8, 0]);
  });

  it("keeps the same six waves in the same order with identical labels", () => {
    expect(PRIMARY_WAVES_STRETCHED).toHaveLength(PRIMARY_WAVES.length);
    for (let i = 0; i < PRIMARY_WAVES.length; i++) {
      expect(PRIMARY_WAVES_STRETCHED[i].label).toBe(PRIMARY_WAVES[i].label);
    }
  });

  it("has byte-identical per-wave state membership (only timing differs)", () => {
    for (let i = 0; i < PRIMARY_WAVES.length; i++) {
      expect(PRIMARY_WAVES_STRETCHED[i].states).toEqual(PRIMARY_WAVES[i].states);
    }
  });

  it("yields an identical flattened stagger-state set across schedules", () => {
    const compressed = getAllStaggerStates().slice().sort();
    const stretched = getAllStaggerStates(getPrimaryWaveSchedule({ primaryCalendar: "stretched" }))
      .slice()
      .sort();
    expect(stretched).toEqual(compressed);
  });

  it("sets windowTurns to the max offset + 1", () => {
    const maxOffset = Math.max(...PRIMARY_WAVES_STRETCHED.map((w) => w.turnsRemaining));
    expect(STAGGER_WINDOW_TURNS_STRETCHED).toBe(maxOffset + 1);
    expect(STAGGER_WINDOW_TURNS_STRETCHED).toBe(41);
  });
});
