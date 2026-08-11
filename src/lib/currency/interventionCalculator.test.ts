import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { computeInterventionPressure, breachDistance, isInBand } from "./interventionCalculator";
import type { InterventionPolicy } from "@/lib/db/types/exchangeRate";

const band = (floor: number, ceiling: number): InterventionPolicy => ({
  floor,
  ceiling,
  setByCharacterId: new ObjectId(),
  setByCharacterName: "test",
  setAtTurn: 0,
  lastAdjustedAtTurn: 0,
  recentInterventions: [],
});

describe("isInBand", () => {
  it("returns true when rate is inside the band", () => {
    expect(isInBand(100, band(95, 110))).toBe(true);
  });
  it("returns true at exact bounds", () => {
    expect(isInBand(95, band(95, 110))).toBe(true);
    expect(isInBand(110, band(95, 110))).toBe(true);
  });
  it("returns false when rate is above ceiling", () => {
    expect(isInBand(112, band(95, 110))).toBe(false);
  });
  it("returns false when rate is below floor", () => {
    expect(isInBand(90, band(95, 110))).toBe(false);
  });
});

describe("breachDistance", () => {
  it("returns 0 when rate is in band", () => {
    expect(breachDistance(100, band(95, 110))).toBe(0);
  });
  it("returns positive fraction when rate above ceiling (needs sell pressure)", () => {
    const d = breachDistance(115.5, band(95, 110));
    expect(d).toBeCloseTo(0.05, 5);
  });
  it("returns negative fraction when rate below floor (needs buy pressure)", () => {
    const d = breachDistance(90.25, band(95, 110));
    expect(d).toBeCloseTo(-0.05, 5);
  });
});

describe("computeInterventionPressure", () => {
  it("returns zero spend when rate is in band", () => {
    const r = computeInterventionPressure(100, band(95, 110), 1_000_000);
    expect(r.syntheticVolume).toBe(0);
    expect(r.reserveCost).toBe(0);
    expect(r.direction).toBe("none");
  });

  it("generates positive synthetic volume (buy) when rate above ceiling", () => {
    // rate above ceiling → currency too weak → CB buys home currency → positive volume
    const r = computeInterventionPressure(115.5, band(95, 110), 1_000_000);
    expect(r.syntheticVolume).toBeGreaterThan(0);
    expect(r.direction).toBe("buy");
  });

  it("generates negative synthetic volume (sell) when rate below floor", () => {
    const r = computeInterventionPressure(90.25, band(95, 110), 1_000_000);
    expect(r.syntheticVolume).toBeLessThan(0);
    expect(r.direction).toBe("sell");
  });

  it("truncates spend to available reserves", () => {
    const r = computeInterventionPressure(120, band(95, 110), 500);
    expect(r.reserveCost).toBe(500);
    expect(Math.abs(r.syntheticVolume)).toBe(500);
  });

  it("returns zero when reserves are zero even with active breach", () => {
    const r = computeInterventionPressure(120, band(95, 110), 0);
    expect(r.syntheticVolume).toBe(0);
    expect(r.reserveCost).toBe(0);
    expect(r.direction).toBe("none");
  });
});
