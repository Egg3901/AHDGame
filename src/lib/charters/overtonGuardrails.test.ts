import { describe, expect, it } from "vitest";
import {
  PLATFORM_AXIS_MAX,
  PLATFORM_AXIS_MIN,
  clampPlatform,
  clampPlatformAxis,
} from "./overtonGuardrails";

describe("clampPlatformAxis", () => {
  it("returns values within [-60, 60] unchanged", () => {
    expect(clampPlatformAxis(0)).toBe(0);
    expect(clampPlatformAxis(30)).toBe(30);
    expect(clampPlatformAxis(-30)).toBe(-30);
    expect(clampPlatformAxis(60)).toBe(60);
    expect(clampPlatformAxis(-60)).toBe(-60);
  });

  it("clamps above max", () => {
    expect(clampPlatformAxis(100)).toBe(PLATFORM_AXIS_MAX);
    expect(clampPlatformAxis(60.5)).toBe(PLATFORM_AXIS_MAX);
  });

  it("clamps below min", () => {
    expect(clampPlatformAxis(-100)).toBe(PLATFORM_AXIS_MIN);
    expect(clampPlatformAxis(-60.5)).toBe(PLATFORM_AXIS_MIN);
  });

  it("treats non-finite as 0", () => {
    expect(clampPlatformAxis(Number.NaN)).toBe(0);
    expect(clampPlatformAxis(Infinity)).toBe(PLATFORM_AXIS_MAX);
    expect(clampPlatformAxis(-Infinity)).toBe(PLATFORM_AXIS_MIN);
  });
});

describe("clampPlatform", () => {
  it("clamps each axis independently", () => {
    const result = clampPlatform({
      economic: 100,
      social: -100,
      foreignPolicy: 30,
      culture: -30,
    });
    expect(result.economic).toBe(60);
    expect(result.social).toBe(-60);
    expect(result.foreignPolicy).toBe(30);
    expect(result.culture).toBe(-30);
  });
});

// Post-2026-05-22 redesign: `validateAmendmentDeltas` +
// `AMENDMENT_MAX_DELTA_PER_AXIS` retired in favor of the
// CommitteeProposal positionShift flow. Tests for the ±10/axis cap
// removed because the cap no longer applies.
