import { describe, expect, it } from "vitest";
import { corporationDissolutionAgeBlock } from "./dissolutionAgeGuard";
import { MIN_CORPORATION_DISSOLUTION_AGE_TURNS } from "../constants/corporations";

describe("corporationDissolutionAgeBlock", () => {
  it("allows dissolution once the corp is at least the minimum age", () => {
    // Founded turn 0, now turn 24 → age 24 == minimum → allowed (boundary).
    const r = corporationDissolutionAgeBlock(0, MIN_CORPORATION_DISSOLUTION_AGE_TURNS);
    expect(r.blocked).toBe(false);
    expect(r.turnsRemaining).toBe(0);
  });

  it("allows dissolution well past the minimum age", () => {
    const r = corporationDissolutionAgeBlock(0, 100);
    expect(r.blocked).toBe(false);
    expect(r.turnsRemaining).toBe(0);
  });

  it("blocks dissolution one turn before the minimum age", () => {
    // Founded turn 1, now turn 24 → age 23 → 1 turn remaining.
    const r = corporationDissolutionAgeBlock(1, MIN_CORPORATION_DISSOLUTION_AGE_TURNS);
    expect(r.blocked).toBe(true);
    expect(r.turnsRemaining).toBe(1);
  });

  it("blocks a freshly founded corp with the full window remaining", () => {
    const r = corporationDissolutionAgeBlock(24, 24);
    expect(r.blocked).toBe(true);
    expect(r.turnsRemaining).toBe(MIN_CORPORATION_DISSOLUTION_AGE_TURNS);
  });

  it("exempts legacy corps with no foundedAtTurn", () => {
    expect(corporationDissolutionAgeBlock(undefined, 5)).toEqual({
      blocked: false,
      turnsRemaining: 0,
    });
    expect(corporationDissolutionAgeBlock(null, 5)).toEqual({
      blocked: false,
      turnsRemaining: 0,
    });
  });
});
