import { describe, expect, it } from "vitest";
import {
  CARRY_THRESHOLD,
  LADDER_DECAY_TURNS,
  LADDER_RUNGS,
  LOCK_THRESHOLD,
  MAX_COERCIVE_RUNG,
} from "@/lib/constants/settlementCrisis";
import { defconFor, isArmed, nextHeat, outcomeFor } from "./outcome";

describe("outcomeFor", () => {
  it("carries for the challenger at or above the carry threshold", () => {
    expect(outcomeFor(CARRY_THRESHOLD)).toBe("challenger");
    expect(outcomeFor(CARRY_THRESHOLD + 1)).toBe("challenger");
  });

  it("locks for the incumbent at or below the lock threshold", () => {
    expect(outcomeFor(LOCK_THRESHOLD)).toBe("incumbent");
    expect(outcomeFor(LOCK_THRESHOLD - 1)).toBe("incumbent");
  });

  it("returns null between the thresholds", () => {
    expect(outcomeFor(CARRY_THRESHOLD - 1)).toBeNull();
    expect(outcomeFor(LOCK_THRESHOLD + 1)).toBeNull();
    expect(outcomeFor(3820)).toBeNull();
  });
});

describe("nextHeat", () => {
  it("adds a rung per coercive play", () => {
    expect(nextHeat({ current: 1, added: 2 })).toEqual({ heat: 3, quietTurns: 0 });
  });

  it("caps coercive heat at rung 4, short of the armed rung", () => {
    // Rung 5 is reached only by an authority seat deliberately forcing it.
    expect(nextHeat({ current: 4, added: 3 }).heat).toBe(MAX_COERCIVE_RUNG);
    expect(nextHeat({ current: 3, added: 5 }).heat).toBe(MAX_COERCIVE_RUNG);
  });

  it("does not decay on the first quiet turn — decay is slower than the climb", () => {
    expect(nextHeat({ current: 3, added: 0 })).toEqual({ heat: 3, quietTurns: 1 });
  });

  it("decays a rung once the quiet run reaches the grace", () => {
    expect(nextHeat({ current: 3, added: 0, quietTurns: LADDER_DECAY_TURNS - 1 })).toEqual({
      heat: 2,
      quietTurns: 0,
    });
  });

  it("does not decay below zero", () => {
    expect(nextHeat({ current: 0, added: 0, quietTurns: LADDER_DECAY_TURNS - 1 }).heat).toBe(0);
  });

  it("holds an armed ladder at 5 rather than dragging it down to the coercive cap", () => {
    expect(nextHeat({ current: 5, added: 1 })).toEqual({ heat: 5, quietTurns: 0 });
  });

  it("gives every rung a grace before it slips, so a standoff is a place", () => {
    // Derived from the constant rather than frozen at one tuning: the whole
    // point of the grace is that it is a dial.
    let quietTurns = 0;
    for (let quiet = 1; quiet < LADDER_DECAY_TURNS; quiet++) {
      const step = nextHeat({ current: 5, added: 0, quietTurns });
      expect(step.heat).toBe(5);
      expect(step.quietTurns).toBe(quiet);
      quietTurns = step.quietTurns;
    }
    // The turn the grace runs out, it slips to the coercive cap.
    expect(nextHeat({ current: 5, added: 0, quietTurns })).toEqual({
      heat: MAX_COERCIVE_RUNG,
      quietTurns: 0,
    });
  });

  it("resets the quiet counter on any coercive play, so the grace is consecutive", () => {
    expect(nextHeat({ current: 5, added: 1, quietTurns: LADDER_DECAY_TURNS - 1 })).toEqual({
      heat: 5,
      quietTurns: 0,
    });
  });

  it("reads a crisis written before the counter existed as never having been quiet", () => {
    // One turn of grace it was never promised is the acceptable direction to
    // err; silently slipping a live standoff is not.
    expect(nextHeat({ current: 5, added: 0 }).quietTurns).toBe(1);
  });

  it("walks a long silence down one rung per grace rather than emptying at once", () => {
    let state = { heat: 4, quietTurns: 0 };
    for (let i = 0; i < LADDER_DECAY_TURNS; i++) {
      state = nextHeat({ current: state.heat, added: 0, quietTurns: state.quietTurns });
    }
    expect(state).toEqual({ heat: 3, quietTurns: 0 });
  });
});

describe("defconFor", () => {
  it("counts down from 5 as heat rises", () => {
    expect(defconFor(0)).toBe(5);
    expect(defconFor(1)).toBe(5);
    expect(defconFor(2)).toBe(4);
    expect(defconFor(5)).toBe(1);
  });

  it("floors at DEFCON 1", () => {
    expect(defconFor(9)).toBe(1);
  });
});

describe("isArmed", () => {
  it("is armed only at the top rung", () => {
    expect(isArmed(LADDER_RUNGS.length)).toBe(true);
    expect(isArmed(LADDER_RUNGS.length - 1)).toBe(false);
  });
});
