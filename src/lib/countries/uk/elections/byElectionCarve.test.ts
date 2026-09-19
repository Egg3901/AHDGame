import { describe, it, expect } from "vitest";
import {
  computeByElectionCarveFraction,
  scaleElectorateToVacatedSeats,
  byElectionElectorateSize,
} from "@/lib/countries/uk/elections/byElectionCarve";

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

describe("carve vote-share invariants", () => {
  // Per-group party leans: the same vote engine over the carved pool must
  // reproduce the regional vote shares exactly, only the pool is smaller.
  const leans: Record<string, Record<string, number>> = {
    "wealth:low": { LAB: 0.55, CON: 0.3, LIB: 0.15 },
    "wealth:mid": { LAB: 0.4, CON: 0.4, LIB: 0.2 },
    "wealth:high": { LAB: 0.25, CON: 0.6, LIB: 0.15 },
  };

  function partyVotes(pops: { id: string; population: number }[]): Record<string, number> {
    const totals: Record<string, number> = { LAB: 0, CON: 0, LIB: 0 };
    for (const g of pops) {
      for (const [party, share] of Object.entries(leans[g.id] ?? {})) {
        totals[party] += g.population * share;
      }
    }
    return totals;
  }

  function partyShares(votes: Record<string, number>): Record<string, number> {
    const total = Object.values(votes).reduce((s, v) => s + v, 0);
    return Object.fromEntries(Object.entries(votes).map(([p, v]) => [p, v / total]));
  }

  it("every party total scales by exactly the carve fraction", () => {
    const { fraction, groups: scaled } = scaleElectorateToVacatedSeats(groups, 1, 10);
    const regional = partyVotes(groups);
    const carved = partyVotes(scaled);
    for (const party of ["LAB", "CON", "LIB"]) {
      expect(carved[party]).toBeCloseTo(regional[party] * fraction, 9);
    }
  });

  it("relative party shares are identical before and after the carve", () => {
    for (const [vacated, total] of [
      [1, 75],
      [3, 75],
      [2, 10],
    ] as Array<[number, number]>) {
      const { groups: scaled } = scaleElectorateToVacatedSeats(groups, vacated, total);
      const regionalShares = partyShares(partyVotes(groups));
      const carvedShares = partyShares(partyVotes(scaled));
      for (const party of ["LAB", "CON", "LIB"]) {
        expect(carvedShares[party]).toBeCloseTo(regionalShares[party], 9);
      }
    }
  });

  it("a single-seat LON carve contests 1/75th of the region with unchanged shares", () => {
    const { fraction, groups: scaled } = scaleElectorateToVacatedSeats(groups, 1, 75);
    expect(fraction).toBeCloseTo(1 / 75, 9);
    expect(byElectionElectorateSize(groups, 1, 75)).toBeCloseTo(1000 / 75, 9);
    const regionalShares = partyShares(partyVotes(groups));
    const carvedShares = partyShares(partyVotes(scaled));
    for (const party of ["LAB", "CON", "LIB"]) {
      expect(carvedShares[party]).toBeCloseTo(regionalShares[party], 9);
    }
  });

  it("zero-population groups stay zero and cannot distort shares", () => {
    const withEmpty = [...groups, { id: "wealth:none", population: 0 }];
    const { groups: scaled } = scaleElectorateToVacatedSeats(withEmpty, 1, 10);
    expect(scaled[3].population).toBe(0);
    const regionalShares = partyShares(partyVotes(groups));
    const carvedShares = partyShares(partyVotes(scaled.slice(0, 3)));
    for (const party of ["LAB", "CON", "LIB"]) {
      expect(carvedShares[party]).toBeCloseTo(regionalShares[party], 9);
    }
  });
});
