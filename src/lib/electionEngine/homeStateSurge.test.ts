import { describe, expect, it } from "vitest";
import { PRIMARY_HOME_SURGE_PCT, homeStateSurgeMultiplier } from "./constants";

/**
 * The home-state surge charged funds and actions and moved no votes: the route
 * wrote `primarySurgeBoost` on the candidate and nothing read it. This is the
 * rule both the stagger phase and the projection now apply.
 */
describe("homeStateSurgeMultiplier", () => {
  it("lifts the candidate in their own home state", () => {
    expect(
      homeStateSurgeMultiplier({
        surgeUsed: true,
        surgeBoostPct: 15,
        homeState: "IA",
        stateId: "IA",
      })
    ).toBeCloseTo(1.15, 10);
  });

  it("does nothing anywhere else", () => {
    expect(
      homeStateSurgeMultiplier({
        surgeUsed: true,
        surgeBoostPct: 15,
        homeState: "IA",
        stateId: "OH",
      })
    ).toBe(1);
  });

  it("does nothing for a candidate with no home state", () => {
    expect(
      homeStateSurgeMultiplier({
        surgeUsed: true,
        surgeBoostPct: 15,
        homeState: null,
        stateId: "IA",
      })
    ).toBe(1);
  });

  it("does nothing once the cycle has cleared the flag", () => {
    // Primary resolution clears primarySurgeUsed and leaves the stored rate
    // behind, so a rule keyed on the rate alone would boost for ever.
    expect(
      homeStateSurgeMultiplier({
        surgeUsed: false,
        surgeBoostPct: 15,
        homeState: "IA",
        stateId: "IA",
      })
    ).toBe(1);
  });

  it("honours the rate the surge was bought at", () => {
    expect(
      homeStateSurgeMultiplier({
        surgeUsed: true,
        surgeBoostPct: 30,
        homeState: "IA",
        stateId: "IA",
      })
    ).toBeCloseTo(1.3, 10);
  });

  it("falls back to the current rate for a row stored before one was recorded", () => {
    expect(
      homeStateSurgeMultiplier({ surgeUsed: true, homeState: "IA", stateId: "IA" })
    ).toBeCloseTo(1 + PRIMARY_HOME_SURGE_PCT / 100, 10);
  });

  it("is a no-op for a candidate who never surged", () => {
    expect(homeStateSurgeMultiplier({ homeState: "IA", stateId: "IA" })).toBe(1);
  });
});
