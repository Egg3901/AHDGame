import { describe, expect, it } from "vitest";
import {
  needsAttention,
  recommendedAction,
  filterRoster,
  sortRoster,
  bulkCost,
  type RosterNpp,
} from "./nppRoster";

const mk = (over: Partial<RosterNpp>): RosterNpp => ({
  id: "1",
  name: "Alpha",
  homeState: "CA",
  stats: { favorability: 60, politicalInfluence: 60, loyalty: 60, ambition: 60, stubbornness: 30 },
  estimatedChance: 80,
  currentOfficeLabel: null,
  activeCandidacyLabel: null,
  ...over,
});

describe("needsAttention", () => {
  it("flags low loyalty, low favorability, high stubbornness", () => {
    expect(needsAttention(mk({ stats: { ...mk({}).stats, loyalty: 20 } }).stats)).toContain(
      "Low loyalty"
    );
    expect(needsAttention(mk({ stats: { ...mk({}).stats, favorability: 20 } }).stats)).toContain(
      "Low favorability"
    );
    expect(needsAttention(mk({ stats: { ...mk({}).stats, stubbornness: 80 } }).stats)).toContain(
      "High stubbornness"
    );
    expect(needsAttention(mk({}).stats)).toEqual([]);
  });
});

describe("recommendedAction", () => {
  it("prioritizes loyalty, then favorability, then stubbornness, else influence", () => {
    expect(recommendedAction(mk({ stats: { ...mk({}).stats, loyalty: 20 } }).stats)).toBe(
      "boost_loyalty"
    );
    expect(recommendedAction(mk({ stats: { ...mk({}).stats, favorability: 20 } }).stats)).toBe(
      "boost_favorability"
    );
    expect(recommendedAction(mk({ stats: { ...mk({}).stats, stubbornness: 80 } }).stats)).toBe(
      "reduce_stubbornness"
    );
    expect(recommendedAction(mk({}).stats)).toBe("boost_influence");
  });
});

describe("filterRoster", () => {
  const rows = [
    mk({ id: "a", homeState: "CA", stats: { ...mk({}).stats, loyalty: 20 } }),
    mk({ id: "b", homeState: "NY", activeCandidacyLabel: "Gov" }),
    mk({ id: "c", homeState: "CA" }),
  ];
  it("filters by attention, state, and search", () => {
    expect(
      filterRoster(rows, { filter: "attention", state: "all", q: "" }).map((r) => r.id)
    ).toEqual(["a"]);
    expect(filterRoster(rows, { filter: "all", state: "CA", q: "" }).map((r) => r.id)).toEqual([
      "a",
      "c",
    ]);
    expect(filterRoster(rows, { filter: "running", state: "all", q: "" }).map((r) => r.id)).toEqual(
      ["b"]
    );
    expect(filterRoster(rows, { filter: "all", state: "all", q: "alp" }).length).toBe(3);
  });
});

describe("sortRoster", () => {
  const rows = [
    mk({ id: "lo", stats: { ...mk({}).stats, loyalty: 10, stubbornness: 90, ambition: 10 } }),
    mk({ id: "hi", stats: { ...mk({}).stats, loyalty: 90, stubbornness: 10, ambition: 90 } }),
  ];
  it("sorts by each stat (stubbornness worst-first)", () => {
    expect(sortRoster(rows, "loyalty")[0].id).toBe("hi");
    expect(sortRoster(rows, "ambition")[0].id).toBe("hi");
    expect(sortRoster(rows, "stubbornness")[0].id).toBe("lo"); // 90 first = worst
    expect(sortRoster(rows, "attention")[0].id).toBe("lo");
  });
});

describe("bulkCost", () => {
  it("multiplies per-NPP cost by count", () => {
    expect(bulkCost(3, { actionCost: 2, baseFundCost: 18000 })).toEqual({
      actions: 6,
      funds: 54000,
    });
  });
});
