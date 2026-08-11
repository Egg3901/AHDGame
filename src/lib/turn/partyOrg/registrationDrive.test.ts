import { describe, expect, it } from "vitest";
import {
  REG_DRIVE_MAX_BOOST_PER_STATE,
  calculateRegistrationDriveBoost,
  planRegistrationDriveDraw,
} from "./registrationDrive";

// Player suggestion #81 — voter-registration drive helpers.

describe("calculateRegistrationDriveBoost", () => {
  it("scales linearly with spend below the cap (same $/point curve as GOTV)", () => {
    // $250 per state at $5000/point = 0.05 pp, under the 0.1 cap.
    expect(calculateRegistrationDriveBoost(250, 5000)).toBeCloseTo(0.05, 6);
  });

  it("clamps to REG_DRIVE_MAX_BOOST_PER_STATE for large spend", () => {
    // $10k per state / $5000 = 2.0 pp raw → capped.
    expect(calculateRegistrationDriveBoost(10_000, 5000)).toBe(REG_DRIVE_MAX_BOOST_PER_STATE);
  });

  it("returns 0 for non-positive spend or dollars-per-point", () => {
    expect(calculateRegistrationDriveBoost(0, 5000)).toBe(0);
    expect(calculateRegistrationDriveBoost(-100, 5000)).toBe(0);
    expect(calculateRegistrationDriveBoost(250, 0)).toBe(0);
  });
});

describe("planRegistrationDriveDraw", () => {
  it("draws from unregistered first", () => {
    const draw = planRegistrationDriveDraw(0.08, 10, 5);
    expect(draw.applied).toBeCloseTo(0.08, 6);
    expect(draw.fromUnregistered).toBeCloseTo(0.08, 6);
    expect(draw.fromIndependent).toBe(0);
  });

  it("falls back to independent when unregistered is exhausted", () => {
    const draw = planRegistrationDriveDraw(0.1, 0.03, 5);
    expect(draw.applied).toBeCloseTo(0.1, 6);
    expect(draw.fromUnregistered).toBeCloseTo(0.03, 6);
    expect(draw.fromIndependent).toBeCloseTo(0.07, 6);
  });

  it("is bounded by total pool capacity so no bucket goes negative", () => {
    const draw = planRegistrationDriveDraw(0.1, 0.02, 0.01);
    expect(draw.applied).toBeCloseTo(0.03, 6);
    expect(draw.fromUnregistered).toBeCloseTo(0.02, 6);
    expect(draw.fromIndependent).toBeCloseTo(0.01, 6);
    // Sum drawn from the pool exactly equals the applied registration gain →
    // the per-state 100% pool invariant is preserved.
    expect(draw.fromUnregistered + draw.fromIndependent).toBeCloseTo(draw.applied, 6);
  });

  it("applies nothing when the pool is empty", () => {
    const draw = planRegistrationDriveDraw(0.1, 0, 0);
    expect(draw.applied).toBe(0);
    expect(draw.fromUnregistered).toBe(0);
    expect(draw.fromIndependent).toBe(0);
  });
});
