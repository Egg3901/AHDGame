// Build public/ru-regions.json — the USSR's 17 macro-regions (matching
// src/lib/seeds/ru/ruRegions.ts), each output feature tagged properties.regionCode
// (= the game's states._id). Geometry source for the SU RegionalGeoMap.
//
//   • 10 RSFSR economic regions — dissolved from the 83 Russian federal subjects
//     (Click-That-Hood russia.geojson) grouped per the Soviet economic regions.
//   • 7 union republics — Ukraine, Kazakhstan, Transcaucasia (GE+AM+AZ), Central
//     Asia (UZ+KG+TJ+TM), Moldova, Byelorussia, and the Baltics (EE+LV+LT) — taken
//     whole from countries-50m (Natural Earth 1:50m). The world map draws these
//     from the coarser countries-110m, but the base features sit hidden under this
//     blob, so the shard uses 50m to match the detail of the russia.geojson regions
//     instead of the blocky ~30-point 110m outlines. All seven were constituent
//     union republics in both the 1953 and 1979 presets; Byelorussia and the
//     Baltics were NOT sovereign satellite states like PL/RO/HU/DD/CS/BG.
//   • Kaliningrad Oblast (an RSFSR exclave physically detached from mainland Russia
//     by the Lithuanian + Byelorussian SSRs) is folded into the Baltics region it
//     borders, so NW Russia renders as one contiguous body rather than a mainland
//     plus a lone western fragment.
//
// All regions dissolve through ONE shared topology (Brazil technique) so they share
// borders and union cleanly. Far-East subjects cross the antimeridian, so eastern
// longitudes are unwrapped to >180 (contiguous 19..191 range) for a sane bbox/fit.
//
// Network: fetches russia.geojson. Deterministic (sorted by regionCode).
// Run: node scripts/maps/build-ru-geo.mjs
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { topology } from "topojson-server";
import { merge as topoMerge, feature as topoFeature } from "topojson-client";

const __d = path.dirname(fileURLToPath(import.meta.url));
const pub = (f) => path.resolve(__d, "../../public", f);

const RU_URL =
  "https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/russia.geojson";

// Russian federal subject (name_latin) → RSFSR economic-region code.
const SUBJECT_TO_REGION = {
  // CEN — Central
  Moscow: "CEN",
  "Moscow Oblast": "CEN",
  "Bryansk Oblast": "CEN",
  "Vladimir Oblast": "CEN",
  "Ivanovo Oblast": "CEN",
  "Kaluga Oblast": "CEN",
  "Kostroma Oblast": "CEN",
  "Oryol Oblast": "CEN",
  "Ryazan Oblast": "CEN",
  "Smolensk Oblast": "CEN",
  "Tver Oblast": "CEN",
  "Tula Oblast": "CEN",
  "Yaroslavl Oblast": "CEN",
  // NWR — Northwest
  "Saint Petersburg": "NWR",
  "Leningrad Oblast": "NWR",
  "Novgorod Oblast": "NWR",
  "Pskov Oblast": "NWR",
  // Kaliningrad is an RSFSR exclave cut off from mainland NWR by the Lithuanian +
  // Byelorussian SSRs. It used to be folded into the Baltics region so that NWR
  // was one contiguous body, but the Baltics are their own country now and
  // Kaliningrad stayed Russian, so it goes back to NWR as a detached fragment.
  "Kaliningrad Oblast": "NWR",
  // NOR — European North
  "Arkhangelsk Oblast": "NOR",
  "Vologda Oblast": "NOR",
  "Murmansk Oblast": "NOR",
  "Republic of Karelia": "NOR",
  "Komi Republic": "NOR",
  "Nenets Autonomous Okrug": "NOR",
  // CBE — Central Black Earth
  "Belgorod Oblast": "CBE",
  "Voronezh Oblast": "CBE",
  "Kursk Oblast": "CBE",
  "Lipetsk Oblast": "CBE",
  "Tambov Oblast": "CBE",
  // VOL — Volga (incl. Volga-Vyatka, which the seed folds in)
  "Samara Oblast": "VOL",
  "Saratov Oblast": "VOL",
  "Volgograd Oblast": "VOL",
  "Astrakhan Oblast": "VOL",
  "Penza Oblast": "VOL",
  "Ulyanovsk Oblast": "VOL",
  "Republic of Tatarstan": "VOL",
  "Republic of Kalmykia": "VOL",
  "Nizhny Novgorod Oblast": "VOL",
  "Kirov Oblast": "VOL",
  "Mari El Republic": "VOL",
  "Republic of Mordovia": "VOL",
  "Chuvash Republic": "VOL",
  // NCA — North Caucasus
  "Krasnodar Krai": "NCA",
  "Stavropol Krai": "NCA",
  "Rostov Oblast": "NCA",
  "Republic of Adygea": "NCA",
  "Karachay-Cherkess Republic": "NCA",
  "Kabardino-Balkar Republic": "NCA",
  "Republic of North Ossetia-Alania": "NCA",
  "Republic of Ingushetia": "NCA",
  "Chechen Republic": "NCA",
  "Republic of Dagestan": "NCA",
  // URA — Urals
  "Sverdlovsk Oblast": "URA",
  "Chelyabinsk Oblast": "URA",
  "Perm Krai": "URA",
  "Orenburg Oblast": "URA",
  "Kurgan Oblast": "URA",
  "Republic of Bashkortostan": "URA",
  "Udmurt Republic": "URA",
  // WSB — West Siberia
  "Novosibirsk Oblast": "WSB",
  "Omsk Oblast": "WSB",
  "Tomsk Oblast": "WSB",
  "Kemerovo Oblast": "WSB",
  "Altai Krai": "WSB",
  "Altai Republic": "WSB",
  "Tyumen Oblast": "WSB",
  "Khanty–Mansi Autonomous Okrug – Yugra": "WSB",
  "Yamalo-Nenets Autonomous Okrug": "WSB",
  // ESB — East Siberia
  "Krasnoyarsk Krai": "ESB",
  "Irkutsk Oblast": "ESB",
  "Republic of Buryatia": "ESB",
  "Tuva Republic": "ESB",
  "Republic of Khakassia": "ESB",
  "Zabaykalsky Krai": "ESB",
  // FEA — Far East
  "Primorsky Krai": "FEA",
  "Khabarovsk Krai": "FEA",
  "Amur Oblast": "FEA",
  "Sakhalin Oblast": "FEA",
  "Kamchatka Krai": "FEA",
  "Magadan Oblast": "FEA",
  "Sakha (Yakutia) Republic": "FEA",
  "Chukotka Autonomous Okrug": "FEA",
  "Jewish Autonomous Oblast": "FEA",
};

// Union republics → countries-110m country names dissolved into each region.
// Ukraine, Byelorussia and the Baltics are deliberately absent: they are their
// own countries now, built by build-ua-geo.mjs / build-blr-geo.mjs /
// build-bal-geo.mjs into their own shards.
const REPUBLIC_TO_COUNTRIES = {
  KAZ: ["Kazakhstan"],
  TRA: ["Georgia", "Armenia", "Azerbaijan"],
  CAS: ["Uzbekistan", "Kyrgyzstan", "Tajikistan", "Turkmenistan"],
  MOL: ["Moldova"],
};

const REGION_IDS = [
  "CBE",
  "CEN",
  "ESB",
  "FEA",
  "KAZ",
  "MOL",
  "NCA",
  "NOR",
  "NWR",
  "TRA",
  "URA",
  "VOL",
  "WSB",
  "CAS",
].sort();

const QUANTIZATION = 7e3;
const MIN_ISLAND_AREA = 5e-3; // deg² — drop sub-pixel specks

// Unwrap eastern longitudes (Far East / Chukotka) past the antimeridian so the
// USSR is one contiguous 19..191 span instead of wrapping the globe.
const unwrap = (coords) => {
  const walk = (c) => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      if (c[0] < -10) c[0] += 360; // far-east negative lon → >180
    } else if (Array.isArray(c)) c.forEach(walk);
  };
  walk(coords);
  return coords;
};

const ringArea = (ring) => {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++)
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(a / 2);
};
const dropTinyIslands = (geometry) => {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const kept = polys.filter((poly) => ringArea(poly[0]) >= MIN_ISLAND_AREA);
  return kept.length === 1
    ? { type: "Polygon", coordinates: kept[0] }
    : { type: "MultiPolygon", coordinates: kept };
};

// ── Source 1: Russian federal subjects → 10 economic regions ──────────────────
const ru = await (await fetch(RU_URL)).json();
const byRegion = {};
const unmapped = [];
for (const f of ru.features) {
  const region = SUBJECT_TO_REGION[f.properties.name_latin];
  if (!region) {
    unmapped.push(f.properties.name_latin);
    continue;
  }
  (byRegion[region] ??= { type: "FeatureCollection", features: [] }).features.push({
    type: "Feature",
    properties: {},
    geometry: { ...f.geometry, coordinates: unwrap(f.geometry.coordinates) },
  });
}
if (unmapped.length) throw new Error(`unmapped Russian subjects:\n  ${unmapped.join("\n  ")}`);

// ── Source 2: union republics → countries-50m ─────────────────────────────────
const world = JSON.parse(readFileSync(pub("geo/countries-50m.json"), "utf8"));
const countries = topoFeature(world, world.objects.countries);
const byName = new Map(countries.features.map((f) => [f.properties.name, f]));
for (const [region, names] of Object.entries(REPUBLIC_TO_COUNTRIES)) {
  for (const name of names) {
    const f = byName.get(name);
    if (!f) throw new Error(`countries-110m missing republic ${name}`);
    (byRegion[region] ??= { type: "FeatureCollection", features: [] }).features.push({
      type: "Feature",
      properties: {},
      geometry: { ...f.geometry, coordinates: unwrap(f.geometry.coordinates) },
    });
  }
}

// ── Dissolve each region through one shared topology ──────────────────────────
const topo = topology(byRegion, QUANTIZATION);
const out = [];
for (const regionId of REGION_IDS) {
  const obj = topo.objects[regionId];
  if (!obj) throw new Error(`no geometry for region ${regionId}`);
  const geometry = dropTinyIslands(topoMerge(topo, [obj]));
  out.push({
    type: "Feature",
    id: regionId,
    properties: { id: regionId, regionCode: regionId },
    geometry,
  });
}
out.sort((a, b) => a.properties.regionCode.localeCompare(b.properties.regionCode));

writeFileSync(
  pub("ru-regions.json"),
  JSON.stringify({ type: "FeatureCollection", features: out }) + "\n"
);
console.log(`wrote ${out.length} features: ${out.map((f) => f.properties.regionCode).join(", ")}`);
