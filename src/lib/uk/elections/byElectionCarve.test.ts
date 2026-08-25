import { describe, it, expect } from "vitest";
import {
  computeByElectionCarveFraction,
  scaleElectorateToVacatedSeats,
  byElectionElectorateSize,
} from "./byElectionCarve";

const groups = [
  { id: "wealth:low", population: 300 },
  { id: "wealth:mid", population: 500 },
  { id: "wealth:high", population: 200 },
];

describe("computeByElectionCarveFraction", () => {
  it("is vacatedSeats / totalSeats", () => {
    expect(computeByElectionCarveFraction(1, 59)).toBeCloseTo(1 / 59, 6);
    expect(computeByElectionCarveFraction(3, 60)).toBeCloseTo(0.05, 6);
  });
  it("clamps to [0,1] and guards a zero seat total", () => {
    expect(computeByElectionCarveFraction(5, 0)).toBe(0);
    expect(computeByElectionCarveFraction(-2, 59)).toBe(0);
    expect(computeByElectionCarveFraction(70, 59)).toBe(1);
  });
});

describe("scaleElectorateToVacatedSeats", () => {
  it("scales every group population by the fraction, preserving relative shares", () => {
    const { fraction, groups: scaled } = scaleElectorateToVacatedSeats(groups, 1, 10);
    expect(fraction).toBe(0.1);
    expect(scaled.map((g) => g.population)).toEqual([30, 50, 20]);
    // relative composition preserved
    const totalOrig = 1000;
    const totalScaled = scaled.reduce((s, g) => s + g.population, 0);
    expect(scaled[1].population / totalScaled).toBeCloseTo(500 / totalOrig, 6);
  });
  it("keeps group ids", () => {
    const { groups: scaled } = scaleElectorateToVacatedSeats(groups, 2, 20);
    expect(scaled.map((g) => g.id)).toEqual(["wealth:low", "wealth:mid", "wealth:high"]);
  });
});

describe("byElectionElectorateSize", () => {
  it("is the regional total scaled by the carve fraction", () => {
    expect(byElectionElectorateSize(groups, 1, 10)).toBeCloseTo(100, 6); // 1000 * 0.1
    expect(byElectionElectorateSize(groups, 2, 10)).toBeCloseTo(200, 6);
  });
  it("is zero when no seats are vacated or the region has no seats", () => {
    expect(byElectionElectorateSize(groups, 0, 10)).toBe(0);
    expect(byElectionElectorateSize(groups, 1, 0)).toBe(0);
  });
});
