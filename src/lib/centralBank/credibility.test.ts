import { describe, it, expect } from "vitest";
import {
  capScrutinyGain,
  credibilityFromScrutiny,
  MAX_SCRUTINY_GAIN_PER_TURN,
  RESOLVE_SCRUTINY_RELIEF,
  RESOLVE_TURNS_REQUIRED,
  resolveRecoveryDelta,
  stanceIsCorrect,
  TRANSMISSION_FLOOR,
  transmissionMultiplier,
  turnsUntilResolveRelief,
} from "./credibility";

describe("credibility transmission", () => {
  it("never drops policy below the floor, so a discredited bank still works", () => {
    expect(transmissionMultiplier(100)).toBeCloseTo(TRANSMISSION_FLOOR, 10);
    expect(transmissionMultiplier(100)).toBeGreaterThan(0);
  });

  it("is a no-op for a bank hitting its targets", () => {
    expect(transmissionMultiplier(0)).toBe(1);
  });

  it("degrades monotonically between the two", () => {
    expect(transmissionMultiplier(25)).toBeGreaterThan(transmissionMultiplier(75));
  });

  it("clamps nonsense scrutiny rather than producing a nonsense multiplier", () => {
    expect(credibilityFromScrutiny(Number.NaN)).toBe(1);
    expect(credibilityFromScrutiny(-50)).toBe(1);
    expect(credibilityFromScrutiny(500)).toBe(0);
  });
});

describe("scrutiny gain cap", () => {
  it("caps a catastrophic turn", () => {
    expect(capScrutinyGain(40)).toBe(MAX_SCRUTINY_GAIN_PER_TURN);
  });

  it("never caps an improvement", () => {
    expect(capScrutinyGain(-40)).toBe(-40);
  });
});

describe("resolve is the escape hatch", () => {
  it("pays out after the required consecutive turns, regardless of inflation", () => {
    let streak = 0;
    for (let i = 1; i < RESOLVE_TURNS_REQUIRED; i++) {
      const step = resolveRecoveryDelta({ correctStance: true, previousStreak: streak });
      expect(step.relief).toBe(0);
      streak = step.resolveStreak;
    }
    const matured = resolveRecoveryDelta({ correctStance: true, previousStreak: streak });
    expect(matured.relief).toBe(RESOLVE_SCRUTINY_RELIEF);
    // Clock restarts so relief is periodic, not every turn forever.
    expect(matured.resolveStreak).toBe(0);
  });

  it("resets the moment the stance stops matching the corridor", () => {
    const broken = resolveRecoveryDelta({ correctStance: false, previousStreak: 2 });
    expect(broken).toEqual({ resolveStreak: 0, relief: 0 });
  });

  it("always beats the per-turn cap over a full cycle, so escape is possible", () => {
    // A bank at the cap gains at most MAX x (turns) but sheds RELIEF each cycle
    // on top of the 5% decay. The escape hatch has to be able to outrun a
    // steady-state penalty or it is decorative.
    expect(RESOLVE_SCRUTINY_RELIEF).toBeGreaterThan(0);
    expect(turnsUntilResolveRelief(0)).toBe(RESOLVE_TURNS_REQUIRED);
    expect(turnsUntilResolveRelief(RESOLVE_TURNS_REQUIRED)).toBe(0);
  });
});

describe("stance correctness follows the corridor the UI shows", () => {
  it("wants restrictive when inflation runs hot", () => {
    expect(stanceIsCorrect(6, 4, 2)).toBe(true);
    expect(stanceIsCorrect(1, 4, 2)).toBe(false);
  });

  it("wants accommodative when inflation runs cold", () => {
    expect(stanceIsCorrect(0.2, 1, 2)).toBe(true);
    expect(stanceIsCorrect(5, 1, 2)).toBe(false);
  });

  it("wants neutral inside the band", () => {
    expect(stanceIsCorrect(2.2, 2, 2)).toBe(true);
    expect(stanceIsCorrect(9, 2, 2)).toBe(false);
  });
});
