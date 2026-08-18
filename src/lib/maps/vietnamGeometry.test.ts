import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { geoArea, geoBounds, geoCentroid } from "d3-geo";
import { REGION_SHARDS } from "./regionManifest";
import { VIETNAM_BASE_FEATURE_ID, VIETNAM_FEATURE_IDS, VIETNAM_GEO_URL } from "./vietnamGeometry";
import { staticHostGeometry } from "./proxyHostGeometry";
import { getWorldEntityMapSnapshot } from "@/lib/world/worldEntityMap";
import { ROSTER_BY_KEY } from "@/lib/constants/alignmentRoster";

/** The built artefact, as the browser fetches it. */
const collection = JSON.parse(readFileSync(`public${VIETNAM_GEO_URL}`, "utf8")) as {
  features: {
    id: string;
    properties: { regionCode: string; name: string };
    geometry: { type: string; coordinates: number[][][][] };
  }[];
};

const PARALLEL = 17;

describe("the Vietnam split", () => {
  it("supplies exactly the two halves", () => {
    expect(collection.features.map((f) => f.id).sort()).toEqual([...VIETNAM_FEATURE_IDS].sort());
  });

  it("is fine enough that the coastline is not a handful of straight edges", () => {
    const verts = collection.features.reduce(
      (n, f) =>
        n +
        f.geometry.coordinates.reduce((m, poly) => m + poly.reduce((k, r) => k + r.length, 0), 0),
      0
    );
    // 110m Natural Earth was 44 vertices for unified Vietnam. The 50m clip is
    // an order of magnitude denser; a regression back to 110m fails this.
    expect(verts).toBeGreaterThan(200);
  });

  it("draws both halves for either Vietnam host", () => {
    expect(staticHostGeometry("SVN")?.codes).toEqual([...VIETNAM_FEATURE_IDS]);
    expect(staticHostGeometry("NVN")?.codes).toEqual([...VIETNAM_FEATURE_IDS]);
  });

  it("cuts at the 17th parallel, with the right half on each side", () => {
    const byId = new Map(collection.features.map((f) => [f.id, f]));
    const north = geoBounds(byId.get("NVN") as never);
    const south = geoBounds(byId.get("SVN") as never);
    // Both edges sit on the line to within a rounding of it, and NEITHER is
    // asserted exactly. `geoBounds` is spherical: the arc between two vertices
    // at 17°N bows poleward, so the northern half's minimum lands exactly on the
    // parallel while the southern half's maximum overshoots it by ~0.0005° (50
    // m of bulge). That is geodesy, not a bad cut — demanding equality here
    // would be demanding that a great circle be a straight line.
    expect(north[0][1]).toBeCloseTo(PARALLEL, 2);
    expect(south[1][1]).toBeCloseTo(PARALLEL, 2);
    // Hanoi is north of Saigon — a reversed clip would pass the bounds check.
    expect(geoCentroid(byId.get("NVN") as never)[1]).toBeGreaterThan(
      geoCentroid(byId.get("SVN") as never)[1]
    );
  });

  it("winds each ring so d3 fills the country and not the rest of the globe", () => {
    // The trap this guards: a CCW outer ring renders as "the globe minus the
    // shape", which paints the entire map in one country's colour.
    for (const f of collection.features) {
      expect(geoArea(f as never), f.id).toBeLessThan(Math.PI);
      expect(geoArea(f as never), f.id).toBeGreaterThan(0);
    }
  });

  it("is NOT a region shard", () => {
    // Region shards resolve each region's owner from `states`, which holds only
    // full-autonomous countries. Both Vietnams are sphere-macro, so ownership
    // could never resolve and the shard would be skipped every time.
    expect(REGION_SHARDS.some((s) => s.url === VIETNAM_GEO_URL)).toBe(false);
  });

  it("is claimed by the manifest, so the globe draws it as interactive", () => {
    const snapshot = getWorldEntityMapSnapshot("1953-default");
    for (const id of VIETNAM_FEATURE_IDS) {
      expect(snapshot.byFeatureId[id]?.entityId, id).toBe(id);
      expect(snapshot.byFeatureId[id]?.simulationTier, id).toBe("sphere-macro");
    }
    // Both were listed as unmapped before this geometry existed.
    expect(snapshot.unmappedEntityIds).not.toContain("NVN");
    expect(snapshot.unmappedEntityIds).not.toContain("SVN");
  });

  it("retires unified Vietnam rather than drawing it underneath", () => {
    // 704 is modern Vietnam: it does not exist in 1953, and left in place it
    // renders as an uncoloured background country beneath both halves.
    const snapshot = getWorldEntityMapSnapshot("1953-default");
    expect(snapshot.byFeatureId[VIETNAM_BASE_FEATURE_ID]).toBeUndefined();
  });

  it("is what the alignment roster points each half at", () => {
    expect(ROSTER_BY_KEY.NVN?.iso).toEqual(["NVN"]);
    expect(ROSTER_BY_KEY.SVN?.iso).toEqual(["SVN"]);
  });
});
