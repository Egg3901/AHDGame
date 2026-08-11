import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import * as pcMod from "polygon-clipping";
import { computeRegionBlobs } from "./regionOverlay";
import { UA_REGION_CODES } from "./uaGeometry";
import { BLR_REGION_CODES } from "./blrGeometry";
import { BAL_REGION_CODES } from "./balGeometry";
import { REGION_SHARDS } from "./regionManifest";

// The three union republics left the USSR and became their own countries, which
// on the map means three new shards where there used to be three RU regions.
// This drives the real /world blob pipeline (the same polygon-clipping union
// WorldMapSVG uses) against the committed shards, so a republic that would
// render as a hole, a mosaic of oblasts, or nothing at all fails here rather
// than in front of a player.
const polygonClipping = ((pcMod as { default?: unknown }).default ?? pcMod) as Parameters<
  typeof computeRegionBlobs
>[3];

const REPUBLICS = [
  { area: "ukraine", country: "UKR", codes: UA_REGION_CODES, file: "public/ua-regions.json" },
  {
    area: "byelorussia",
    country: "BLR",
    codes: BLR_REGION_CODES,
    file: "public/blr-regions.json",
  },
  { area: "baltics", country: "BAL", codes: BAL_REGION_CODES, file: "public/bal-regions.json" },
] as const;

const loadShard = (area: string, file: string) => {
  const geo = JSON.parse(readFileSync(file, "utf8"));
  const shard = REGION_SHARDS.find((s) => s.area === area);
  if (!shard) throw new Error(`no manifest shard for ${area}`);
  return { shard, features: geo.features as Array<{ properties?: { regionCode?: string } }> };
};

describe("union republic map shards", () => {
  for (const { area, country, codes, file } of REPUBLICS) {
    describe(`${country} (${area})`, () => {
      it("ships one geometry feature per authored region code", () => {
        const { shard, features } = loadShard(area, file);
        const shipped = features.map((f) => f.properties?.regionCode).sort();
        expect(shipped).toEqual([...codes].sort());
        expect([...shard.codes].sort()).toEqual([...codes].sort());
      });

      it("unions its regions into a single body", () => {
        const { shard, features } = loadShard(area, file);
        const ownership = Object.fromEntries(codes.map((c) => [c, country]));
        const { blobs, coveredBases } = computeRegionBlobs(
          [{ baseCountryIds: shard.baseCountryIds, features }],
          ownership,
          {},
          polygonClipping,
          true
        );

        expect(blobs.size).toBe(1);
        expect(blobs.get(country)).toBeDefined();
        // The shard must suppress the modern base features it now covers,
        // otherwise the 110m outline bleeds through the merged blob.
        for (const base of shard.baseCountryIds) {
          expect([...coveredBases], `base ${base} not suppressed`).toContain(base);
        }
      });

      it("drops the whole blob if one region is unowned (fully-owned gate)", () => {
        // A partially-seeded republic must keep its base polygon rather than
        // render with a hole where the unowned region is.
        const { shard, features } = loadShard(area, file);
        const partial = Object.fromEntries(
          codes.filter((c) => c !== codes[0]).map((c) => [c, country])
        );
        const { blobs } = computeRegionBlobs(
          [{ baseCountryIds: shard.baseCountryIds, features }],
          partial,
          {},
          polygonClipping,
          true
        );
        expect(blobs.size).toBe(0);
      });
    });
  }

  it("gives every ex-Soviet base feature exactly one claimant", () => {
    // 804 Ukraine, 112 Byelorussia and 233/428/440 the Baltics moved from the
    // soviet-union shard to the three new ones. Two claimants would draw the
    // territory twice; none would leave it as modern-border background.
    for (const base of ["804", "112", "233", "428", "440"]) {
      const claimants = REGION_SHARDS.filter((s) =>
        (s.baseCountryIds as readonly string[]).includes(base)
      ).map((s) => s.area);
      expect(claimants, `base ${base}`).toHaveLength(1);
    }
  });
});
