import { describe, expect, it } from "vitest";
import {
  buildCountyRows,
  defaultSortDir,
  sortCountyRows,
  type CountyApiResponse,
} from "./countyModel";

const candidate = (id: string) =>
  id === "a" ? { name: "Ann", color: "#2563eb" } : { name: "Ben", color: "#dc2626" };

const data: CountyApiResponse = {
  viewBox: "0 0 10 10",
  subdivisions: [
    { id: "1", name: "Adams", path: "M0 0", votes: { a: 60, b: 40 }, margin: 20, winner: "a" },
    { id: "2", name: "Clark", path: "M0 0", votes: { a: 450, b: 550 }, margin: 10, winner: "b" },
    { id: "3", name: "Boone", path: "M0 0", votes: { a: 30, b: 20 }, margin: 2, winner: "a" },
  ],
};

describe("county rows", () => {
  const rows = buildCountyRows(data, candidate);

  it("tiers each county by its own margin and totals its votes", () => {
    expect(rows.map((r) => r.tier)).toEqual(["safe", "likely", "tossup"]);
    expect(rows[1].votes).toBe(1000);
    expect(rows[0].winnerName).toBe("Ann");
  });

  it("sorts by name, margin and votes in both directions", () => {
    expect(sortCountyRows(rows, "name", "asc").map((r) => r.name)).toEqual([
      "Adams",
      "Boone",
      "Clark",
    ]);
    expect(sortCountyRows(rows, "margin", "desc").map((r) => r.name)).toEqual([
      "Adams",
      "Clark",
      "Boone",
    ]);
    expect(sortCountyRows(rows, "votes", "asc").map((r) => r.name)).toEqual([
      "Boone",
      "Adams",
      "Clark",
    ]);
  });

  it("groups by leader, then margin", () => {
    expect(sortCountyRows(rows, "leader", "asc").map((r) => r.name)).toEqual([
      "Boone",
      "Adams",
      "Clark",
    ]);
  });

  it("does not mutate its input", () => {
    const copy = [...rows];
    sortCountyRows(rows, "votes", "asc");
    expect(rows).toEqual(copy);
  });

  it("starts text ascending and figures descending", () => {
    expect(defaultSortDir("name")).toBe("asc");
    expect(defaultSortDir("votes")).toBe("desc");
  });
});
