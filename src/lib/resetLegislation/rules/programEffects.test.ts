import { describe, expect, it } from "vitest";
import { combineLawProgramEffects } from "./programEffects";

describe("combineLawProgramEffects", () => {
  it("scales and combines enacted programs without changing observations", () => {
    expect(
      combineLawProgramEffects(
        [
          {
            familyId: "L10",
            primaryMetricEffects: [{ metricId: "11", favorableNormalizedPoints: 0.4 }],
          },
          {
            familyId: "L11",
            primaryMetricEffects: [{ metricId: "11", favorableNormalizedPoints: -0.2 }],
          },
        ],
        [
          { familyId: "L10", implementationFactor: 0.5 },
          { familyId: "L11", implementationFactor: 1 },
        ]
      )
    ).toEqual([
      {
        metricId: "11",
        favorableNormalizedPoints: 0,
        contributingPrograms: ["L10", "L11"],
      },
    ]);
  });

  it("omits an unfunded program and rejects an invalid factor", () => {
    const programs = [
      {
        familyId: "L10",
        primaryMetricEffects: [{ metricId: "11", favorableNormalizedPoints: 0.4 }],
      },
    ];
    expect(combineLawProgramEffects(programs, [])).toEqual([]);
    expect(() =>
      combineLawProgramEffects(programs, [{ familyId: "L10", implementationFactor: 1.1 }])
    ).toThrow("Invalid implementation factor");
  });
});
