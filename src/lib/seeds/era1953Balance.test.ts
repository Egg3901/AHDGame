import { describe, it, expect } from "vitest";
import {
  deriveGranularElectorateUnits,
  clearGranularElectorateCache,
} from "@/lib/demographics/granularElectorate";

/**
 * Guards the 1953 electorate calibration (2026-08, compressed): per-state
 * white positions in STATE_POSITION_OVERRIDES["1953"] are solved against a
 * COMPRESSED 1952 two-party vote — target mean = -(0.5*margin + 2.5)/30, with
 * the Deep South floored at -0.5 — via scripts/calibrate-1953-state-positions.ts.
 * The half-scale margin plus a small Democratic offset keeps the historical
 * SHAPE (Solid South Democratic, Plains/N.New England Republican, Ike tilt
 * nationally) while pulling most states into a competitive belt, so the
 * long-iteration 1953 world starts gameplay-balanced instead of reproducing
 * the full Eisenhower landslide. Bands are loose enough to survive small
 * retunes but tight enough to catch a recentring regression like the
 * pre-2026-08 one (every Ike state sat left of centre and the sim re-elected
 * Democrats through the 1950s).
 */
function meanEcon(stateId: string): number {
  clearGranularElectorateCache();
  const derived = deriveGranularElectorateUnits("US", stateId, "1953-default", null);
  expect(derived, `${stateId} should have a 1953 census`).not.toBeNull();
  let num = 0;
  let den = 0;
  for (const u of derived!.units) {
    const w = u.share * u.turnout;
    num += w * u.economicLean;
    den += w;
  }
  return num / den;
}

describe("1953 electorate calibration (1952 vote anchors)", () => {
  it("keeps the Solid South Democratic", () => {
    for (const s of ["AL", "MS", "SC", "GA"]) {
      expect(meanEcon(s), s).toBeLessThan(-0.4);
    }
  });

  it("puts the peripheral South mildly Republican (Ike cracked it in '52)", () => {
    for (const s of ["TX", "FL", "VA"]) {
      const m = meanEcon(s);
      expect(m, s).toBeGreaterThan(0);
      expect(m, s).toBeLessThan(0.4);
    }
  });

  it("gives the Ike-landslide Northeast/Midwest a mild Republican mean", () => {
    // PA/MA sit just right of centre by design (1952 R+5.9 / R+8.8 compress
    // to near-even targets); the rest carry a clear but moderate Ike tilt.
    for (const s of ["NY", "MA", "PA", "OH", "MI", "WI"]) {
      expect(meanEcon(s), s).toBeGreaterThan(-0.02);
      expect(meanEcon(s), s).toBeLessThan(0.45);
    }
    for (const s of ["NY", "OH", "MI", "WI", "MN", "IN"]) {
      expect(meanEcon(s), s).toBeGreaterThan(0.05);
    }
  });

  it("keeps the Plains/Mountain heartland clearly Republican", () => {
    for (const s of ["ND", "KS", "NE", "SD", "ID"]) {
      expect(meanEcon(s), s).toBeGreaterThan(0.4);
    }
    for (const s of ["WY", "MT", "CO", "VT", "ME"]) {
      expect(meanEcon(s), s).toBeGreaterThan(0.2);
    }
  });

  it("lands the sample aggregate near even (compressed calibration)", () => {
    const sample = [
      "AL",
      "MS",
      "SC",
      "TX",
      "FL",
      "NC",
      "OH",
      "PA",
      "WI",
      "MI",
      "NY",
      "MA",
      "CA",
      "CO",
      "WY",
      "VA",
      "MN",
      "IL",
    ];
    // The sample is South-weighted (3 Deep South states of 18), so its mean
    // sits near zero even though the national tilt is mildly Republican.
    const mean = sample.reduce((a, s) => a + meanEcon(s), 0) / sample.length;
    expect(mean).toBeGreaterThan(-0.1);
    expect(mean).toBeLessThan(0.25);
  });

  it("keeps a mild Republican tilt outside the South", () => {
    const north = [
      "NY",
      "MA",
      "PA",
      "OH",
      "MI",
      "WI",
      "CA",
      "CO",
      "WY",
      "MN",
      "IL",
      "VA",
      "FL",
      "TX",
    ];
    const mean = north.reduce((a, s) => a + meanEcon(s), 0) / north.length;
    expect(mean).toBeGreaterThan(0.05);
    expect(mean).toBeLessThan(0.3);
  });
});
