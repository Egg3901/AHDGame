import { describe, expect, it } from "vitest";
import type { CalendarWave } from "./PrimaryCalendar";

describe("CalendarWave shape", () => {
  it("supports past + upcoming rows with the documented fields", () => {
    const past: CalendarWave = {
      label: "Iowa Caucus",
      turnsRemaining: 5,
      isPast: true,
      stateIds: ["IA"],
    };
    const upcoming: CalendarWave = {
      label: "Super Tuesday",
      turnsRemaining: 2,
      isPast: false,
      stateIds: ["AL", "AR", "CA"],
    };
    expect(past.isPast).toBe(true);
    expect(upcoming.isPast).toBe(false);
    expect(upcoming.stateIds).toContain("CA");
  });

  it("higher turnsRemaining means earlier in the primary (T-5 fires before T-0)", () => {
    const earliest: CalendarWave = {
      label: "Iowa",
      turnsRemaining: 5,
      isPast: false,
      stateIds: ["IA"],
    };
    const latest: CalendarWave = {
      label: "Closing Wave",
      turnsRemaining: 0,
      isPast: false,
      stateIds: ["NY", "PA"],
    };
    expect(earliest.turnsRemaining).toBeGreaterThan(latest.turnsRemaining);
  });

  it("a wave with empty stateIds is structurally valid (renders empty row)", () => {
    const empty: CalendarWave = {
      label: "Stub",
      turnsRemaining: 4,
      isPast: false,
      stateIds: [],
    };
    expect(empty.stateIds).toEqual([]);
  });
});
