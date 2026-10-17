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

  it("uses the stricter input limit even when the ratios differ by less than the pivot epsilon", () => {
    const activity = [{ id: "plant", value: 1 }];
    // Resource order must not let a nearly empty first input override an empty
    // second input. Both are physical limits, independent of objective precision.
    for (const available of [
      [5e-11, 0],
      [0, 5e-11],
    ]) {
      expect(
        feasibleProduction({
          activities: activity,
          constraints: available.map((amount) => ({ available: amount, coefficients: [1] })),
        })
      ).toEqual([0]);
    }
    expect(
      feasibleProduction({
        activities: activity,
        constraints: [
          { available: 5e-11, coefficients: [1] },
          { available: 1e-11, coefficients: [1] },
        ],
      })
    ).toEqual([1e-11]);
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

  it("shares an exact aggregate solution across identical plants", () => {
    const result = feasibleProduction({
      activities: Array.from({ length: 200 }, (_, i) => ({ id: `plant:${i}`, value: 2 })),
      constraints: [{ available: 50, coefficients: Array(200).fill(1) }],
    });
    expect(result).toEqual(Array(200).fill(0.25));
    expect(result.reduce((sum, fraction) => sum + fraction * 2, 0)).toBe(100);
  });

  it("matches an independent vertex enumeration for bounded two-activity resource markets", () => {
    let seed = 4322;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let example = 0; example < 200; example++) {
      const repetitions = example % 2 === 0 ? [1, 1] : [2, 3];
      const value = [(1 + (next() % 10)) * repetitions[0], (1 + (next() % 10)) * repetitions[1]];
      const constraints = Array.from({ length: 4 }, () => ({
        available: next() % 4,
        coefficients: [
          (Number(next() % 7) - 3) * repetitions[0],
          (Number(next() % 7) - 3) * repetitions[1],
        ],
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
        activities: repetitions.flatMap((count, group) =>
          Array.from({ length: count }, (_, i) => ({
            id: `${group}:${i}`,
            value: value[group] / count,
          }))
        ),
        constraints: constraints.map((constraint) => ({
          available: constraint.available,
          coefficients: repetitions.flatMap((count, group) =>
            Array(count).fill(constraint.coefficients[group] / count)
          ),
        })),
      });
      const objective = result.reduce((sum, fraction, i) => {
        const group = i < repetitions[0] ? 0 : 1;
        return sum + (fraction * value[group]) / repetitions[group];
      }, 0);
      expect(objective).toBeCloseTo(best, 6);
    }
  });
});
