import { describe, expect, it } from "vitest";
import {
  DAILY_RESET_TIMEZONE,
  getCalendarDayInTimezone,
  shouldApplyDailyReset,
} from "./dailyReset";

describe("getCalendarDayInTimezone", () => {
  it("returns the Eastern calendar day for a UTC instant", () => {
    // 04:30 UTC on Jan 15 is still Jan 14 in New York (EST, UTC-5).
    expect(getCalendarDayInTimezone(new Date("2026-01-15T04:30:00.000Z"))).toBe("2026-01-14");
    // 06:00 UTC on Jan 15 is Jan 15 in New York.
    expect(getCalendarDayInTimezone(new Date("2026-01-15T06:00:00.000Z"))).toBe("2026-01-15");
  });

  it("uses America/New_York by default", () => {
    expect(getCalendarDayInTimezone(new Date("2026-01-15T05:30:00.000Z"))).toBe("2026-01-15");
    expect(DAILY_RESET_TIMEZONE).toBe("America/New_York");
  });
});

describe("shouldApplyDailyReset", () => {
  it("requires a reset when no prior reset day is stored", () => {
    expect(shouldApplyDailyReset(undefined, new Date("2026-06-03T15:00:00.000Z"))).toBe(true);
    expect(shouldApplyDailyReset(null, new Date("2026-06-03T15:00:00.000Z"))).toBe(true);
  });

  it("skips reset when already reset for the current Eastern day", () => {
    expect(shouldApplyDailyReset("2026-06-03", new Date("2026-06-03T15:00:00.000Z"))).toBe(false);
  });

  it("requires a reset after midnight Eastern rolls to a new day", () => {
    expect(shouldApplyDailyReset("2026-06-02", new Date("2026-06-03T05:00:00.000Z"))).toBe(true);
  });
});
