// scripts/prepare-ru-map-data.ts
/**
 * Build script: USSR oblast-level map data for the 17 RU macro-regions.
 *  - Russia (10 RSFSR economic regions): Click-That-Hood russia.geojson,
 *    83 federal subjects grouped by SUBJECT_TO_REGION (copied verbatim from
 *    scripts/maps/build-ru-geo.mjs — the drift guard test keeps them in sync).
 *  - 7 union-republic regions: Natural Earth 1:10m admin-1 units grouped by
 *    ISO country; countries with over-granular admin-1 (Latvia's novads)
 *    dissolve to NE's `region` property first.
 * Equal weight everywhere (electorate 1, lean 0, no partyShares) — no real
 * competitive USSR election data exists, so nothing is fabricated.
 * Run: npx tsx scripts/prepare-ru-map-data.ts
 */
// @ts-expect-error - d3-geo v3 type definitions issue
import { geoPath, geoConicConformal, geoArea } from "d3-geo";
import { topology } from "topojson-server";
import { merge as topoMerge } from "topojson-client";
import * as fs from "fs/promises";
import * as path from "path";
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from "geojson";

const RU_URL =
  "https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/russia.geojson";
const NE_ADMIN1_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson";

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
  // Byelorussian SSRs. Folded into the Baltics (which it borders) so NWR is one
  // contiguous body instead of a mainland plus a detached western fragment.
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

// ISO country → game region for the seven union-republic regions.
const COUNTRY_TO_REGION: Record<string, string> = {
  KZ: "KAZ",
  GE: "TRA",
  AM: "TRA",
  AZ: "TRA",
  UZ: "CAS",
  KG: "CAS",
  TJ: "CAS",
  TM: "CAS",
  MD: "MOL",
};
// Countries whose NE admin-1 is over-granular: dissolve units into NE's
// `region` property (statistical regions) before mapping.
const DISSOLVE_THRESHOLD = 30;

// NE carries no `region` values for Moldova's raions — group them into the
// real Moldovan development regions by hand (Nord/Centru/Sud/Găgăuzia and the
// left-bank Transnistria strip). Names as they appear in NE 10m admin-1.
const MD_GROUPS: Record<string, string> = {
  Briceni: "Nord",
  Edineţ: "Nord",
  Rîşcani: "Nord",
  Glodeni: "Nord",
  Făleşti: "Nord",
  Ocniţa: "Nord",
  Donduseni: "Nord",
  Soroca: "Nord",
  Floreşti: "Nord",
  Drochia: "Nord",
  Sîngerei: "Nord",
  Bălţi: "Nord",
  Ungheni: "Centru",
  Nisporeni: "Centru",
  Hîncesti: "Centru",
  Rezina: "Centru",
  Criuleni: "Centru",
  Străşeni: "Centru",
  "Anenii Noi": "Centru",
  Orhei: "Centru",
  Chişinău: "Centru",
  Teleneşti: "Centru",
  Şoldăneşti: "Centru",
  Călărași: "Centru",
  Ialoveni: "Centru",
  Leova: "Sud",
  Cantemir: "Sud",
  Cahul: "Sud",
  "Ștefan Vodă": "Sud",
  Causeni: "Sud",
  Cimişlia: "Sud",
  Basarabeasca: "Sud",
  Taraclia: "Sud",
  Comrat: "Găgăuzia",
  Camenca: "Transnistria",
  Grigoriopol: "Transnistria",
  "Stîngă Nistrului": "Transnistria",
  Bender: "Transnistria",
  Transnistria: "Transnistria",
};
const CUSTOM_GROUPS: Record<string, Record<string, string>> = { MD: MD_GROUPS };

const REGION_IDS = [
  "CEN",
  "NWR",
  "NOR",
  "CBE",
  "VOL",
  "NCA",
  "URA",
  "WSB",
  "ESB",
  "FEA",
  "KAZ",
  "TRA",
  "CAS",
  "MOL",
];

// Spherical per-ring rewind (same as prepare-uk-map-data.ts) — external
// GeoJSON winding breaks d3 fitSize/bounds otherwise.
function ringSphericalArea(ring: number[][]): number {
  return geoArea({ type: "Polygon", coordinates: [ring] });
}
function rewindRing(ring: number[][], exterior: boolean): void {
  const small = ringSphericalArea(ring) < 2 * Math.PI;
  if (exterior !== small) ring.reverse();
}
function rewindGeometry(g: Geometry): void {
  const fixPoly = (rings: number[][][]) => {
    if (rings.length === 0) return;
    rewindRing(rings[0], true);
    for (let i = 1; i < rings.length; i++) rewindRing(rings[i], false);
  };
  if (g.type === "Polygon") fixPoly((g as Polygon).coordinates);
  else if (g.type === "MultiPolygon") for (const p of (g as MultiPolygon).coordinates) fixPoly(p);
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

interface Unit {
  id: string;
  name: string;
  regionId: string;
  feature: Feature;
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch ${url}: ${r.status}`);
  return (await r.json()) as T;
}

async function main() {
  const units: Unit[] = [];
  const problems: string[] = [];

  console.log("Fetching Russia subjects…");
  const ru = await fetchJson<FeatureCollection<Geometry, { name_latin: string }>>(RU_URL);
  for (const f of ru.features) {
    const name = f.properties.name_latin;
    const regionId = (SUBJECT_TO_REGION as Record<string, string>)[name];
    if (!regionId) {
      problems.push(`Unmapped Russian subject: ${name}`);
      continue;
    }
    units.push({ id: `ru-${slug(name)}`, name, regionId, feature: f });
  }
  console.log(`  ${units.length} Russian subjects mapped`);

  console.log("Fetching Natural Earth admin-1…");
  type NeProps = { iso_a2: string; name: string; region?: string; adm1_code: string };
  const ne = await fetchJson<FeatureCollection<Geometry, NeProps>>(NE_ADMIN1_URL);
  const byCountry = new Map<string, Feature<Geometry, NeProps>[]>();
  for (const f of ne.features) {
    const iso = f.properties.iso_a2;
    if (!(iso in COUNTRY_TO_REGION)) continue;
    if (!byCountry.has(iso)) byCountry.set(iso, []);
    byCountry.get(iso)!.push(f);
  }
  for (const iso of Object.keys(COUNTRY_TO_REGION)) {
    if (!byCountry.has(iso)) problems.push(`No NE admin-1 features for ${iso}`);
  }
  for (const [iso, feats] of byCountry) {
    const regionId = COUNTRY_TO_REGION[iso];
    if (feats.length > DISSOLVE_THRESHOLD) {
      // Dissolve to NE statistical regions (or a hand-authored grouping when
      // NE's region property is empty) through one shared topology.
      const custom = CUSTOM_GROUPS[iso];
      const groups = new Map<string, Feature<Geometry, NeProps>[]>();
      for (const f of feats) {
        const key = custom
          ? (custom[f.properties.name] ??
            (problems.push(`Ungrouped ${iso} unit: ${f.properties.name}`), f.properties.name))
          : f.properties.region || f.properties.name;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(f);
      }
      const topo = topology({
        units: { type: "FeatureCollection", features: feats },
      }) as unknown as {
        objects: { units: { geometries: unknown[] } };
      };
      const geomByFeature = new Map(feats.map((f, i) => [f, topo.objects.units.geometries[i]]));
      for (const [groupName, groupFeats] of groups) {
        const merged = topoMerge(
          topo as never,
          groupFeats.map((f) => geomByFeature.get(f)) as never
        ) as Geometry;
        units.push({
          id: `${iso.toLowerCase()}-${slug(groupName)}`,
          name: groupName,
          regionId,
          feature: { type: "Feature", properties: {}, geometry: merged },
        });
      }
      console.log(`  ${iso}: ${feats.length} units dissolved to ${groups.size} regions`);
    } else {
      for (const f of feats) {
        units.push({
          id: `${iso.toLowerCase()}-${slug(f.properties.name || f.properties.adm1_code)}`,
          name: f.properties.name || f.properties.adm1_code,
          regionId,
          feature: f,
        });
      }
      console.log(`  ${iso}: ${feats.length} units`);
    }
  }

  for (const u of units) rewindGeometry(u.feature.geometry);

  // One USSR-wide projection. rotate(-100°) recenters so the antimeridian sits
  // at 80°W — Chukotka projects continuously; no coordinate unwrapping needed.
  const fc: FeatureCollection = {
    type: "FeatureCollection",
    features: units.map((u) => u.feature),
  };
  const projection = geoConicConformal()
    .parallels([50, 70])
    .rotate([-100, 0])
    .fitSize([1400, 900], fc);
  const pathGen = geoPath(projection) as ((o: unknown) => string | null) & {
    bounds: (o: unknown) => [[number, number], [number, number]];
  };

  interface OutSub {
    id: string;
    name: string;
    path: string;
    electorate: number;
    leanScalar: number;
  }
  const byRegion: Record<string, OutSub[]> = {};
  for (const u of units) {
    const svgPath = pathGen(u.feature);
    if (!svgPath) {
      problems.push(`Empty path for ${u.id}`);
      continue;
    }
    (byRegion[u.regionId] ??= []).push({
      id: u.id,
      name: u.name,
      path: svgPath,
      electorate: 1,
      leanScalar: 0,
    });
  }

  for (const rid of REGION_IDS) {
    if (!byRegion[rid] || byRegion[rid].length === 0) problems.push(`Region ${rid} is empty`);
  }
  if (problems.length) {
    console.error(`\n${problems.length} problems:`);
    for (const p of problems) console.error(`  - ${p}`);
    throw new Error("Build aborted — fix source mapping first.");
  }

  const outDir = path.join(process.cwd(), "src", "data", "subdivisions", "ru");
  await fs.mkdir(outDir, { recursive: true });
  const canvas = 1400 * 900;
  for (const rid of REGION_IDS) {
    const subs = byRegion[rid];
    subs.sort((a, b) => a.id.localeCompare(b.id));
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const u of units) {
      if (u.regionId !== rid) continue;
      const [[x0, y0], [x1, y1]] = pathGen.bounds(u.feature);
      minX = Math.min(minX, x0);
      minY = Math.min(minY, y0);
      maxX = Math.max(maxX, x1);
      maxY = Math.max(maxY, y1);
    }
    const w = maxX - minX;
    const h = maxY - minY;
    // Antimeridian sanity: no single region should span most of the canvas.
    if ((w * h) / canvas > 0.6)
      throw new Error(`Region ${rid} bbox suspiciously large (${w}x${h})`);
    await fs.writeFile(
      path.join(outDir, `${rid}.json`),
      JSON.stringify({ viewBox: `${minX} ${minY} ${w} ${h}`, subdivisions: subs })
    );
    console.log(`${rid}: ${subs.length} districts`);
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
