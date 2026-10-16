import { describe, expect, it } from "vitest";
import { feasibleProduction } from "./productionFeasibilityRules";

describe("joint physical production feasibility", () => {
  it("keeps upstream suppliers running while limiting a competing final producer", () => {
    const result = feasibleProduction({
      activities: [
        { id: "power", value: 100 },
        { id: "steel", value: 100 },
        { id: "final", value: 100 },
      ],
      constraints: [
        { available: 0, coefficients: [-100, 50, 100] },
        { available: 0, coefficients: [50, -100, 100] },
      ],
    });
    expect(result[0]).toBeCloseTo(1);
    expect(result[1]).toBeCloseTo(1);
    expect(result[2]).toBeCloseTo(0.5);
  });

  it("respects opening resources, activity bounds and a shared cash constraint", () => {
    const result = feasibleProduction({
      activities: [
        { id: "a", value: 3 },
        { id: "b", value: 2 },
      ],
      constraints: [{ available: 1.5, coefficients: [1, 1] }],
    });
    expect(result[0]).toBeCloseTo(1);
    expect(result[1]).toBeCloseTo(0.5);
    expect(
      feasibleProduction({
        activities: [{ id: "a", value: 1 }],
        constraints: [{ available: 0, coefficients: [1] }],
      })
    ).toEqual([0]);
    expect(feasibleProduction({ activities: [{ id: "a", value: 1 }], constraints: [] })).toEqual([
      1,
    ]);
  });

  it("cannot manufacture a net resource from an unproductive closed cycle", () => {
    expect(
      feasibleProduction({
        activities: [
          { id: "a", value: 1 },
          { id: "b", value: 1 },
        ],
        constraints: [
          { available: 0, coefficients: [-1, 2] },
          { available: 0, coefficients: [2, -1] },
        ],
      })
    ).toEqual([0, 0]);
  });

  it("matches an independent vertex enumeration for bounded two-activity resource markets", () => {
    let seed = 4322;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let example = 0; example < 200; example++) {
      const value = [1 + (next() % 10), 1 + (next() % 10)];
      const constraints = Array.from({ length: 4 }, () => ({
        available: next() % 4,
        coefficients: [Number(next() % 7) - 3, Number(next() % 7) - 3],
      }));
      const edges = [
        ...constraints,
        { available: 1, coefficients: [1, 0] },
        { available: 1, coefficients: [0, 1] },
        { available: 0, coefficients: [-1, 0] },
        { available: 0, coefficients: [0, -1] },
      ];
      let best = 0;
      for (let i = 0; i < edges.length; i++)
        for (let j = i + 1; j < edges.length; j++) {
          const [a, b] = edges[i].coefficients;
          const [c, d] = edges[j].coefficients;
          const determinant = a * d - b * c;
          if (determinant === 0) continue;
          const x = (edges[i].available * d - b * edges[j].available) / determinant;
          const y = (a * edges[j].available - edges[i].available * c) / determinant;
          if (
            edges.every(
              (edge) => edge.coefficients[0] * x + edge.coefficients[1] * y <= edge.available + 1e-8
            )
          )
            best = Math.max(best, x * value[0] + y * value[1]);
        }
      const result = feasibleProduction({
        activities: [
          { id: "a", value: value[0] },
          { id: "b", value: value[1] },
        ],
        constraints,
      });
      expect(result[0] * value[0] + result[1] * value[1]).toBeCloseTo(best, 6);
    }
  });
});
