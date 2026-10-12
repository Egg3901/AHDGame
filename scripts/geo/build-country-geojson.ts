import {
  SUCCESSOR_REGION_COUNCILS,
  SUCCESSOR_COUNCIL_SOURCE,
} from "../../src/lib/countries/ukSuccessorRegions";
import { scoRegions } from "../../src/lib/seeds/sco/scoRegions";
import { walRegions } from "../../src/lib/seeds/wal/walRegions";
/**
 * Builds simplified macro-region GeoJSON files for IE, CN (+ Scotland/Wales) and
 * writes them to /public/. Each output file is a FeatureCollection where each
 * feature is one playable macro-region with `id` matching the region IDs in
 * `src/lib/seeds/{country}/Regions.ts`.
 *
 * NOTE: Brazil is built separately by scripts/maps/build-brazil-geo.mjs (it needs
 * finer quantization so its macro-regions union cleanly on the world map).
 *
 * Sources:
 *  - IE: Eurostat NUTS 2024 LEVL_3 GeoJSON (8 IE features map 1:1 to playable
 *        regions; only the NUTS_ID → internal ID rename is needed).
 *  - CN: Click-That-Hood `china.geojson` (34 first-level admin units); merged
 *        into 7 macro-regions using a hand-curated province → region map.
 *
 * Adjacent polygons within a macro-region are dissolved via topojson so the
 * resulting borders are clean (no internal seams). Run with:
 *   npx tsx scripts/geo/build-country-geojson.ts
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { topology } from "topojson-server";
import { merge as topoMerge } from "topojson-client";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { Topology, GeometryCollection } from "topojson-specification";

const PUBLIC_DIR = resolve(__dirname, "..", "..", "public");

const NE_NUTS3_URL =
  "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_10M_2024_4326_LEVL_3.geojson";
const CN_PROVINCES_URL =
  "https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/china.geojson";
async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch ${url}: ${r.status}`);
  return (await r.json()) as T;
}

/**
 * Maps NUTS3 ID → internal IE region ID.
 * Internal IDs use county-based codes; one geographic NUTS3 region maps to
 * the largest county in that region (or a geographic name for Midlands).
 */
const IE_NUTS3_TO_REGION: Record<string, { id: string; name: string }> = {
  IE041: { id: "DON", name: "Donegal" }, // Border
  IE042: { id: "GAL", name: "Galway" }, // West
  IE051: { id: "LIM", name: "Limerick" }, // Mid-West
  IE052: { id: "WEX", name: "Wexford" }, // South-East
  IE053: { id: "COR", name: "Cork" }, // South-West
  IE061: { id: "DUB", name: "Dublin" },
  IE062: { id: "KIL", name: "Kildare" }, // Mid-East
  IE063: { id: "MID", name: "Midlands" },
};

/** CN province name (as in click_that_hood) → internal CN region ID. */
const CN_PROVINCE_TO_REGION: Record<string, string> = {
  // NORTHEAST (Dongbei)
  Heilongjian: "DB",
  Jilin: "DB",
  Liaoning: "DB",
  // NORTH (Huabei)
  Beijing: "HB",
  Tianjin: "HB",
  Hebei: "HB",
  Shanxi: "HB",
  "Inner Mongolia": "HB",
  // EAST (Huadong) — Taiwan is in CN_EXCLUDED_PROVINCES, not rendered on either map
  Shanghai: "HD",
  Jiangsu: "HD",
  Zhejiang: "HD",
  Anhui: "HD",
  Fujian: "HD",
  Jiangxi: "HD",
  Shandong: "HD",
  // CENTRAL (Huazhong)
  Henan: "HZ",
  Hubei: "HZ",
  Hunan: "HZ",
  // SOUTH (Huanan)
  Guangdong: "HN",
  Guangxi: "HN",
  Hainan: "HN",
  "Hong Kong": "HN",
  Macau: "HN",
  // SOUTHWEST (Xinan)
  Chongqing: "XN",
  Sichuan: "XN",
  Guizhou: "XN",
  Yunnan: "XN",
  Tibet: "XN",
  // NORTHWEST (Xibei)
  Shaanxi: "XB",
  Gansu: "XB",
  Qinghai: "XB",
  Ningxia: "XB",
  Xinjiang: "XB",
};

const CN_REGION_NAMES: Record<string, string> = {
  DB: "Dongbei",
  HB: "Huabei",
  HD: "Huadong",
  HZ: "Huazhong",
  HN: "Huanan",
  XN: "Xinan",
  XB: "Xibei",
};

/**
 * Merges all features tagged with the same `regionId` (via the
 * `__regionId` property) into one Polygon/MultiPolygon feature using topojson.
 * Returns a FeatureCollection of merged features.
 */
function mergeByRegionId(
  features: Feature[],
  nameByRegion: Record<string, string>,
  quantization = 1e3
): FeatureCollection {
  // Group features by region ID; each group becomes its own object in the
  // topology so topoMerge dissolves only within the group.
  const byRegion: Record<string, Feature[]> = {};
  for (const f of features) {
    const id = (f.properties as { __regionId?: string })?.__regionId;
    if (!id) continue;
    (byRegion[id] ??= []).push(f);
  }

  const objects: Record<string, FeatureCollection> = {};
  for (const [regionId, fs] of Object.entries(byRegion)) {
    objects[regionId] = { type: "FeatureCollection", features: fs };
  }

  // Quantize at ~1e-4° (~10m at the equator) to share arcs cleanly. SVG maps
  // render at ~0.1°/pixel for these viewBoxes, so 10m precision is well below
  // the visible threshold and keeps file sizes manageable for BR/CN where
  // detailed coastlines dominate the byte count.
  const topo = topology(
    objects as unknown as Record<string, GeometryCollection | FeatureCollection>,
    quantization
  ) as Topology;

  const out: Feature[] = [];
  for (const regionId of Object.keys(byRegion)) {
    const obj = topo.objects[regionId];
    if (!obj) continue;
    // topoMerge dissolves all polygons in the object, removing shared arcs.
    const geom = topoMerge(topo, [obj] as never) as MultiPolygon | Polygon;
    out.push({
      type: "Feature",
      id: regionId,
      properties: { id: regionId, na: nameByRegion[regionId] ?? regionId },
      geometry: geom,
    });
  }
  return { type: "FeatureCollection", features: out };
}

async function buildIreland(): Promise<void> {
  const src = await fetchJson<FeatureCollection>(NE_NUTS3_URL);
  const tagged: Feature[] = [];
  for (const f of src.features) {
    const nutsId = String((f.properties as { NUTS_ID?: string }).NUTS_ID ?? "");
    const m = IE_NUTS3_TO_REGION[nutsId];
    if (!m) continue;
    tagged.push({
      type: "Feature",
      id: m.id,
      properties: { ...(f.properties ?? {}), __regionId: m.id },
      geometry: f.geometry,
    });
  }
  const nameByRegion: Record<string, string> = {};
  for (const v of Object.values(IE_NUTS3_TO_REGION)) nameByRegion[v.id] = v.name;
  // Pass through the same merge pipeline (with quantization) for size parity;
  // each NUTS3 is its own region so no actual dissolve happens.
  const fc = mergeByRegionId(tagged, nameByRegion);
  if (fc.features.length !== 8) {
    throw new Error(`IE: expected 8 features, got ${fc.features.length}`);
  }
  writeFileSync(resolve(PUBLIC_DIR, "ie-regions.json"), JSON.stringify(fc));
  console.log(`✓ IE: ${fc.features.length} regions → public/ie-regions.json`);
}

// Provinces excluded from BOTH CN maps. Taiwan is administered by the ROC, not
// the PRC; rendering it on the playable PRC map would imply control the game
// doesn't model. The cross-strait policy track (Taiwan Strait Doctrine
// legislation, taiwanStraitTension metric) is unaffected.
const CN_EXCLUDED_PROVINCES: ReadonlySet<string> = new Set(["Taiwan"]);

async function buildChina(): Promise<void> {
  const src = await fetchJson<FeatureCollection>(CN_PROVINCES_URL);
  const tagged: Feature[] = [];
  for (const f of src.features) {
    const name = String((f.properties as { name?: string }).name ?? "");
    if (CN_EXCLUDED_PROVINCES.has(name)) continue;
    const regionId = CN_PROVINCE_TO_REGION[name];
    if (!regionId) {
      console.warn(`CN: skipping unmapped province "${name}"`);
      continue;
    }
    tagged.push({
      ...f,
      properties: { ...(f.properties ?? {}), __regionId: regionId },
    });
  }
  const fc = mergeByRegionId(tagged, CN_REGION_NAMES);
  if (fc.features.length !== 7) {
    throw new Error(`CN: expected 7 features, got ${fc.features.length}`);
  }
  writeFileSync(resolve(PUBLIC_DIR, "cn-regions.json"), JSON.stringify(fc));
  console.log(`✓ CN: ${fc.features.length} regions → public/cn-regions.json`);
}

// Provinces excluded from the pre-handover (1991) CN map. Hong Kong was
// British until July 1, 1997; Macau was Portuguese until December 20, 1999.
// Both became Special Administrative Regions of the PRC after their respective
// handovers — but the 1991 game preset starts six years before HK and eight
// before Macau, so the modern map is anachronistic for those campaigns.
const CN_1991_EXCLUDED_PROVINCES: ReadonlySet<string> = new Set(["Hong Kong", "Macau"]);

async function buildChina1991(): Promise<void> {
  const src = await fetchJson<FeatureCollection>(CN_PROVINCES_URL);
  const tagged: Feature[] = [];
  for (const f of src.features) {
    const name = String((f.properties as { name?: string }).name ?? "");
    if (CN_EXCLUDED_PROVINCES.has(name)) continue;
    if (CN_1991_EXCLUDED_PROVINCES.has(name)) continue;
    const regionId = CN_PROVINCE_TO_REGION[name];
    if (!regionId) {
      console.warn(`CN-1991: skipping unmapped province "${name}"`);
      continue;
    }
    tagged.push({
      ...f,
      properties: { ...(f.properties ?? {}), __regionId: regionId },
    });
  }
  const fc = mergeByRegionId(tagged, CN_REGION_NAMES);
  if (fc.features.length !== 7) {
    throw new Error(`CN-1991: expected 7 features, got ${fc.features.length}`);
  }
  writeFileSync(resolve(PUBLIC_DIR, "cn-regions-1991.json"), JSON.stringify(fc));
  console.log(`✓ CN-1991: ${fc.features.length} regions → public/cn-regions-1991.json`);
}

/** Dissolve whole councils from the same membership used by regional council seats. */
export function buildSuccessorMap(
  country: "SCO" | "WAL",
  source: FeatureCollection
): FeatureCollection {
  const groups: Record<string, readonly { code: string; name: string }[]> =
    SUCCESSOR_REGION_COUNCILS[country];
  const lookup = new Map(
    Object.entries(groups).flatMap(([id, councils]) =>
      councils.map((council) => [council.code as string, id] as const)
    )
  );
  const expected = new Set(lookup.keys());
  const seen = new Set<string>();
  const tagged: Feature[] = [];
  for (const feature of source.features) {
    const code = String(feature.properties?.LAD24CD ?? "");
    if (!code.startsWith(country === "SCO" ? "S" : "W")) continue;
    const region = lookup.get(code);
    if (!region || seen.has(code)) throw new Error(`Unmapped or duplicate council: ${code}`);
    seen.add(code);
    tagged.push({ ...feature, properties: { ...feature.properties, __regionId: region } });
  }
  if (seen.size !== expected.size) throw new Error(`${country}: missing council boundaries`);
  const seeds = country === "SCO" ? scoRegions : walRegions;
  const result = mergeByRegionId(
    tagged,
    Object.fromEntries(seeds.map((region) => [region._id, region.name])),
    100_000
  );
  // Round quantized coordinates for transport; full floating point expansions
  // waste megabytes without adding boundary precision (five decimals is ~1m).
  for (const feature of result.features) {
    const geometry = feature.geometry;
    if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
      const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
      for (const polygon of polygons)
        for (const ring of polygon)
          for (const point of ring) {
            point[0] = Number(point[0].toFixed(5));
            point[1] = Number(point[1].toFixed(5));
          }
    }
    const councils = groups[String(feature.id)];
    feature.properties = {
      ...feature.properties,
      regionCode: feature.id,
      contains: councils.map((council) => council.name),
      councilCodes: councils.map((council) => council.code),
      source: SUCCESSOR_COUNCIL_SOURCE,
      license: "Open Government Licence v3.0",
      attribution:
        "Source: Office for National Statistics licensed under the Open Government Licence v.3.0. Contains OS data � Crown copyright and database right 2024.",
    };
  }
  return result;
}
async function buildSuccessor(country: "SCO" | "WAL"): Promise<void> {
  const query = new URLSearchParams({
    where: "LAD24CD LIKE 'S%' OR LAD24CD LIKE 'W%'",
    outFields: "LAD24CD,LAD24NM",
    outSR: "4326",
    f: "geojson",
  });
  const source = await fetchJson<FeatureCollection>(`${SUCCESSOR_COUNCIL_SOURCE}/query?${query}`);
  writeFileSync(
    resolve(PUBLIC_DIR, `${country.toLowerCase()}-regions.json`),
    JSON.stringify(buildSuccessorMap(country, source))
  );
}
const buildScotland = () => buildSuccessor("SCO");
const buildWales = () => buildSuccessor("WAL");

async function main(): Promise<void> {
  await Promise.all([
    buildIreland(),
    // Brazil is now built by scripts/maps/build-brazil-geo.mjs (finer quantization
    // so the macro-regions share borders and union cleanly into one blob on the
    // world map). buildBrazil() here quantizes at 1e3, which splits Brazil's NE
    // coast when unioned — do NOT re-enable it; it would overwrite the good shard.
    buildChina(),
    buildChina1991(),
    buildScotland(),
    buildWales(),
  ]);
}

if (process.argv[1] && resolve(process.argv[1]) === __filename)
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
