import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import * as pcMod from "polygon-clipping";
import { computeRegionBlobs } from "./regionOverlay";
import { RU_REGION_CODES } from "./ruGeometry";
import { REGION_SHARDS } from "./regionManifest";

// Drives the real /world blob pipeline (same polygon-clipping
// union WorldMapSVG uses) against the committed shard, to confirm the RU
// macro-regions merge into one body without seams or floating islands now that
// Ukraine, Byelorussia and the Baltics have left for their own shards.
const polygonClipping: any = (pcMod as any).default ?? pcMod;

const loadShard = () => {
  const geo = JSON.parse(readFileSync("public/ru-regions.json", "utf8"));
  const su = REGION_SHARDS.find((s) => s.area === "soviet-union")!;
  return { codes: su.codes, baseCountryIds: su.baseCountryIds, features: geo.features };
};

describe("USSR blob renders as one body", () => {
  it("unions all 14 regions into a single RU blob", () => {
    const ownership = Object.fromEntries(RU_REGION_CODES.map((c) => [c, "RU"]));
    const { blobs, coveredBases } = computeRegionBlobs(
      [loadShard()],
      ownership,
      {},
      polygonClipping,
      true
    );

    expect(blobs.size).toBe(1);
    const ru = blobs.get("RU")!;
    expect(ru).toBeDefined();

    // The departed republics' base features must NOT be suppressed by this
    // shard any more: their own shards own them.
    for (const id of ["804", "112", "233", "428", "440"]) {
      expect([...coveredBases], `base ${id} wrongly suppressed`).not.toContain(id);
    }
    // The republics RU kept are still hidden under the blob.
    for (const id of ["398", "498"]) {
      expect([...coveredBases], `base ${id} not suppressed`).toContain(id);
    }

    let minx = 1e9,
      maxx = -1e9,
      miny = 1e9,
      maxy = -1e9;
    const walk = (a: unknown): void => {
      if (Array.isArray(a) && typeof a[0] === "number") {
        minx = Math.min(minx, a[0] as number);
        maxx = Math.max(maxx, a[0] as number);
        miny = Math.min(miny, a[1] as number);
        maxy = Math.max(maxy, a[1] as number);
      } else if (Array.isArray(a)) a.forEach(walk);
    };
    walk(ru);

    // Kaliningrad stayed Russian and moved back into NWR when the Baltics left,
    // so the western edge is still the Kaliningrad exclave at ~19.6E.
    expect(minx).toBeLessThan(21);
    expect(maxy).toBeGreaterThan(59);
    // Far East still unwraps past the antimeridian for the globe re-wrap.
    expect(maxx).toBeGreaterThan(180);
  });

  it("drops the whole blob if a new region is unowned (fully-owned gate)", () => {
    // MOL unowned — proves every code participates in the gate rather than
    // being silently ignored.
    const partial = Object.fromEntries(
      RU_REGION_CODES.filter((c) => c !== "MOL").map((c) => [c, "RU"])
    );
    const { blobs } = computeRegionBlobs([loadShard()], partial, {}, polygonClipping, true);
    expect(blobs.size).toBe(0);
  });
});
