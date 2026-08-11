import { describe, expect, it } from "vitest";
import { isWithinRegistrationBackfillWindow } from "./route";

const HOUR = 60 * 60 * 1000;

describe("isWithinRegistrationBackfillWindow", () => {
  const now = new Date("2026-08-09T12:00:00.000Z");

  it("allows a backfill moments after signup (the OAuth result-page case)", () => {
    expect(isWithinRegistrationBackfillWindow(new Date(now.getTime() - 30_000), now)).toBe(true);
  });

  it("allows a backfill just inside 24h", () => {
    expect(isWithinRegistrationBackfillWindow(new Date(now.getTime() - 23 * HOUR), now)).toBe(true);
  });

  it("refuses a backfill for an account older than 24h", () => {
    expect(isWithinRegistrationBackfillWindow(new Date(now.getTime() - 25 * HOUR), now)).toBe(
      false
    );
  });

  it("refuses when createdAt is missing rather than defaulting to allow", () => {
    expect(isWithinRegistrationBackfillWindow(undefined, now)).toBe(false);
  });
});
