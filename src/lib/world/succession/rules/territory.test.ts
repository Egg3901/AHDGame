import { expect, it } from "vitest";
import { planSuccessionTerritories } from "./territory";
const regions = [
  { regionId: "bohemia", population: 600, annualGdpAnchor: 7000 },
  { regionId: "moravia", population: 400, annualGdpAnchor: 3000 },
  { regionId: "slovakia", population: 500, annualGdpAnchor: 3500 },
];
const assignments = { bohemia: "CZ2", moravia: "CZ2", slovakia: "SK" };
it("conserves existing regional population and output instead of reseeding", () => {
  const result = planSuccessionTerritories(regions, ["CZ2", "SK"], assignments);
  expect(result).toEqual([
    {
      entityId: "CZ2",
      regionIds: ["bohemia", "moravia"],
      population: 1000,
      annualGdpAnchor: 10000,
    },
    { entityId: "SK", regionIds: ["slovakia"], population: 500, annualGdpAnchor: 3500 },
  ]);
  expect(planSuccessionTerritories([...regions].reverse(), ["SK", "CZ2"], assignments)).toEqual(
    result
  );
});
it("rejects missing, duplicated, invented and foreign territory", () => {
  expect(() =>
    planSuccessionTerritories(regions, ["CZ2", "SK"], { bohemia: "CZ2", slovakia: "SK" })
  ).toThrow();
  expect(() =>
    planSuccessionTerritories([...regions, regions[0]], ["CZ2", "SK"], assignments)
  ).toThrow();
  expect(() =>
    planSuccessionTerritories(regions, ["CZ2", "SK"], { ...assignments, invented: "SK" })
  ).toThrow();
  expect(() =>
    planSuccessionTerritories(regions, ["CZ2", "SK"], { ...assignments, moravia: "OTHER" })
  ).toThrow();
});
it("rejects fabricated empty successors and invalid source totals", () => {
  expect(() => planSuccessionTerritories(regions, ["CZ2", "SK", "OTHER"], assignments)).toThrow();
  expect(() =>
    planSuccessionTerritories(
      [{ ...regions[0], population: -1 }, ...regions.slice(1)],
      ["CZ2", "SK"],
      assignments
    )
  ).toThrow();
  expect(() =>
    planSuccessionTerritories(
      [{ ...regions[0], annualGdpAnchor: Infinity }, ...regions.slice(1)],
      ["CZ2", "SK"],
      assignments
    )
  ).toThrow();
});
