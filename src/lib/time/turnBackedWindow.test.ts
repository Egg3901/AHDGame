import { describe, expect, it } from "vitest";
import { createTurnBackedWindow, hasTurnBackedWindowClosed } from "./turnBackedWindow";

describe("turnBackedWindow", () => {
  it("creates matching turn and time bounds from the same reference clock", () => {
    const referenceNow = new Date("2026-04-29T21:00:00.000Z");

    const window = createTurnBackedWindow({
      currentTurn: 449,
      durationTurns: 96,
      effectiveNow: referenceNow,
    });

    expect(window.startTurn).toBe(449);
    expect(window.endTurn).toBe(545);
    expect(window.startTime.toISOString()).toBe("2026-04-29T21:00:00.000Z");
    expect(window.endTime.toISOString()).toBe("2026-05-03T21:00:00.000Z");
  });

  it("closes purely on the turn deadline, ignoring wall-clock endTime", () => {
    const effectiveNow = new Date("2026-04-29T21:00:00.000Z");

    // Turn reached → closed.
    expect(
      hasTurnBackedWindowClosed(
        {
          endTurn: 454,
          endTime: new Date("2026-04-29T22:00:00.000Z"),
        },
        454,
        effectiveNow
      )
    ).toBe(true);

    // endTime already passed but turns remain → STILL OPEN. The wall-clock
    // endTime must never resolve a window early; turn cadence is not 1/hour.
    expect(
      hasTurnBackedWindowClosed(
        {
          endTurn: 500,
          endTime: new Date("2026-04-29T20:00:00.000Z"),
        },
        449,
        effectiveNow
      )
    ).toBe(false);

    // Both in the future → open.
    expect(
      hasTurnBackedWindowClosed(
        {
          endTurn: 500,
          endTime: new Date("2026-04-29T22:00:00.000Z"),
        },
        449,
        effectiveNow
      )
    ).toBe(false);
  });
});
