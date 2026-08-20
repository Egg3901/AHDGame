import { describe, expect, it } from "vitest";
import {
  CARRY_THRESHOLD,
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
    expect(nextHeat({ current: 1, added: 2 })).toBe(3);
  });

  it("caps coercive heat at rung 4, short of the armed rung", () => {
    // Rung 5 is reached only by an authority seat deliberately forcing it.
    expect(nextHeat({ current: 4, added: 3 })).toBe(MAX_COERCIVE_RUNG);
    expect(nextHeat({ current: 3, added: 5 })).toBe(MAX_COERCIVE_RUNG);
  });

  it("decays a rung when no coercive play landed", () => {
    expect(nextHeat({ current: 3, added: 0 })).toBe(2);
  });

  it("does not decay below zero", () => {
    expect(nextHeat({ current: 0, added: 0 })).toBe(0);
  });

  it("holds an armed ladder at 5 rather than dragging it down to the coercive cap", () => {
    expect(nextHeat({ current: 5, added: 1 })).toBe(5);
  });

  it("decays an armed ladder when nothing coercive lands", () => {
    expect(nextHeat({ current: 5, added: 0 })).toBe(4);
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
