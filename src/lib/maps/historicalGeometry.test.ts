import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { HISTORICAL_FEATURE_IDS } from "./historicalGeometry";
import { getWorldEntityMapSnapshot } from "@/lib/world/worldEntityMap";

const shard = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "public/historical-regions.json"), "utf8")
) as {
  features: {
    id: string;
    properties: { regionCode: string; name: string };
    geometry: { type: string; coordinates: number[][][][] };
  }[];
};

/** Signed area; NEGATIVE is clockwise for this trapezoid form (see the build script). */
function ringArea(ring: number[][]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j]![0]! - ring[i]![0]!) * (ring[j]![1]! + ring[i]![1]!);
  }
  return sum / 2;
}

describe("historical territory geometry", () => {
  it("supplies exactly the features it declares", () => {
    const inFile = shard.features.map((f) => f.id).sort();
    expect(inFile).toEqual([...HISTORICAL_FEATURE_IDS].sort());
  });

  it("gives every feature a regionCode equal to its id", () => {
    // `useStaticHostGeometry` hands `codes: [hostEntityId]` to the conflict maps and
    // then filters the shard by `properties.regionCode`, so the two must be the same
    // string. They are only equal by construction in the build script, and when they
    // stop being equal the map renders an EMPTY BOX: the fetch succeeds, the features
    // are non-empty, and only the post-filter roster is empty — so every other
    // assertion in this file still passes. Hence pinning it directly.
    const mismatched = shard.features
      .filter((f) => String(f.properties?.regionCode) !== String(f.id))
      .map((f) => `${f.id} -> ${f.properties?.regionCode}`);
    expect(mismatched).toEqual([]);
  });

  it("winds every outer ring clockwise", () => {
    // d3-geo reads rings spherically: a counter-clockwise outer ring renders as the
    // whole globe MINUS the shape, which is how a bad shard turns the map inside
    // out. The shipping shards (vietnam, dd, hu) are all negative here.
    const offenders: string[] = [];
    for (const feature of shard.features) {
      for (const polygon of feature.geometry.coordinates) {
        if (ringArea(polygon[0]!) >= 0) offenders.push(feature.id);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("places each territory where it actually is", () => {
    // A wrong administrative match is invisible in a diff and obvious in a bbox —
    // Zanzibar built from the wrong region would still be valid GeoJSON.
    const expected: Record<string, [number, number, number, number]> = {
      // id: [minLon, maxLon, minLat, maxLat]
      SAAR: [6, 8, 49, 50],
      FTT: [13, 14, 45, 46],
      TNG: [-7, -5, 35, 36],
      ESH: [-7, -3, 34, 36],
      ZNZ: [39, 40, -7, -4],
      TGB: [-1, 2, 5, 9],
      CMB: [8, 12, 3, 8],
      ADN: [43, 49, 12, 16],
      YD: [43, 55, 12, 19],
      CZ: [-81, -79, 8, 10],
      TTPI: [131, 172, 3, 19],
    };

    for (const feature of shard.features) {
      const box = expected[feature.id];
      expect(box, `no expected bounds for ${feature.id}`).toBeDefined();
      let minLon = 180;
      let maxLon = -180;
      let minLat = 90;
      let maxLat = -90;
      for (const polygon of feature.geometry.coordinates) {
        for (const ring of polygon) {
          for (const [lon, lat] of ring) {
            minLon = Math.min(minLon, lon!);
            maxLon = Math.max(maxLon, lon!);
            minLat = Math.min(minLat, lat!);
            maxLat = Math.max(maxLat, lat!);
          }
        }
      }
      const [wLon, eLon, sLat, nLat] = box!;
      expect(minLon, `${feature.id} west`).toBeGreaterThanOrEqual(wLon);
      expect(maxLon, `${feature.id} east`).toBeLessThanOrEqual(eLon);
      expect(minLat, `${feature.id} south`).toBeGreaterThanOrEqual(sLat);
      expect(maxLat, `${feature.id} north`).toBeLessThanOrEqual(nLat);
    }
  });

  it("is claimed by the 1953 manifest, so nothing here is drawn for nobody", () => {
    const snapshot = getWorldEntityMapSnapshot("1953-default");
    for (const id of HISTORICAL_FEATURE_IDS) {
      expect(snapshot.byFeatureId[id], `${id} is unclaimed`).toMatchObject({ entityId: id });
    }
  });

  describe("draw order", () => {
    // These territories OVERLAY their host, so they are only visible when painted
    // after it — and a host with a region shard is painted twice, the second time as
    // a unioned blob. Getting this wrong hid the Saar (a German Land) and Trieste
    // (inside Italy) while the other nine still looked right, so eyeballing the map
    // does not catch it. Order here is a property of source order in a procedure,
    // which is why this is asserted on the source, as gdpReconcileOrdering does.
    const read = (p: string) => readFileSync(path.resolve(process.cwd(), p), "utf8");

    it("appends the territories after the region overlay on the world map", () => {
      const src = read("src/app/world/components/WorldMapSVG.tsx");
      // Anchored on the CALL, not the symbol: `computeRegionBlobs` is imported at the
      // top of the file, so matching the bare name put the anchor above every line in
      // the function body and the comparison passed no matter where the append sat.
      const overlay = src.indexOf("computeRegionBlobs(");
      const fetches = src.split("const histResp").length - 1;
      const append = src.indexOf("const histResp");
      expect(overlay, "computeRegionBlobs call not found").toBeGreaterThan(-1);
      // Exactly one, or "the last one is late enough" would hide an earlier copy.
      expect(fetches, "expected exactly one historical fetch").toBe(1);
      expect(append, "historical features must be appended AFTER the blobs").toBeGreaterThan(
        overlay
      );
    });

    it("paths the territories after the blobs on the organisation map", () => {
      // This map has no ordered feature array — draw order is insertion order into
      // its path Map — so the guard is that they are NOT pushed onto the feature
      // list, and are pathed after the blob loop fills `owners`.
      const src = read("src/app/world/international-organizations/components/OrgWorldMap.tsx");
      expect(src).not.toMatch(/geojson\.features\.push\(\.\.\.hist/);
      const blobs = src.indexOf("owners.set(key, owner)");
      const paths = src.indexOf("for (const f of histFeatures)");
      expect(blobs, "blob loop not found").toBeGreaterThan(-1);
      expect(paths, "historical path loop not found").toBeGreaterThan(-1);
      expect(paths, "historical features must be pathed AFTER the blobs").toBeGreaterThan(blobs);
    });
  });

  it("leaves only the three shard-drawn countries unmapped", () => {
    // Czechoslovakia, East Germany and Yugoslavia are drawn by REGION shards through
    // ownership and are correctly unmapped here — see worldEntityMap.test.ts. Every
    // other 1953 entity now has geometry.
    const snapshot = getWorldEntityMapSnapshot("1953-default");
    expect([...snapshot.unmappedEntityIds].sort()).toEqual(["CS", "DD", "YU"]);
  });
});
