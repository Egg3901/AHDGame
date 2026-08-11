import { describe, it, expect } from "vitest";
import { calendarTurn, turnToGameMonth } from "./gameDate";

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
