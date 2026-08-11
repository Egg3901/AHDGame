import { describe, expect, it } from "vitest";
import { applyContinuousAging } from "./aging";
import { totalPopulation, type AgeSexVector } from "../cohortVector";

const TPY = 48;
function flat(perCell = 4800): AgeSexVector {
  const arr = () => Array.from({ length: 101 }, () => perCell);
  return { male: arr(), female: arr() };
}

describe("applyContinuousAging", () => {
  it("graduates 1/turnsPerYear of each cohort up one age per turn", () => {
    const v = flat(4800);
    const aged = applyContinuousAging(v, TPY);
    // age 1 loses 1/48 of its own, gains 1/48 of age 0 → net 0 on a flat vector
    expect(aged.male[1]).toBeCloseTo(4800, 6);
    // age 0 loses 1/48 to age 1, gains nothing here (births handled elsewhere)
    expect(aged.male[0]).toBeCloseTo(4800 - 4800 / 48, 6);
  });
  it("conserves total population (graduation is internal)", () => {
    const v = flat(4800);
    expect(totalPopulation(applyContinuousAging(v, TPY))).toBeCloseTo(totalPopulation(v), 6);
  });
  it("index 100 absorbs its inflow and never ages out (terminal)", () => {
    const v = flat(4800);
    const aged = applyContinuousAging(v, TPY);
    // age 100 gains 1/48 of age 99, loses nothing → grows
    expect(aged.male[100]).toBeCloseTo(4800 + 4800 / 48, 6);
  });
  it("over a full game-year (48 turns) approximates one single-year shift", () => {
    let v: AgeSexVector = {
      male: Array.from({ length: 101 }, (_, a) => (a === 30 ? 48000 : 0)),
      female: Array.from({ length: 101 }, () => 0),
    };
    for (let t = 0; t < TPY; t++) v = applyContinuousAging(v, TPY);
    expect(v.male[30]).toBeLessThan(48000 * 0.5); // most have graduated past 30
    expect(totalPopulation(v)).toBeCloseTo(48000, 4); // conserved
  });
});
