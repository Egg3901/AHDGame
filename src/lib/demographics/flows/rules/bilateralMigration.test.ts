import { describe, expect, it } from "vitest";
import { planBilateralMigration, transferBilateralCohorts } from "./bilateralMigration";

const demands = [
  { regionId: "PL_A", countryId: "PL", netPeople: -100 },
  { regionId: "DE_A", countryId: "DE", netPeople: 70 },
  { regionId: "DE_B", countryId: "DE", netPeople: 50 },
];

describe("bilateral migration planning", () => {
  it("conserves residents through an open, capacity-limited corridor", () => {
    const plan = planBilateralMigration(demands, [
      { originCountryId: "PL", destinationCountryId: "DE", capacityPeople: 80 },
    ]);
    expect(plan.routes).toEqual([
      {
        originRegionId: "PL_A",
        destinationRegionId: "DE_A",
        originCountryId: "PL",
        destinationCountryId: "DE",
        people: 70,
      },
      {
        originRegionId: "PL_A",
        destinationRegionId: "DE_B",
        originCountryId: "PL",
        destinationCountryId: "DE",
        people: 10,
      },
    ]);
    expect(plan.unmatchedByRegion).toEqual({ DE_A: 0, DE_B: 40, PL_A: -20 });
    expect(plan.routes.reduce((sum, route) => sum + route.people, 0)).toBe(80);
  });

  it("moves nobody when borders are closed or only reverse travel is permitted", () => {
    const reverse = [{ originCountryId: "DE", destinationCountryId: "PL", capacityPeople: 100 }];
    expect(planBilateralMigration(demands, []).routes).toEqual([]);
    expect(planBilateralMigration(demands, reverse).routes).toEqual([]);
  });

  it("is independent of input order and never exceeds offered residents", () => {
    const corridors = [{ originCountryId: "PL", destinationCountryId: "DE", capacityPeople: 1000 }];
    const a = planBilateralMigration(demands, corridors);
    const b = planBilateralMigration([...demands].reverse(), corridors);
    expect(a).toEqual(b);
    expect(a.routes.reduce((sum, route) => sum + route.people, 0)).toBe(100);
  });

  it("rejects invalid identity and capacity data", () => {
    expect(() => planBilateralMigration([demands[0], demands[0]], [])).toThrow();
    expect(() =>
      planBilateralMigration(demands, [
        { originCountryId: "PL", destinationCountryId: "DE", capacityPeople: -1 },
      ])
    ).toThrow();
  });
});

describe("bilateral cohort transfer", () => {
  it("conserves the same age and sex cells across both countries", () => {
    const origin = { male: [0, 3], female: [2, 5] };
    const destination = { male: [1, 1], female: [1, 1] };
    const profile = { male: [0, 0.25], female: [0.25, 0.5] };
    const result = transferBilateralCohorts(origin, destination, 8, profile);
    expect(result.moved).toBe(8);
    expect(result.origin).toEqual({ male: [0, 1], female: [0, 1] });
    expect(result.destination).toEqual({ male: [1, 3], female: [3, 5] });
    expect(origin.female[1]).toBe(5);
  });
  it("rejects a profile that would create more people than requested", () => {
    expect(() =>
      transferBilateralCohorts({ male: [10], female: [10] }, { male: [0], female: [0] }, 2, {
        male: [1],
        female: [1],
      })
    ).toThrow("exceeds");
  });
  it("cannot remove more people than the origin actually holds", () => {
    const result = transferBilateralCohorts(
      { male: [1], female: [0] },
      { male: [0], female: [0] },
      10,
      { male: [1], female: [0] }
    );
    expect(result.moved).toBe(1);
    expect(result.destination.male[0]).toBe(1);
  });
});
