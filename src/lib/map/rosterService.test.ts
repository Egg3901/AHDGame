import { describe, it, expect } from "vitest";
import { buildRegionRoster, filterPoliticalUsRoster } from "./rosterService";

describe("buildRegionRoster", () => {
  it("maps owned states to roster entries, sorted by name", () => {
    const roster = buildRegionRoster([
      { _id: "BY", name: "Bayern", houseDistricts: 47, region: "Süden", population: 11_000_000 },
      {
        _id: "BW",
        name: "Baden-Württemberg",
        houseDistricts: 38,
        region: "Süden",
        population: 9_000_000,
      },
    ]);
    expect(roster.map((r) => r.id)).toEqual(["BW", "BY"]); // alphabetical by name
    expect(roster[0]).toEqual({
      id: "BW",
      name: "Baden-Württemberg",
      seats: 38,
      grouping: "Süden",
      population: 9_000_000,
    });
  });

  it("falls back gracefully when fields are missing", () => {
    const roster = buildRegionRoster([{ _id: "ZZ" }]);
    expect(roster[0]).toEqual({ id: "ZZ", name: "ZZ", seats: 0, grouping: "", population: 0 });
  });
});

describe("filterPoliticalUsRoster", () => {
  it("drops unadmitted territories and DC so a 1953 map shows 48 states", () => {
    const roster = buildRegionRoster([
      { _id: "CA", name: "California", houseDistricts: 30, region: "West", population: 10_000_000 },
      { _id: "AK", name: "Alaska", houseDistricts: 0, region: "West", population: 128_000 },
      { _id: "HI", name: "Hawaii", houseDistricts: 0, region: "West", population: 500_000 },
      {
        _id: "DC",
        name: "District of Columbia",
        houseDistricts: 0,
        region: "South",
        population: 800_000,
      },
      { _id: "WY", name: "Wyoming", houseDistricts: 1, region: "West", population: 290_000 },
    ]);
    const filtered = filterPoliticalUsRoster(roster, new Set(["CA", "WY"]));
    expect(filtered.map((r) => r.id)).toEqual(["CA", "WY"]);
    expect(filtered.every((r) => r.political === true)).toBe(true);
  });
});
