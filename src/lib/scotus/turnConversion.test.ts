import { describe, expect, it } from "vitest";
import { yearToTurn, yearFiringAtOrAfterTurn } from "./turnConversion";
import { calendarTurn } from "@/lib/utils/gameDate";

const START = 1953;

describe("yearToTurn", () => {
  it("maps an authored year onto week 1 of that year", () => {
    expect(yearToTurn(1953, START)).toBe(1);
    expect(yearToTurn(1954, START)).toBe(49);
    expect(yearToTurn(1962, START)).toBe(433);
  });
});

describe("yearFiringAtOrAfterTurn", () => {
  it("is the inverse of yearToTurn on a world with no founding phase", () => {
    // The invariant scotusDocketTurn actually applies: a case authored for the
    // returned year is due once the calendar turn reaches it.
    for (const turn of [1, 40, 49, 200, 433, 500]) {
      const year = yearFiringAtOrAfterTurn(turn, START);
      expect(yearToTurn(year, START)).toBeGreaterThanOrEqual(turn);
    }
  });

  it("holds the same invariant once a founding phase shifts the raw turn (#1208)", () => {
    const clock = { preIterationTurns: 48 };
    for (const turn of [49, 100, 481, 600]) {
      const year = yearFiringAtOrAfterTurn(turn, START, clock);
      // Compared the way the docket compares: calendar turn against yearToTurn.
      expect(yearToTurn(year, START)).toBeGreaterThanOrEqual(calendarTurn(turn, clock));
    }
  });

  it("does not schedule a challenge a full year late on a founding-phase world", () => {
    // Raw turn 481 is calendar turn 433, which IS week 1 of 1962. Inverting the
    // raw turn instead would answer 1963 and the challenge would sit for a year.
    expect(yearFiringAtOrAfterTurn(481, START, { preIterationTurns: 48 })).toBe(1962);
    expect(yearFiringAtOrAfterTurn(481, START)).toBe(1963);
  });

  it("never returns a year before the era start", () => {
    expect(yearFiringAtOrAfterTurn(1, START)).toBe(START);
    expect(yearFiringAtOrAfterTurn(-5, START)).toBe(START);
  });
});
