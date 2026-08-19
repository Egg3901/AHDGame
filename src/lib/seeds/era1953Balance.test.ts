import { describe, it, expect } from "vitest";
import {
  deriveGranularElectorateUnits,
  clearGranularElectorateCache,
} from "@/lib/demographics/granularElectorate";

/**
 * Guards the SHAPE of the 1953 electorate on the granular vote path: Solid
 * South economically Democratic, Plains / Mountain / Yankee New England
 * clearly Republican, the industrial North in between, and a mild Republican
 * tilt nationally. It exists to catch a recentring regression like the
 * pre-2026-08 one (every Ike state sat left of centre and the sim re-elected
 * Democrats through the 1950s).
 *
 * 2026-08 regional recalibration: the bands were widened where they encoded
 * the superseded COMPRESSED calibration (half-scale margins, target mean
 * -(0.5*margin + 2.5)/30), which deliberately squeezed every state into a
 * narrow competitive belt. The electorate is now authored on the canonical
 * 2019 transfer ruler, so the spread is roughly twice as wide by design and a
 * ceiling like "Texas below +0.4" no longer describes anything real. What is
 * asserted instead is the ordering the era depends on. The absolute national
 * level is guarded separately, and more precisely, by eraBalanceLadder.
 *
 * The industrial North is NOT asserted to be economically Republican. It voted
 * for Eisenhower on Korea and corruption while sitting at peak union density;
 * reading that vote back into an economic-right position is the party-for-
 * ideology conflation this recalibration removes.
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
    // Right of the Solid South and left of the Plains: Ike carried TX, FL and
    // VA in 1952 without the one-party organization the Deep South ran on.
    for (const s of ["TX", "FL", "VA"]) {
      const m = meanEcon(s);
      expect(m, s).toBeGreaterThan(0);
      expect(m, s).toBeLessThan(1.0);
    }
  });

  it("puts the industrial North between the Solid South and the Plains", () => {
    // Peak union density on one side, the small-proprietor Plains on the other.
    // These states voted for Eisenhower; economically they are neither the
    // Solid South nor Kansas, and that ordering is what the era needs.
    const southFloor = Math.max(...["AL", "MS", "SC", "GA"].map(meanEcon));
    const plainsCeiling = Math.min(...["ND", "KS", "NE", "SD"].map(meanEcon));
    for (const s of ["NY", "MA", "PA", "OH", "MI", "WI", "MN", "IN"]) {
      expect(meanEcon(s), s).toBeGreaterThan(southFloor);
      expect(meanEcon(s), s).toBeLessThan(plainsCeiling);
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
    expect(mean).toBeLessThan(0.5);
  });
});
