// Build public/tr-regions.json from Turkey's 81 ADM1 provinces — dissolve them
// into the game's 8 macro-regions (TR_REGION_CODES; the 7 classic geographic
// regions with Ankara province carved out of Central Anatolia, matching
// src/lib/seeds/tr/trRegions.ts). Provinces are dissolved through ONE shared
// topojson topology so adjacent regions share border arcs and union cleanly
// into one Turkey blob on the /world overlay (see build-brazil-geo.mjs).
//
// Output winding is normalized to the repo convention: outer rings CLOCKWISE
// in (lon,lat), holes CCW — d3-geo interprets rings spherically and renders a
// CCW outer ring as "the globe minus the shape".
//
// Sources (first that works): Click-that-Hood turkey.geojson (properties.name),
// geoBoundaries gbOpen TUR ADM1 (properties.shapeName).
// Network: fetches the upstream GeoJSON. Deterministic (sorted by regionCode).
// Run: node scripts/maps/build-tr-geo.mjs
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { topology } from "topojson-server";
import { merge as topoMerge } from "topojson-client";

const __d = path.dirname(fileURLToPath(import.meta.url));
const pub = (f) => path.resolve(__d, "../../public", f);

const SOURCES = [
  {
    name: "click-that-hood",
    url: "https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/turkey.geojson",
    nameProp: (p) => p?.name,
  },
  {
    name: "geoBoundaries TUR ADM1",
    url: "https://www.geoboundaries.org/api/current/gbOpen/TUR/ADM1/",
    nameProp: (p) => p?.shapeName,
    indirect: true, // API returns metadata; the GeoJSON itself is at .gjDownloadURL
  },
];

// Turkish-alphabet fold → ascii lowercase, so source spelling variants
// (İstanbul/Istanbul, Şanlıurfa/Sanliurfa) all key the same.
const fold = (s) =>
  s
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .replace(/ı/g, "i")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");

// Historic/short names some datasets use.
const ALIASES = {
  afyon: "afyonkarahisar",
  icel: "mersin",
  maras: "kahramanmaras",
  kmaras: "kahramanmaras",
  urfa: "sanliurfa",
  antep: "gaziantep",
};

const REGIONS = {
  TR_IST: {
    na: "Marmara",
    provinces: [
      "İstanbul",
      "Balıkesir",
      "Bilecik",
      "Bursa",
      "Çanakkale",
      "Edirne",
      "Kırklareli",
      "Kocaeli",
      "Sakarya",
      "Tekirdağ",
      "Yalova",
    ],
  },
  TR_ANK: { na: "Ankara", provinces: ["Ankara"] },
  TR_IZM: {
    na: "Aegean",
    provinces: [
      "İzmir",
      "Aydın",
      "Denizli",
      "Kütahya",
      "Manisa",
      "Muğla",
      "Uşak",
      "Afyonkarahisar",
    ],
  },
  TR_MED: {
    na: "Mediterranean",
    provinces: [
      "Adana",
      "Antalya",
      "Burdur",
      "Hatay",
      "Isparta",
      "Mersin",
      "Kahramanmaraş",
      "Osmaniye",
    ],
  },
  TR_BLA: {
    na: "Black Sea",
    provinces: [
      "Amasya",
      "Artvin",
      "Bartın",
      "Bayburt",
      "Bolu",
      "Çorum",
      "Düzce",
      "Giresun",
      "Gümüşhane",
      "Karabük",
      "Kastamonu",
      "Ordu",
      "Rize",
      "Samsun",
      "Sinop",
      "Tokat",
      "Trabzon",
      "Zonguldak",
    ],
  },
  TR_ESA: {
    na: "Eastern Anatolia",
    provinces: [
      "Ağrı",
      "Ardahan",
      "Bingöl",
      "Bitlis",
      "Elazığ",
      "Erzincan",
      "Erzurum",
      "Hakkâri",
      "Iğdır",
      "Kars",
      "Malatya",
      "Muş",
      "Tunceli",
      "Van",
    ],
  },
  TR_SEA: {
    na: "Southeastern Anatolia",
    provinces: [
      "Adıyaman",
      "Batman",
      "Diyarbakır",
      "Gaziantep",
      "Kilis",
      "Mardin",
      "Siirt",
      "Şanlıurfa",
      "Şırnak",
    ],
  },
  TR_CEN: {
    na: "Central Anatolia",
    provinces: [
      "Aksaray",
      "Çankırı",
      "Eskişehir",
      "Karaman",
      "Kayseri",
      "Kırıkkale",
      "Kırşehir",
      "Konya",
      "Nevşehir",
      "Niğde",
      "Sivas",
      "Yozgat",
    ],
  },
};

const PROVINCE_TO_REGION = new Map();
for (const [regionId, { provinces }] of Object.entries(REGIONS))
  for (const p of provinces) PROVINCE_TO_REGION.set(fold(p), regionId);
if (PROVINCE_TO_REGION.size !== 81)
  throw new Error(`province table has ${PROVINCE_TO_REGION.size} entries, expected 81`);

// Fine enough that adjacent provinces keep identical shared-border vertices (so
// the dissolved regions union cleanly into one Turkey on the world map), coarse
// enough to keep the file web-sized. Same value as build-brazil-geo.mjs.
const QUANTIZATION = 7e3;
// Drop islands smaller than this (deg²; ~60 km²) — sub-pixel at both render
// scales. Keeps Gökçeada; sheds Bozcaada/Marmara-sea specks.
const MIN_ISLAND_AREA = 5e-3;

const ringArea = (ring) => {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++)
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
};
const dropTinyIslands = (geometry) => {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const kept = polys.filter((poly) => Math.abs(ringArea(poly[0])) >= MIN_ISLAND_AREA);
  return kept.length === 1
    ? { type: "Polygon", coordinates: kept[0] }
    : { type: "MultiPolygon", coordinates: kept };
};

// > 0 => clockwise in (lon,lat).
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

async function fetchSource() {
  for (const s of SOURCES) {
    try {
      let url = s.url;
      if (s.indirect) {
        const meta = await (await fetch(url)).json();
        url = meta?.gjDownloadURL;
        if (!url) throw new Error("no gjDownloadURL");
      }
      const gj = await (await fetch(url)).json();
      if (gj?.features?.length) return { ...s, gj };
      throw new Error("no features");
    } catch (e) {
      console.warn(`source ${s.name} failed: ${e.message}`);
    }
  }
  throw new Error("all sources failed");
}

const { gj, nameProp, name: sourceName } = await fetchSource();
console.log(`source: ${sourceName}, ${gj.features.length} features`);

const objects = {};
const seen = new Set();
for (const f of gj.features) {
  const raw = nameProp(f.properties);
  if (!raw) throw new Error(`feature with no name: ${JSON.stringify(f.properties)}`);
  const folded = fold(raw);
  const key = ALIASES[folded] ? fold(ALIASES[folded]) : folded;
  const regionId = PROVINCE_TO_REGION.get(key);
  if (!regionId) throw new Error(`unmapped province: "${raw}" (folded: ${key})`);
  if (seen.has(key)) throw new Error(`duplicate province: "${raw}"`);
  seen.add(key);
  (objects[regionId] ??= { type: "FeatureCollection", features: [] }).features.push(f);
}
if (seen.size !== 81) throw new Error(`consumed ${seen.size} provinces, expected 81`);

const topo = topology(objects, QUANTIZATION);

const out = [];
for (const [regionId, { na }] of Object.entries(REGIONS)) {
  const obj = topo.objects[regionId];
  if (!obj) throw new Error(`no provinces mapped to ${regionId}`);
  // topoMerge dissolves the region's provinces, removing internal shared arcs.
  const geometry = rewind(dropTinyIslands(topoMerge(topo, [obj])));
  out.push({
    type: "Feature",
    id: regionId,
    properties: { id: regionId, na, regionCode: regionId },
    geometry,
  });
}
out.sort((a, b) => a.properties.regionCode.localeCompare(b.properties.regionCode));

const json = JSON.stringify({ type: "FeatureCollection", features: out });
writeFileSync(pub("tr-regions.json"), json + "\n");
console.log(
  `wrote ${out.length} features (${(json.length / 1024).toFixed(0)}KB): ${out
    .map((f) => f.properties.regionCode)
    .join(", ")}`
);
