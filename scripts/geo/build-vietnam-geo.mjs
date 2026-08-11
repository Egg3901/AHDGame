// Build public/vietnam-regions.json — the two Vietnams, split at the 17th
// parallel (the 1954 Geneva demarcation line, and the border the 1953 board
// needs even though Geneva is a year away).
//
// WHY A CLIP AND NOT A SOURCE FILE. Every other split state in the repo is
// assembled from real subdivisions: Germany from its Länder, Czechoslovakia from
// its historic lands, Yugoslavia from its federal units. Vietnam has no such
// division to draw on — the partition is a latitude, not a set of provinces — so
// the honest build is to cut the modern outline along it.
//
// WHY NOT THE REGION-OVERLAY MECHANISM. The overlay that draws East Germany
// resolves each region's owner from `states`, and `states` holds only the
// full-autonomous countries. NVN and SVN are sphere-macro, so they have no rows
// and never would without being promoted to full countries — a far larger change
// than a map fix. These are therefore STATIC features, owned by whichever entity
// the roster's `iso` points at, exactly as Thailand and Laos own theirs.
//
// Output winding is normalized to the repo convention: outer rings CLOCKWISE in
// (lon,lat), holes CCW — d3-geo interprets rings spherically and renders a CCW
// outer ring as "the globe minus the shape".
// Run: node scripts/maps/build-vietnam-geo.mjs
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { feature } from "topojson-client";
import polygonClipping from "polygon-clipping";

const __d = path.dirname(fileURLToPath(import.meta.url));
const pub = (f) => path.resolve(__d, "../../public", f);

/** Natural Earth id for unified Vietnam — the feature being divided. */
const VIETNAM_FEATURE_ID = "704";
/** The Geneva demarcation line. */
const PARALLEL = 17;

// Half-planes generous enough to contain Vietnam's bbox in every direction, so
// the intersection is bounded only by the parallel and the coastline.
const NORTH_BOX = [
  [
    [90, PARALLEL],
    [130, PARALLEL],
    [130, 40],
    [90, 40],
    [90, PARALLEL],
  ],
];
const SOUTH_BOX = [
  [
    [90, -5],
    [130, -5],
    [130, PARALLEL],
    [90, PARALLEL],
    [90, -5],
  ],
];

const windSignedArea = (r) => {
  let s = 0;
  for (let i = 0; i < r.length - 1; i++) s += (r[i + 1][0] - r[i][0]) * (r[i + 1][1] + r[i][1]);
  return s;
};
const rewind = (geometry) => {
  const fixRing = (ring, wantCW) => {
    const a = windSignedArea(ring);
    if (a === 0) return ring;
    return a > 0 === wantCW ? ring : ring.slice().reverse();
  };
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const fixed = polys.map((poly) => poly.map((ring, i) => fixRing(ring, i === 0)));
  return geometry.type === "Polygon"
    ? { type: "Polygon", coordinates: fixed[0] }
    : { type: "MultiPolygon", coordinates: fixed };
};

const topo = JSON.parse(readFileSync(pub("geo/countries-110m.json"), "utf8"));
const countries = feature(topo, topo.objects.countries);
const vietnam = countries.features.find((f) => String(f.id) === VIETNAM_FEATURE_ID);
if (!vietnam) throw new Error(`feature ${VIETNAM_FEATURE_ID} (Vietnam) not in the basemap`);

const asMulti =
  vietnam.geometry.type === "Polygon"
    ? [vietnam.geometry.coordinates]
    : vietnam.geometry.coordinates;

/** Clip Vietnam against a half-plane, returning a MultiPolygon. */
const clip = (box) => {
  const out = polygonClipping.intersection(asMulti, box);
  if (!out.length) throw new Error("clip produced no geometry — check the parallel and the bbox");
  return out;
};

const REGIONS = [
  {
    regionCode: "NVN",
    name: "North Vietnam",
    // The DRV: everything above the line, Hanoi and Haiphong included.
    coordinates: clip(NORTH_BOX),
  },
  {
    regionCode: "SVN",
    name: "South Vietnam",
    // The State/Republic of Vietnam: everything below, Saigon included.
    coordinates: clip(SOUTH_BOX),
  },
];

const collection = {
  type: "FeatureCollection",
  features: REGIONS.map((r) => ({
    type: "Feature",
    // The id IS the entity key: these are static features owned outright, not
    // regions whose owner is looked up.
    id: r.regionCode,
    properties: { regionCode: r.regionCode, name: r.name },
    geometry: rewind({ type: "MultiPolygon", coordinates: r.coordinates }),
  })),
};

writeFileSync(pub("vietnam-regions.json"), JSON.stringify(collection));
for (const f of collection.features) {
  const rings = f.geometry.coordinates.reduce((n, p) => n + p.length, 0);
  console.log(`${f.id}: ${f.geometry.coordinates.length} polygon(s), ${rings} ring(s)`);
}
console.log("wrote public/vietnam-regions.json");
