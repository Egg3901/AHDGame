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
 *   npx tsx scripts/build-country-geojson.ts
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { topology } from "topojson-server";
import { merge as topoMerge } from "topojson-client";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { Topology, GeometryCollection } from "topojson-specification";

const PUBLIC_DIR = resolve(__dirname, "..", "public");

const NE_NUTS3_URL =
  "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_10M_2024_4326_LEVL_3.geojson";
const CN_PROVINCES_URL =
  "https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/china.geojson";
// Pre-Brexit Eurostat NUTS3 (2016) still carries UK regions — Scotland (UKM*)
// and Wales (UKL*) — which the 2024 file dropped. Used to build the seceded
// SCO/WAL sub-region maps by dissolving NUTS3 into the seed macro-regions.
const UK_NUTS3_2016_URL =
  "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_10M_2016_4326_LEVL_3.geojson";

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
  nameByRegion: Record<string, string>
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
    1e3
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

/**
 * Scottish NUTS3 (2016, UKM*) → the 7 SCO seed macro-regions
 * (src/lib/seeds/sco/scoRegions.ts). Grouped by geography to match each seed
 * region's intent (Greater Glasgow, Edinburgh & the Lothians, …).
 */
const SCO_NUTS3_TO_REGION: Record<string, string> = {
  UKM82: "GLA",
  UKM81: "GLA",
  UKM83: "GLA", // Greater Glasgow + Dunbartonshire/Renfrewshire
  UKM75: "LOT",
  UKM73: "LOT",
  UKM78: "LOT", // Edinburgh + East/Mid/West Lothian
  UKM61: "HIG",
  UKM62: "HIG",
  UKM63: "HIG",
  UKM64: "HIG",
  UKM65: "HIG",
  UKM66: "HIG", // Highlands & Islands
  UKM50: "GRA", // Aberdeen City & Aberdeenshire
  UKM71: "TAY",
  UKM72: "TAY",
  UKM77: "TAY", // Angus/Dundee + Fife + Perth/Stirling
  UKM91: "STH",
  UKM92: "STH",
  UKM93: "STH",
  UKM94: "STH",
  UKM95: "STH", // Borders, D&G, Ayrshire, S Lanark
  UKM84: "CSC",
  UKM76: "CSC", // North Lanarkshire + Falkirk
};
const SCO_REGION_NAMES: Record<string, string> = {
  GLA: "Greater Glasgow",
  LOT: "Edinburgh & the Lothians",
  HIG: "Highlands & Islands",
  GRA: "North East Scotland",
  TAY: "Tayside & Fife",
  STH: "South Scotland",
  CSC: "Central Scotland",
};

/** Welsh NUTS3 (2016, UKL*) → the 6 WAL seed macro-regions. */
const WAL_NUTS3_TO_REGION: Record<string, string> = {
  UKL22: "CDF",
  UKL21: "CDF", // Cardiff & Vale + Monmouthshire/Newport
  UKL14: "SWA",
  UKL17: "SWA",
  UKL18: "SWA", // South West Wales + Bridgend/NPT + Swansea
  UKL15: "VAL",
  UKL16: "VAL", // Central + Gwent Valleys
  UKL24: "MWA", // Powys
  UKL11: "NWW",
  UKL12: "NWW",
  UKL13: "NWW", // Anglesey + Gwynedd + Conwy/Denbighshire
  UKL23: "NEW", // Flintshire & Wrexham
};
const WAL_REGION_NAMES: Record<string, string> = {
  CDF: "Cardiff & South East",
  SWA: "Swansea & South West",
  VAL: "The Valleys",
  MWA: "Mid Wales",
  NWW: "North West Wales",
  NEW: "North East Wales",
};

/** Shared builder: dissolve UK NUTS3 (2016) into a country's seed macro-regions. */
async function buildUKDevolved(
  country: "SCO" | "WAL",
  prefix: "UKM" | "UKL",
  nuts3ToRegion: Record<string, string>,
  regionNames: Record<string, string>,
  expectedRegions: number,
  outFile: string
): Promise<void> {
  const src = await fetchJson<FeatureCollection>(UK_NUTS3_2016_URL);
  const tagged: Feature[] = [];
  const contains: Record<string, string[]> = {};
  for (const f of src.features) {
    const nuts = String((f.properties as { NUTS_ID?: string }).NUTS_ID ?? "");
    if (!nuts.startsWith(prefix)) continue;
    const regionId = nuts3ToRegion[nuts];
    if (!regionId) {
      console.warn(`${country}: unmapped NUTS3 ${nuts}`);
      continue;
    }
    const name = String((f.properties as { NAME_LATN?: string }).NAME_LATN ?? nuts);
    (contains[regionId] ??= []).push(name);
    tagged.push({ ...f, properties: { ...(f.properties ?? {}), __regionId: regionId } });
  }
  const fc = mergeByRegionId(tagged, regionNames);
  // Tag each merged feature with `regionCode` (RegionalGeoMap filters on it) and
  // its constituent council/area names (hero-bar "covers …", per the IE map).
  for (const feat of fc.features) {
    const id = String(feat.id);
    (feat.properties as Record<string, unknown>).regionCode = id;
    (feat.properties as Record<string, unknown>).contains = (contains[id] ?? []).sort();
  }
  if (fc.features.length !== expectedRegions) {
    throw new Error(`${country}: expected ${expectedRegions} features, got ${fc.features.length}`);
  }
  writeFileSync(resolve(PUBLIC_DIR, outFile), JSON.stringify(fc));
  console.log(`✓ ${country}: ${fc.features.length} regions → public/${outFile}`);
}

const buildScotland = () =>
  buildUKDevolved("SCO", "UKM", SCO_NUTS3_TO_REGION, SCO_REGION_NAMES, 7, "sco-regions.json");
const buildWales = () =>
  buildUKDevolved("WAL", "UKL", WAL_NUTS3_TO_REGION, WAL_REGION_NAMES, 6, "wal-regions.json");

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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
