import { describe, it, expect } from "vitest";
import {
  REGION_ADJACENCY,
  homeRegionOf,
  countriesInRegion,
  regionNeighbors,
  areAdjacent,
} from "../regionTopology";
import { STRATEGIC_REGIONS } from "../regions";
import type { RegionCode } from "../types";

// The current CountryId union — keep in sync with @/lib/constants/countries.
const COUNTRY_IDS = [
  "US",
  "UK",
  "DE",
  "JP",
  "IE",
  "BR",
  "CN",
  "NG",
  "HU",
  "PL",
  "RO",
  "YU",
  "BG",
  "BY",
  "CS",
  "BAL",
  "RU",
  "FR",
  "IT",
  "ES",
  "SE",
  "TR",
  "DD",
  "SCO",
  "WAL",
] as const;

describe("regionTopology", () => {
  it("maps every CountryId to a home region", () => {
    for (const c of COUNTRY_IDS) {
      expect(homeRegionOf(c), `no home region for ${c}`).toBeDefined();
    }
  });

  it("resolves game codes and ISO codes to regions", () => {
    expect(homeRegionOf("US")).toBe("noa");
    expect(homeRegionOf("UK")).toBe("weu");
    expect(homeRegionOf("DE")).toBe("weu");
    expect(homeRegionOf("DD")).toBe("eeu");
    expect(homeRegionOf("RU")).toBe("eeu");
    expect(homeRegionOf("TR")).toBe("mea");
    expect(homeRegionOf("ME")).toBe("eeu"); // Montenegro, no clash with region "mea"
    expect(homeRegionOf("ZZ")).toBeUndefined();
  });

  it("countriesInRegion inverts the map", () => {
    expect(countriesInRegion("noa")).toContain("US");
    expect(countriesInRegion("eas")).toEqual(expect.arrayContaining(["CN", "JP"]));
    expect(countriesInRegion("sat")).toEqual([]); // no home nation
  });

  it("adjacency lists only valid region codes", () => {
    const valid = new Set<string>(STRATEGIC_REGIONS.map((r) => r.id));
    for (const [region, neighbours] of Object.entries(REGION_ADJACENCY)) {
      expect(valid.has(region)).toBe(true);
      for (const n of neighbours) expect(valid.has(n)).toBe(true);
    }
  });

  it("adjacency is symmetric", () => {
    for (const [a, neighbours] of Object.entries(REGION_ADJACENCY) as [
      RegionCode,
      RegionCode[],
    ][]) {
      for (const b of neighbours) {
        expect(REGION_ADJACENCY[b], `${b} should list ${a}`).toContain(a);
      }
    }
  });

  it("covers all 19 regions in the graph", () => {
    expect(Object.keys(REGION_ADJACENCY).length).toBe(STRATEGIC_REGIONS.length);
  });

  it("regionNeighbors / areAdjacent read the graph", () => {
    expect(regionNeighbors("weu")).toContain("eeu");
    expect(areAdjacent("weu", "eeu")).toBe(true);
    expect(areAdjacent("noa", "eas")).toBe(false);
  });
});
