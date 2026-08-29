import { describe, it, expect } from "vitest";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import {
  calendarTurn,
  formatGameMonth,
  yearOfTurn,
  gameDateAnchorFromState,
  turnToGameMonth,
  type GameDateAnchor,
} from "./gameDate";

describe("calendarTurn (pre-iteration date clock)", () => {
  it("is the identity on normal worlds (no clock)", () => {
    for (const t of [1, 2, 48, 100, 500]) {
      expect(calendarTurn(t)).toBe(t);
      expect(calendarTurn(t, {})).toBe(t);
    }
  });

  it("pins to the era start (turn 1) while the pre-iteration is active", () => {
    // Turn counter advances 1..N but the calendar turn stays 1 the whole time.
    for (const t of [1, 5, 30, 200]) {
      expect(calendarTurn(t, { preIterationActive: true })).toBe(1);
      // preIterationTurns is ignored while active — the pin wins.
      expect(calendarTurn(t, { preIterationActive: true, preIterationTurns: 12 })).toBe(1);
    }
  });

  it("resumes at the era start once the offset is finalized", () => {
    // Founding completed on raw turn 25 → offset = 24. Calendar resumes at 1.
    const off = 24;
    expect(calendarTurn(25, { preIterationTurns: off })).toBe(1);
    expect(calendarTurn(26, { preIterationTurns: off })).toBe(2);
    expect(calendarTurn(25 + 48, { preIterationTurns: off })).toBe(49);
  });

  it("clamps to at least 1 (never negative)", () => {
    expect(calendarTurn(3, { preIterationTurns: 10 })).toBe(1);
  });

  it("keeps the displayed year pinned to the era start during pre-iteration", () => {
    // 1991 world, raw turn 100 (>2 game-years of turns) but date pinned to 1991.
    const raw = 100;
    const cal = calendarTurn(raw, { preIterationActive: true });
    expect(turnToGameMonth(cal, 1991)).toEqual({ year: 1991, month: 0 });
  });
});

describe("formatGameMonth (career-history display)", () => {
  const lastTurnProcessed = new Date("2026-08-17T19:00:00.000Z");

  // Live 1953 world shape behind ticket #1126: raw turn 194, year 1956 on the
  // status bar (calendarTurn 146 after a 48-turn founding offset). Career
  // history was converting wall-clock dates through the RAW turn, so a "now"
  // event rendered Jan 1957 — a year ahead of the clock, and later than early
  // tenures that still landed in 1953.
  const liveAnchor: GameDateAnchor = {
    currentTurn: 194,
    lastTurnProcessed,
    startingYear: 1953,
    preIterationTurns: 48,
  };

  function hoursAgo(hours: number): Date {
    return new Date(lastTurnProcessed.getTime() - hours * MS_PER_TURN);
  }

  it("is identity on worlds with no founding offset", () => {
    const anchor: GameDateAnchor = {
      currentTurn: 194,
      lastTurnProcessed,
      startingYear: 1953,
    };
    expect(formatGameMonth(lastTurnProcessed, anchor)).toBe("Jan 1957");
  });

  it("renders a current event on the same calendar month as the status bar", () => {
    expect(formatGameMonth(lastTurnProcessed, liveAnchor)).toBe("Jan 1956");
  });

  it("does not leave early tenures in a different year than recent ones", () => {
    // Raw turn 1 (193 hours ago) is still inside the founding offset, so it
    // clamps to calendar turn 1 — Jan 1953, not Jun 1953.
    expect(formatGameMonth(hoursAgo(193), liveAnchor)).toBe("Jan 1953");
    expect(formatGameMonth(lastTurnProcessed, liveAnchor)).toBe("Jan 1956");
  });

  it("pins every event to the era start while founding is still active", () => {
    const founding: GameDateAnchor = {
      ...liveAnchor,
      preIterationActive: true,
      preIterationTurns: 0,
    };
    expect(formatGameMonth(lastTurnProcessed, founding)).toBe("Jan 1953");
    expect(formatGameMonth(hoursAgo(50), founding)).toBe("Jan 1953");
  });
});

describe("gameDateAnchorFromState", () => {
  it("copies the pre-iteration clock onto the display anchor", () => {
    const lastTurnProcessed = new Date("2026-08-17T19:00:00.000Z");
    expect(
      gameDateAnchorFromState({
        currentTurn: 194,
        lastTurnProcessed,
        startingYear: 1953,
        preIterationTurns: 48,
        preIteration: { active: false },
      })
    ).toEqual({
      currentTurn: 194,
      lastTurnProcessed,
      startingYear: 1953,
      preIterationTurns: 48,
      preIterationActive: false,
    });
  });
});

describe("yearOfTurn", () => {
  it("is the identity on a world with no founding phase", () => {
    expect(yearOfTurn(1, 1953)).toBe(1953);
    expect(yearOfTurn(48, 1953)).toBe(1953);
    expect(yearOfTurn(49, 1953)).toBe(1954);
  });

  it("shifts the year back by the founding-phase offset", () => {
    // Live world 2026-08-28: currentTurn 463, startingYear 1953,
    // preIterationTurns 48. The status bar reads 1961, so anything scheduled
    // off the raw turn (which lands on 1962) is a full game year early.
    expect(yearOfTurn(463, 1953)).toBe(1962);
    expect(yearOfTurn(463, 1953, { preIterationTurns: 48 })).toBe(1961);
  });

  it("pins to the era start while the founding phase is active", () => {
    expect(yearOfTurn(400, 1953, { preIterationActive: true })).toBe(1953);
  });

  it("never returns a year before the era start", () => {
    expect(yearOfTurn(3, 1953, { preIterationTurns: 48 })).toBe(1953);
  });
});
