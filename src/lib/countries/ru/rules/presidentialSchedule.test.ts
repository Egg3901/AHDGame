import { describe, expect, it } from "vitest";
import { planRussianPresidentialBallot as plan } from "./presidentialSchedule";
describe("Russian presidential ballot windows", () => {
  it("uses a three-month first-ballot window and closes filing two turns before counting ends", () => {
    expect(plan(48, "first")).toEqual({
      startTurn: 48,
      primaryEndTurn: 58,
      endTurn: 60,
      durationHours: 12,
      primaryDurationHours: 10,
    });
  });
  it("opens a fresh two-week runoff without new filing", () => {
    expect(plan(60, "runoff")).toEqual({
      startTurn: 60,
      primaryEndTurn: 60,
      endTurn: 62,
      durationHours: 2,
      primaryDurationHours: 0,
    });
  });
  it("reopens filing for a repeated election within two months", () => {
    expect(plan(62, "repeat")).toEqual({
      startTurn: 62,
      primaryEndTurn: 68,
      endTurn: 70,
      durationHours: 8,
      primaryDurationHours: 6,
    });
  });
  it.each([0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER])(
    "rejects an invalid or overflowing raw turn %s",
    (turn) => expect(() => plan(turn, "first")).toThrow()
  );
});
