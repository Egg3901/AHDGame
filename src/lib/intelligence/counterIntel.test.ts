import { describe, expect, it } from "vitest";
import { COUNTER_INTEL_MAX } from "./config";
import { deriveCounterIntel, type CounterIntelFacts } from "./counterIntel";

const CALM: CounterIntelFacts = {
  atWar: false,
  alignedShare: 0,
  tensionValue: 12,
  securityEstateCount: 0,
};

describe("deriveCounterIntel", () => {
  it("gives a calm, unaligned, peaceful country a low posture", () => {
    expect(deriveCounterIntel(CALM)).toBeLessThan(30);
  });

  it("raises posture at war", () => {
    expect(deriveCounterIntel({ ...CALM, atWar: true })).toBeGreaterThan(deriveCounterIntel(CALM));
  });

  it("raises posture with bloc alignment", () => {
    expect(deriveCounterIntel({ ...CALM, alignedShare: 90 })).toBeGreaterThan(
      deriveCounterIntel(CALM)
    );
  });

  it("raises posture as world tension climbs", () => {
    expect(deriveCounterIntel({ ...CALM, tensionValue: 95 })).toBeGreaterThan(
      deriveCounterIntel(CALM)
    );
  });

  it("raises posture with security estates built", () => {
    expect(deriveCounterIntel({ ...CALM, securityEstateCount: 6 })).toBeGreaterThan(
      deriveCounterIntel(CALM)
    );
  });

  it("never exceeds the maximum even with everything at once", () => {
    const maxed = deriveCounterIntel({
      atWar: true,
      alignedShare: 100,
      tensionValue: 100,
      securityEstateCount: 50,
    });
    expect(maxed).toBeLessThanOrEqual(COUNTER_INTEL_MAX);
  });

  it("never returns a negative posture", () => {
    const broken = deriveCounterIntel({
      atWar: false,
      alignedShare: -500,
      tensionValue: -500,
      securityEstateCount: -500,
    });
    expect(broken).toBeGreaterThanOrEqual(0);
  });

  it("survives non-finite inputs rather than returning NaN", () => {
    const nan = deriveCounterIntel({
      atWar: false,
      alignedShare: Number.NaN,
      tensionValue: Number.POSITIVE_INFINITY,
      securityEstateCount: Number.NaN,
    });
    expect(Number.isFinite(nan)).toBe(true);
  });

  it("returns a whole number, since it is compared against integer postures", () => {
    expect(Number.isInteger(deriveCounterIntel({ ...CALM, tensionValue: 37 }))).toBe(true);
  });

  it("is deterministic", () => {
    expect(deriveCounterIntel(CALM)).toBe(deriveCounterIntel(CALM));
  });
});
