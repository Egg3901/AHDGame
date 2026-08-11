import { describe, expect, it } from "vitest";
import { asfrWeight, birthRateIndexToTFR, computeBirths, splitNewbornsBySex } from "./fertility";
import type { AgeSexVector } from "../cohortVector";

const TPY = 48;
function femaleBlock(perAge = 1000): AgeSexVector {
  const arr = () => Array.from({ length: 101 }, () => perAge);
  return { male: arr(), female: arr() };
}

describe("asfrWeight", () => {
  it("is zero outside 18..44 and positive inside", () => {
    expect(asfrWeight(17)).toBe(0);
    expect(asfrWeight(45)).toBe(0);
    expect(asfrWeight(28)).toBeGreaterThan(0);
  });
  it("sums to 1 over 18..44 (normalization absorbs the span divisor)", () => {
    let s = 0;
    for (let a = 18; a <= 44; a++) s += asfrWeight(a);
    expect(s).toBeCloseTo(1, 9);
  });
  it("peaks in the 25-32 band", () => {
    expect(asfrWeight(28)).toBeGreaterThan(asfrWeight(20));
    expect(asfrWeight(28)).toBeGreaterThan(asfrWeight(40));
  });
});

describe("birthRateIndexToTFR", () => {
  it("maps index 50 to the supplied replacement TFR", () => {
    expect(birthRateIndexToTFR(50, 2.1)).toBeCloseTo(2.1, 5);
  });
  it("is monotonic increasing in the index", () => {
    expect(birthRateIndexToTFR(80, 2.1)).toBeGreaterThan(birthRateIndexToTFR(20, 2.1));
  });
});

describe("computeBirths", () => {
  it("at replacement TFR, annual births ≈ TFR × women / span, /48 per turn", () => {
    const v = femaleBlock(1000);
    const tfr = 2.1;
    const births = computeBirths(v, tfr, TPY);
    // weightedWomen = 1000·Σasfr = 1000; annual births = tfr·1000 = 2100; /48 per turn
    expect(births).toBeCloseTo((2.1 * 1000) / 48, 1);
  });
  it("scales with the female childbearing population", () => {
    expect(computeBirths(femaleBlock(2000), 2.1, TPY)).toBeCloseTo(
      2 * computeBirths(femaleBlock(1000), 2.1, TPY),
      6
    );
  });
});

describe("computeBirths with conscription (serving women)", () => {
  it("subtracts serving women from the childbearing pool (fewer births)", () => {
    const v = femaleBlock(1000);
    const baseline = computeBirths(v, 2.1, TPY);
    const servingFemaleByAge = Array.from({ length: 101 }, (_, a) =>
      a >= 18 && a <= 29 ? 500 : 0
    );
    const withService = computeBirths(v, 2.1, TPY, servingFemaleByAge);
    expect(withService).toBeLessThan(baseline);
  });
  it("never drives the effective childbearing pool negative", () => {
    const v = femaleBlock(100);
    const servingFemaleByAge = Array.from({ length: 101 }, () => 1e9); // absurd
    expect(computeBirths(v, 2.1, TPY, servingFemaleByAge)).toBeGreaterThanOrEqual(0);
  });
});

describe("splitNewbornsBySex", () => {
  it("splits ~51.2% male (≈1.05 M:F) and conserves the total", () => {
    const { male, female } = splitNewbornsBySex(1000);
    expect(male + female).toBeCloseTo(1000, 6);
    expect(male / female).toBeCloseTo(1.05, 1);
  });
});
