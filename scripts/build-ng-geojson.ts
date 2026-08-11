import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { topology } from "topojson-server";
import { merge as topoMerge } from "topojson-client";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { Topology, GeometryCollection } from "topojson-specification";

const PUBLIC_DIR = resolve(__dirname, "..", "public");

// Nigeria states GeoJSON from humdata.org (UN OCHA)
const NG_STATES_URL =
  "https://data.humdata.org/dataset/81ac1d1f-0c9d-4cd9-94e0-03f0cbb551b6/resource/3f342b97-5d67-4c15-b615-0f0c1cf9f66b/download/nga_admbnda_adm1_osgof_20190417.geojson";

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch ${url}: ${r.status}`);
  return (await r.json()) as T;
}

// Nigerian states → 6 geopolitical zones
const STATE_TO_ZONE: Record<string, string> = {
  // North-West
  Jigawa: "NORTH_WEST",
  Kaduna: "NORTH_WEST",
  Kano: "NORTH_WEST",
  Katsina: "NORTH_WEST",
  Kebbi: "NORTH_WEST",
  Sokoto: "NORTH_WEST",
  Zamfara: "NORTH_WEST",
  // North-East
  Adamawa: "NORTH_EAST",
  Bauchi: "NORTH_EAST",
  Borno: "NORTH_EAST",
  Gombe: "NORTH_EAST",
  Taraba: "NORTH_EAST",
  Yobe: "NORTH_EAST",
  // North-Central
  "Federal Capital Territory": "NORTH_CENTRAL",
  Benue: "NORTH_CENTRAL",
  Kogi: "NORTH_CENTRAL",
  Kwara: "NORTH_CENTRAL",
  Nasarawa: "NORTH_CENTRAL",
  Niger: "NORTH_CENTRAL",
  Plateau: "NORTH_CENTRAL",
  // South-West
  Ekiti: "SOUTH_WEST",
  Lagos: "SOUTH_WEST",
  Ogun: "SOUTH_WEST",
  Ondo: "SOUTH_WEST",
  Osun: "SOUTH_WEST",
  Oyo: "SOUTH_WEST",
  // South-South
  Akwa: "SOUTH_SOUTH", // Akwa Ibom
  "Akwa Ibom": "SOUTH_SOUTH",
  Bayelsa: "SOUTH_SOUTH",
  "Cross River": "SOUTH_SOUTH",
  Delta: "SOUTH_SOUTH",
  Edo: "SOUTH_SOUTH",
  Rivers: "SOUTH_SOUTH",
  // South-East
  Abia: "SOUTH_EAST",
  Anambra: "SOUTH_EAST",
  Ebonyi: "SOUTH_EAST",
  Enugu: "SOUTH_EAST",
  Imo: "SOUTH_EAST",
};

const ZONE_NAMES: Record<string, string> = {
  NORTH_WEST: "North-West",
  NORTH_EAST: "North-East",
  NORTH_CENTRAL: "North-Central",
  SOUTH_WEST: "South-West",
  SOUTH_SOUTH: "South-South",
  SOUTH_EAST: "South-East",
};

function mergeByRegionId(
  features: Feature[],
  nameByRegion: Record<string, string>
): FeatureCollection {
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

  const topo = topology(
    objects as unknown as Record<string, GeometryCollection | FeatureCollection>,
    1e3
  ) as Topology;

  const out: Feature[] = [];
  for (const regionId of Object.keys(byRegion)) {
    const obj = topo.objects[regionId];
    if (!obj) continue;
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

async function buildNigeria(): Promise<void> {
  const src = await fetchJson<FeatureCollection>(NG_STATES_URL);
  const tagged: Feature[] = [];
  let unmapped = 0;

  for (const f of src.features) {
    const name = String((f.properties as { ADM1_EN?: string }).ADM1_EN ?? "").trim();
    const regionId = STATE_TO_ZONE[name];
    if (!regionId) {
      console.warn(`NG: skipping unmapped state "${name}"`);
      unmapped++;
      continue;
    }
    tagged.push({
      ...f,
      properties: { ...(f.properties ?? {}), __regionId: regionId },
    });
  }

  console.log(`NG: tagged ${tagged.length} states, ${unmapped} unmapped`);

  const fc = mergeByRegionId(tagged, ZONE_NAMES);
  if (fc.features.length !== 6) {
    throw new Error(`NG: expected 6 features, got ${fc.features.length}`);
  }

  writeFileSync(resolve(PUBLIC_DIR, "ng-regions.json"), JSON.stringify(fc));
  console.log(`✓ NG: ${fc.features.length} regions → public/ng-regions.json`);
}

buildNigeria().catch((err) => {
  console.error(err);
  process.exit(1);
});
