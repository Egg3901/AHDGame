import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { REGION_SHARDS, shardForRegion, shardsForRegions, allRegionCodes } from "./regionManifest";

describe("regionManifest lookups", () => {
  it("resolves a region code to its shard", () => {
    expect(shardForRegion("NIR")?.area).toBe("british-isles");
    expect(shardForRegion("BB")?.area).toBe("germany");
    expect(shardForRegion("NOPE")).toBeUndefined();
  });

  it("returns the distinct shards needed for a set of codes", () => {
    const shards = shardsForRegions(["NIR", "BB", "BW", "DUB"]);
    expect(shards.map((s) => s.area).sort()).toEqual(["british-isles", "germany"]);
  });

  it("allRegionCodes unions every shard's codes", () => {
    const all = allRegionCodes();
    expect(all).toContain("NIR");
    expect(all).toContain("BB");
    expect(all.length).toBe(REGION_SHARDS.reduce((n, s) => n + s.codes.length, 0));
  });

  it("every shard declares the base country/countries its geometry occupies", () => {
    for (const shard of REGION_SHARDS) {
      expect(shard.baseCountryIds.length, `${shard.area} baseCountryIds`).toBeGreaterThan(0);
    }
    // British Isles spans two base countries; the rest are eponymous singletons.
    expect(REGION_SHARDS.find((s) => s.area === "british-isles")?.baseCountryIds).toEqual([
      "UK",
      "IE",
    ]);
    expect(REGION_SHARDS.find((s) => s.area === "germany")?.baseCountryIds).toEqual(["DE"]);
  });
});

describe("regionManifest invariants", () => {
  it("no region code appears in two shards (global uniqueness)", () => {
    const owner = new Map<string, string>();
    for (const shard of REGION_SHARDS) {
      for (const code of shard.codes) {
        expect(owner.has(code), `${code} is in both ${shard.area} and ${owner.get(code)}`).toBe(
          false
        );
        owner.set(code, shard.area);
      }
    }
  });

  it("each shard's declared codes exactly match its committed geojson", () => {
    for (const shard of REGION_SHARDS) {
      const geo = JSON.parse(readFileSync(`public${shard.url}`, "utf8"));
      const fileCodes = new Set<string>(
        geo.features.map((f: { properties: { regionCode: string } }) => f.properties.regionCode)
      );
      expect(new Set(shard.codes), `${shard.area} manifest vs file`).toEqual(fileCodes);
    }
  });

  it("allRegionCodes covers the British-Isles and German sets (region-ownership contract)", () => {
    const all = new Set(allRegionCodes());
    for (const code of ["NIR", "DUB", "BW", "BB"]) expect(all.has(code)).toBe(true);
  });
});

describe("NG world shard", () => {
  it("registers the nigeria shard with the six zone codes and world overlay", () => {
    const ng = REGION_SHARDS.find((s) => s.area === "nigeria");
    expect(ng).toBeDefined();
    expect([...ng!.codes].sort()).toEqual([
      "NORTH_CENTRAL",
      "NORTH_EAST",
      "NORTH_WEST",
      "SOUTH_EAST",
      "SOUTH_SOUTH",
      "SOUTH_WEST",
    ]);
    expect(ng!.baseCountryIds).toEqual(["NG"]);
    expect(ng!.worldOverlay).toBe(true);
  });
});
