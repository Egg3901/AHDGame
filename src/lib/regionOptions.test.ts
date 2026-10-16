import { describe, expect, it } from "vitest";
import { compareRegionLabels, sortByRegionLabel } from "./regionOptions";

describe("regionOptions", () => {
  it("sorts by display label, not by input grouping", () => {
    const ids = [
      "CT",
      "MN",
      "MO",
      "NE",
      "ND",
      "OH",
      "SD",
      "WI",
      "AK",
      "AZ",
      "CA",
      "CO",
      "HI",
      "ID",
    ];
    expect(sortByRegionLabel(ids, (id) => id)).toEqual([
      "AK",
      "AZ",
      "CA",
      "CO",
      "CT",
      "HI",
      "ID",
      "MN",
      "MO",
      "ND",
      "NE",
      "OH",
      "SD",
      "WI",
    ]);
  });

  it("orders by label even when ids disagree", () => {
    const rows = [
      { id: "z1", name: "Alberta" },
      { id: "a9", name: "Quebec" },
      { id: "m5", name: "Manitoba" },
    ];
    expect(sortByRegionLabel(rows, (r) => r.name).map((r) => r.name)).toEqual([
      "Alberta",
      "Manitoba",
      "Quebec",
    ]);
  });

  it("is case and insensitive and does not mutate", () => {
    const input = ["ohio", "Alaska", "alabama"];
    const out = sortByRegionLabel(input, (s) => s);
    expect(out).toEqual(["alabama", "Alaska", "ohio"]);
    expect(input).toEqual(["ohio", "Alaska", "alabama"]);
    expect(compareRegionLabels("a", "B")).toBeLessThan(0);
  });
});
