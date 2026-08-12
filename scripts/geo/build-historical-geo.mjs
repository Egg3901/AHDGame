// Build public/historical-regions.json â€” whole-territory outlines for the 1953
// entities that have no present-day equivalent to borrow.
//
// These are the leftovers after `mapFeatureIds`: an entity that corresponds
// outright to a modern feature (Congo â†’ 180, Somalia â†’ 706) needs nothing built,
// and one drawn by a region shard (Czechoslovakia, Yugoslavia, East Germany) is
// already covered by ownership. What remains are historical territories that sit
// INSIDE a modern country â€” a protectorate, a trust territory, an international
// zone â€” and so can never be named by an ISO numeric.
//
// Each is assembled from real administrative units rather than drawn by hand:
// geoBoundaries ADM1/ADM2 for the mainland cases, and the repo's own 50m basemap
// for the Pacific islands, which the 110m runtime basemap omits entirely. The
// borders are therefore genuine modern administrative lines, which for these
// territories is what the historical border actually followed â€” Saarland IS the
// Saar Protectorate, Zanzibar's regions ARE Zanzibar.
//
// Whole territories only, deliberately: no internal region splits. These entities
// are sphere-macro or historical-presence, so nothing in the game asks them to
// have provinces.
//
// Output winding is normalized to the repo convention: outer rings CLOCKWISE in
// (lon,lat), holes CCW â€” d3-geo reads rings spherically and renders a CCW outer
// ring as "the globe minus the shape".
//
// Run: node scripts/maps/build-historical-geo.mjs
import { writeFileSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { feature as topoFeature } from "topojson-client";

const __d = path.dirname(fileURLToPath(import.meta.url));
const pub = (f) => path.resolve(__d, "../../public", f);

const GB = (iso, adm) => `https://www.geoboundaries.org/api/current/gbOpen/${iso}/${adm}/`;

/**
 * One entry per entity. `pick` selects the administrative units that make up the
 * territory, matched on the shapeName geoBoundaries carries.
 *
 * Names are matched case-insensitively on a substring so a source that renames
 * "Zanzibar North" to "Kaskazini Unguja" does not silently drop a piece â€” a miss
 * throws below rather than writing a hole in the map.
 */
const SOURCES = [
  {
    id: "SAAR",
    name: "Saar Protectorate",
    iso: "DEU",
    adm: "ADM1",
    match: ["Saarland"],
    note: "The protectorate is exactly the modern Land.",
  },
  {
    // Italy's ADM2 in this source is regions, not provinces â€” Trieste only appears
    // one level down.
    id: "FTT",
    name: "Free Territory of Trieste",
    iso: "ITA",
    adm: "ADM3",
    match: ["Trieste"],
    note: "Zone A. Zone B passed to Yugoslavia in 1954 and is inside Slovenia/Croatia today.",
  },
  {
    id: "TNG",
    name: "Tangier International Zone",
    iso: "MAR",
    adm: "ADM2",
    // "Prefecture of Tangier - Assilah". Matched on Assilah, which is unique in the
    // layer â€” "Tangier" alone also appears in the ADM1 region name.
    match: ["Assilah"],
    note: "The zone was the city and its immediate hinterland.",
  },
  {
    id: "ESH",
    name: "Spanish Morocco",
    iso: "MAR",
    adm: "ADM1",
    match: ["Tangier-Tetouan"],
    note: "The northern (Rif) protectorate. Not Western Sahara, despite the entity id.",
  },
  {
    id: "ZNZ",
    name: "Zanzibar",
    iso: "TZA",
    adm: "ADM1",
    match: ["Zanzibar", "Unguja", "Pemba", "Kaskazini", "Kusini", "Mjini Magharibi"],
    note: "Unguja and Pemba â€” the islands, never the mainland.",
  },
  {
    id: "TGB",
    name: "British Togoland",
    iso: "GHA",
    adm: "ADM1",
    match: ["Volta", "Oti", "Northern East"],
    note: "Joined Ghana in 1957; the Volta strip is what the trust territory became.",
  },
  {
    id: "CMB",
    name: "British Cameroons",
    iso: "CMR",
    adm: "ADM1",
    match: ["North-West", "South-West", "Nord-Ouest", "Sud-Ouest"],
    note: "Southern Cameroons. The northern part joined Nigeria and is not drawn.",
  },
  {
    id: "ADN",
    name: "Aden Protectorate",
    iso: "YEM",
    adm: "ADM1",
    // Yemen's governorate names carry the Ê¿ayn (Ê¿Adan, Ad Dali'), so these match on
    // the stable parts of each name rather than on exact transliterations.
    match: ["adan", "lahij", "abyan", "dali", "shabwah"],
    note: "The colony plus the western protectorate states.",
  },
  {
    id: "YD",
    name: "South Yemen",
    iso: "YEM",
    adm: "ADM1",
    match: ["adan", "lahij", "abyan", "dali", "shabwah", "hadhramaut", "mahrah", "socotra"],
    note: "The PDRY: the Aden Protectorate plus the eastern governorates and Socotra.",
  },
  // NOTE: `ST` (Somalia Trust Territories) is deliberately NOT built here.
  // It reads as the Italian south, but its own manifest record defines it as the
  // Italian UN Trust Territory of Somaliland PLUS British Somaliland, as one
  // dependency record - which is the whole of modern Somalia. It therefore takes
  // the 706 proxy like `SO`, rather than a hand-assembled southern subset that
  // would have quietly dropped the north.
];

/**
 * The Panama Canal Zone: the one territory with no administrative unit to borrow.
 *
 * It was a five-mile strip either side of the canal, abolished in 1979 and absorbed
 * into PanamÃ¡ and ColÃ³n provinces â€” so no modern boundary set contains it, and
 * unlike every other entry here it has to be described directly. The corridor below
 * follows the canal's own alignment from LimÃ³n Bay to the Pacific, which is what
 * the Zone's borders were surveyed from.
 *
 * Deliberately the only hand-written geometry in this file.
 */
const CANAL_ZONE = {
  id: "CZ",
  name: "Panama Canal Zone",
  note: "A ~5-mile corridor either side of the canal; no modern admin unit survives it.",
  // Longitude/latitude pairs tracing the corridor: down the Caribbean side, across
  // the isthmus, and back up. Closes on its first point.
  ring: [
    [-79.95, 9.42],
    [-79.72, 9.38],
    [-79.62, 9.28],
    [-79.55, 9.15],
    [-79.5, 9.05],
    [-79.52, 8.93],
    [-79.62, 8.88],
    [-79.6, 8.92],
    [-79.68, 9.02],
    [-79.75, 9.12],
    [-79.85, 9.25],
    [-80.0, 9.35],
    [-79.95, 9.42],
  ],
};

/** Fetch a geoBoundaries layer and return its GeoJSON. */
async function fetchLayer(iso, adm) {
  const metaResp = await fetch(GB(iso, adm));
  if (!metaResp.ok) throw new Error(`geoBoundaries meta ${iso}/${adm}: HTTP ${metaResp.status}`);
  const meta = await metaResp.json();
  const url = meta.gjDownloadURL ?? meta[0]?.gjDownloadURL;
  if (!url) throw new Error(`geoBoundaries ${iso}/${adm}: no gjDownloadURL`);
  const geoResp = await fetch(url);
  if (!geoResp.ok) throw new Error(`geoBoundaries geo ${iso}/${adm}: HTTP ${geoResp.status}`);
  return geoResp.json();
}

const norm = (s) => String(s ?? "").toLowerCase();

/** Rings â†’ polygon list, so Polygon and MultiPolygon merge the same way. */
function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

/**
 * Simplification budget.
 *
 * geoBoundaries ships survey-resolution outlines â€” South Yemen alone arrives as
 * 38,000 points â€” and these draw at globe scale beside a 110m basemap whose whole
 * world is 105 KB. Shipping the raw lines would put megabytes on the map load for
 * territories a few pixels wide, which is the shard-download regression this repo
 * has hit before.
 *
 * `TOLERANCE_DEG` is the Douglasâ€“Peucker threshold in degrees: ~0.005Â° is roughly
 * 500 m, invisible at any zoom the world map offers. `MIN_RING_AREA_DEG2` drops
 * offshore specks while keeping every real island â€” Pemba and Palau survive it by
 * three orders of magnitude.
 */
const TOLERANCE_DEG = 0.005;
const MIN_RING_AREA_DEG2 = 1e-5;
const COORD_DECIMALS = 4;

/** Perpendicular distance from p to the segment ab, in degrees. */
function perpDistance(p, a, b) {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Douglasâ€“Peucker on an open point list. */
function simplifyPoints(points, tolerance) {
  if (points.length < 3) return points;
  let maxDist = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistance(points[i], points[0], points[points.length - 1]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist <= tolerance) return [points[0], points[points.length - 1]];
  return [
    ...simplifyPoints(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplifyPoints(points.slice(index), tolerance),
  ];
}

/**
 * Simplify a closed ring, keeping it closed and keeping it a ring.
 *
 * A ring that simplifies below four points is no longer an area â€” it is returned
 * as null and dropped by the caller rather than written as a degenerate sliver.
 */
function simplifyRing(ring, tolerance) {
  const open = ring.slice(0, -1);
  const simplified = simplifyPoints(open, tolerance);
  if (simplified.length < 3) return null;
  const closed = [...simplified, simplified[0]];
  return closed.map((point) => point.map((n) => Number(n.toFixed(COORD_DECIMALS))));
}

/**
 * Signed area of a ring in (lon,lat).
 *
 * ⚠️ NEGATIVE IS CLOCKWISE for this trapezoid form — Σ(x_prev − x_cur)(y_prev +
 * y_cur). Check it on a square traced (0,0)→(0,1)→(1,1)→(1,0): that is clockwise
 * with y pointing up, and the sum comes out −1.
 *
 * Getting the sign backwards inverts every outer ring, and d3-geo then draws each
 * territory as the whole globe minus itself. The shipping shards are the ground
 * truth here — vietnam, dd and hu all carry NEGATIVE outer rings, and any new shard
 * has to match them.
 */
function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return sum / 2;
}

/**
 * Simplify, drop specks, and set the winding â€” outer rings clockwise, holes
 * counter-clockwise, the repo convention. d3-geo reads rings spherically and
 * renders a CCW outer ring as "the globe minus the shape", so this is not cosmetic.
 */
function finalizePolygons(polygons) {
  const out = [];
  for (const rings of polygons) {
    const [outerRaw, ...holesRaw] = rings;
    const outer = simplifyRing(outerRaw, TOLERANCE_DEG);
    // An outer ring below the floor is an offshore speck. Dropping it drops the
    // whole polygon: its holes describe nothing without it, and keeping them would
    // silently promote a hole to a landmass.
    if (!outer || Math.abs(ringArea(outer)) < MIN_RING_AREA_DEG2) continue;

    // Outer rings clockwise, i.e. NEGATIVE area (see ringArea).
    const simplified = [ringArea(outer) < 0 ? outer : [...outer].reverse()];
    for (const holeRaw of holesRaw) {
      const hole = simplifyRing(holeRaw, TOLERANCE_DEG);
      // A hole below the floor is smaller than the ink used to draw it.
      if (!hole || Math.abs(ringArea(hole)) < MIN_RING_AREA_DEG2) continue;
      // Holes wind the other way.
      simplified.push(ringArea(hole) > 0 ? hole : [...hole].reverse());
    }
    out.push(simplified);
  }
  return out;
}

async function buildFromGeoBoundaries(source) {
  const layer = await fetchLayer(source.iso, source.adm);
  const wanted = source.match.map(norm);
  const hits = layer.features.filter((f) => {
    const name = norm(f.properties?.shapeName);
    return wanted.some((w) => name.includes(w));
  });
  if (hits.length === 0) {
    throw new Error(
      `${source.id}: matched no ${source.iso}/${source.adm} unit from [${source.match.join(", ")}]`
    );
  }
  const polygons = hits.flatMap((f) => polygonsOf(f.geometry));
  console.log(`  ${source.id}: ${hits.length} unit(s), ${polygons.length} polygon(s)`);
  return polygons;
}

/**
 * The Trust Territory of the Pacific Islands, from the repo's own 50m basemap.
 *
 * The runtime map loads countries-110m, which drops every one of these islands â€”
 * so unlike the mainland cases this cannot be a `mapFeatureIds` proxy even though
 * the modern states match the trust territory exactly. 50m carries all four.
 */
function buildPacificIslands() {
  const topo = JSON.parse(readFileSync(pub("geo/countries-50m.json"), "utf8"));
  const key = Object.keys(topo.objects)[0];
  const collection = topoFeature(topo, topo.objects[key]);
  // Micronesia, Marshall Islands, Palau, Northern Mariana Islands.
  const ids = new Set(["583", "584", "585", "580"]);
  const hits = collection.features.filter((f) => ids.has(String(f.id)));
  if (hits.length !== ids.size) {
    throw new Error(`TTPI: expected ${ids.size} island features, found ${hits.length}`);
  }
  const polygons = hits.flatMap((f) => polygonsOf(f.geometry));
  console.log(`  TTPI: ${hits.length} island group(s), ${polygons.length} polygon(s)`);
  return polygons;
}

async function main() {
  const features = [];

  console.log("Building historical territories:");
  for (const source of SOURCES) {
    const polygons = await buildFromGeoBoundaries(source);
    features.push({
      type: "Feature",
      id: source.id,
      properties: { regionCode: source.id, name: source.name, note: source.note },
      geometry: { type: "MultiPolygon", coordinates: finalizePolygons(polygons) },
    });
  }

  features.push({
    type: "Feature",
    id: CANAL_ZONE.id,
    properties: {
      regionCode: CANAL_ZONE.id,
      name: CANAL_ZONE.name,
      note: CANAL_ZONE.note,
    },
    geometry: {
      type: "MultiPolygon",
      coordinates: finalizePolygons([[CANAL_ZONE.ring]]),
    },
  });
  console.log(`  ${CANAL_ZONE.id}: hand-described corridor (no admin unit exists)`);

  features.push({
    type: "Feature",
    id: "TTPI",
    properties: {
      regionCode: "TTPI",
      name: "Trust Territory of the Pacific Islands",
      note: "Micronesia, the Marshalls, Palau and the Northern Marianas, from the 50m basemap.",
    },
    geometry: { type: "MultiPolygon", coordinates: finalizePolygons(buildPacificIslands()) },
  });

  const out = { type: "FeatureCollection", features };
  writeFileSync(pub("historical-regions.json"), JSON.stringify(out));
  console.log(`\nWrote public/historical-regions.json â€” ${features.length} territories.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
