import { describe, expect, it } from "vitest";
import { STARTING_YEAR, getStartingYearForPreset } from "./turnTime";
import { getCycleAnchors } from "@/lib/elections/cycleAnchorContext";

describe("getStartingYearForPreset", () => {
  it("every era preset returns its own starting year", () => {
    // Regression: 1999/2007/2023 were missing branches and fell through to
    // 2019, which desynced GameState.startingYear from the preset era and
    // corrupted every cycle-anchor computation for those worlds.
    expect(getStartingYearForPreset("1953-default")).toBe(1953);
    expect(getStartingYearForPreset("1979-default")).toBe(1979);
    expect(getStartingYearForPreset("1991-default")).toBe(1991);
    expect(getStartingYearForPreset("1999-default")).toBe(1999);
    expect(getStartingYearForPreset("2007-default")).toBe(2007);
    expect(getStartingYearForPreset("2019-default")).toBe(2019);
    expect(getStartingYearForPreset("2023-default")).toBe(2023);
  });

  it("1991-default → 1991", () => {
    expect(getStartingYearForPreset("1991-default")).toBe(1991);
  });

  it("2019-default → STARTING_YEAR (2019)", () => {
    expect(getStartingYearForPreset("2019-default")).toBe(STARTING_YEAR);
    expect(getStartingYearForPreset("2019-default")).toBe(2019);
  });

  it("1999-default cycle anchors are all positive turn numbers", () => {
    // With the missing branch, a 1999 world could pair era election years with
    // a 2019 startingYear and compute negative endTurns (e.g. endOfYear(2000,
    // 2019) = -864). With startingYear correctly 1999, every anchor — even via
    // the 2019-default election-year fallback — must land strictly in the
    // future.
    const anchors = getCycleAnchors({
      startingYear: getStartingYearForPreset("1999-default"),
      preset: "1999-default",
    });
    for (const [key, turn] of Object.entries(anchors)) {
      if (turn == null) continue; // deliberate era-gates (esCongreso)
      expect(turn, `${key} anchor (${turn}) must be positive`).toBeGreaterThan(0);
    }
  });

  it("empty preset falls back to STARTING_YEAR", () => {
    expect(getStartingYearForPreset("empty")).toBe(STARTING_YEAR);
  });

  it("2019-no-parties falls back to STARTING_YEAR", () => {
    expect(getStartingYearForPreset("2019-no-parties")).toBe(STARTING_YEAR);
  });

  it("unknown preset id falls back to STARTING_YEAR (safe default)", () => {
    expect(getStartingYearForPreset("nonexistent-foo")).toBe(STARTING_YEAR);
  });
});
