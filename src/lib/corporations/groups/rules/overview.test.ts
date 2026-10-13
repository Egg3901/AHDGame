import { describe, it, expect } from "vitest";
import { groupOverviewHistory, groupRegionFootprint } from "./overview";
const point = (turn: number, revenue = 100, income = 20) => ({
  turn,
  revenue,
  income,
  costs: revenue - income,
});
describe("Group overview history", () => {
  it("uses equal-turn member snapshots and combines negative income", () => {
    const result = groupOverviewHistory([[point(20, 100, 30)], [point(20, 200, -10)]], 20, 24);
    expect(result.latest).toEqual(point(20, 300, 20));
    expect(result.margin).toBeCloseTo(20 / 3);
    expect(result.contributions?.[0]).toBeCloseTo(100 / 3);
    expect(result.contributions?.[1]).toBeCloseTo(200 / 3);
  });
  it.each([null, []])("never invents private or missing observations (%s)", (history) => {
    const result = groupOverviewHistory([[point(20)], history], 20, 24);
    expect(result.latest).toBeNull();
    expect(result.points).toEqual([]);
    expect(result.contributions).toBeNull();
  });
  it("does not sum different latest turns or connect lines over gaps", () => {
    const result = groupOverviewHistory(
      [
        [point(20), point(18), point(17)],
        [point(19), point(18), point(17)],
      ],
      20,
      24
    );
    expect(result.latest).toBeNull();
    expect(result.contributions).toBeNull();
    expect(result.points.map((p) => p.turn)).toEqual([17, 18]);
    const gap = groupOverviewHistory([[point(20), point(18), point(17)]], 20, 24);
    expect(gap.points.map((p) => p.turn)).toEqual([17, 18, 20]);
    expect(gap.consecutive.map((p) => p.turn)).toEqual([20]);
  });
  it.each([12, 24, 48] as const)("bounds the selected history window to %s turns", (range) => {
    const rows = Array.from({ length: 49 }, (_, i) => point(100 - i));
    const result = groupOverviewHistory([rows, rows], 100, range);
    expect(result.points).toHaveLength(range);
    expect(result.points[0].turn).toBe(101 - range);
  });
  it("does not divide by zero or show misleading negative revenue shares", () => {
    expect(groupOverviewHistory([[point(20, 0)]], 20, 24).contributions).toBeNull();
    const mixed = groupOverviewHistory([[point(20, 100)], [point(20, -20)]], 20, 24);
    expect(mixed.contributions).toBeNull();
    expect(mixed.latest?.revenue).toBe(80);
    expect(groupOverviewHistory([[point(20, 0)]], 20, 24).margin).toBeNull();
  });
});
describe("known Group regions", () => {
  it("deduplicates shared regions and distinguishes countries", () => {
    expect(
      groupRegionFootprint([
        { corporationId: "a", countryId: "US", stateId: "X" },
        { corporationId: "a", countryId: "US", stateId: "X" },
        { corporationId: "b", countryId: "US", stateId: "X" },
        { corporationId: "b", countryId: "UK", stateId: "X" },
        { corporationId: "b", countryId: "UK" },
      ])
    ).toEqual({
      total: 2,
      byMember: new Map([
        ["a", 1],
        ["b", 2],
      ]),
    });
  });
});
