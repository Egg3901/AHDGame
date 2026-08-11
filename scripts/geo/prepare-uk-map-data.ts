// scripts/prepare-uk-map-data.ts
/**
 * Build script: UK Westminster constituency map data (2024 boundaries).
 * Fetches ONS constituency boundaries + HoC Library GE2024 results, projects
 * to SVG paths with one UK-wide projection, and writes per-region JSON to
 * src/data/subdivisions/uk/. Run: npx tsx scripts/prepare-uk-map-data.ts
 */
// @ts-expect-error - d3-geo v3 type definitions issue
import { geoPath, geoConicConformal, geoArea } from "d3-geo";
import * as fs from "fs/promises";
import * as path from "path";
import type { Feature, FeatureCollection, Geometry } from "geojson";

const BOUNDARY_SERVICE =
  "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BGC/FeatureServer/0/query";
const RESULTS_CSV_URL =
  "https://researchbriefings.files.parliament.uk/documents/CBP-10009/HoC-GE2024-results-by-constituency.csv";
// The parliament.uk file host sits behind a Cloudflare JS challenge that blocks
// scripted fetches. This mirror vendors the identical official CSV; downloads
// are integrity-checked against known national party totals below.
const RESULTS_CSV_MIRROR =
  "https://raw.githubusercontent.com/InductiveStep/colm-test/main/HoC-GE2024-results-by-constituency.csv";

// HoC "Region name" → game region id (src/lib/seeds/uk/ukRegions.ts)
const REGION_NAME_TO_ID: Record<string, string> = {
  London: "LON",
  "South East": "SEE",
  "South West": "SWE",
  "East of England": "EAE",
  "East Midlands": "EMI",
  "West Midlands": "WMI",
  "Yorkshire and The Humber": "YHU",
  "North West": "NWE",
  "North East": "NEE",
  Scotland: "SCO",
  Wales: "WAL",
  "Northern Ireland": "NIR",
};

// CSV party column → seeded game party abbreviation (ukParties.ts).
// SDLP/APNI have no seeded analog → folded into "other".
const PARTY_COLUMNS: Record<string, string> = {
  Con: "CON",
  Lab: "LAB",
  LD: "LD",
  RUK: "RUK",
  Green: "GRN",
  SNP: "SNP",
  PC: "PC",
  DUP: "DUP",
  SF: "SF",
  UUP: "UUP",
};
const OTHER_COLUMNS = ["SDLP", "APNI", "All other candidates"];
// Sign convention matches Cook PVI: negative = left. From ukParties economicPosition.
const LEFT_PARTIES = ["LAB", "SNP", "PC", "GRN", "SF"];
const RIGHT_PARTIES = ["CON", "RUK", "DUP", "UUP"];

// UK_COMMONS_SEATS (src/lib/constants/states.ts) — allocation authority.
// Drift vs real constituency counts is expected in SEE/EAE/NWE and handled
// by the display engine (vacant tail / seat overflow).
const EXPECTED_SEATS: Record<string, number> = {
  LON: 75,
  SEE: 90,
  SWE: 58,
  EAE: 60,
  EMI: 47,
  WMI: 57,
  YHU: 54,
  NWE: 75,
  NEE: 27,
  SCO: 57,
  WAL: 32,
  NIR: 18,
};

// Minimal RFC-4180 CSV parser (no new dependency).
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows[0].map((h) => h.trim().replace(/^﻿/, ""));
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

type ConstituencyProps = { PCON24CD: string; PCON24NM: string };

/**
 * ArcGIS emits RFC-7946 GeoJSON (counterclockwise exterior rings); d3-geo uses
 * the opposite spherical winding convention and reads such polygons as
 * "the globe minus the shape", which breaks fitSize/bounds. Rewind each ring
 * to d3's convention: exterior rings clockwise (planar), holes counterclockwise.
 */
function ringSphericalArea(ring: number[][]): number {
  return geoArea({ type: "Polygon", coordinates: [ring] });
}

function rewindRing(ring: number[][], exterior: boolean): void {
  // In d3's spherical convention a small enclosed area reads < 2π steradians;
  // an inverted ring reads > 2π (the globe minus the shape). Exterior rings
  // must enclose the small area; holes are wound opposite.
  const small = ringSphericalArea(ring) < 2 * Math.PI;
  if (exterior !== small) ring.reverse();
}

function rewindFeature(f: Feature<Geometry, ConstituencyProps>): void {
  const g = f.geometry;
  const fixPoly = (rings: number[][][]) => {
    if (rings.length === 0) return;
    rewindRing(rings[0], true);
    for (let i = 1; i < rings.length; i++) rewindRing(rings[i], false);
  };
  if (g.type === "Polygon") fixPoly(g.coordinates);
  else if (g.type === "MultiPolygon") for (const poly of g.coordinates) fixPoly(poly);
  if (geoArea(f) > Math.PI) {
    throw new Error(`Feature ${f.properties.PCON24CD} still inverted after rewind`);
  }
}

async function fetchAllBoundaries(): Promise<Feature<Geometry, ConstituencyProps>[]> {
  const features: Feature<Geometry, ConstituencyProps>[] = [];
  let offset = 0;
  for (;;) {
    const url = `${BOUNDARY_SERVICE}?where=1%3D1&outFields=PCON24CD,PCON24NM&outSR=4326&f=geojson&resultOffset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Boundary fetch failed: ${res.status} ${url}`);
    const fc = (await res.json()) as FeatureCollection<Geometry, ConstituencyProps> & {
      error?: { message?: string };
    };
    if (fc.error) throw new Error(`Boundary service error: ${JSON.stringify(fc.error)}`);
    features.push(...fc.features);
    if (fc.features.length < 2000) break;
    offset += fc.features.length;
  }
  return features;
}

async function main() {
  console.log("Fetching boundaries…");
  const boundaries = await fetchAllBoundaries();
  console.log(`  ${boundaries.length} constituency boundaries`);
  for (const f of boundaries) rewindFeature(f);

  console.log("Fetching results CSV…");
  let csvText: string | null = null;
  for (const url of [RESULTS_CSV_URL, RESULTS_CSV_MIRROR]) {
    const res = await fetch(url);
    if (res.ok) {
      const text = await res.text();
      // Cloudflare challenge pages come back 200-shaped from some proxies — reject HTML.
      if (!text.trimStart().startsWith("<")) {
        csvText = text;
        console.log(`  source: ${url}`);
        break;
      }
    }
    console.warn(`  ${url} unavailable (${res.status}), trying next source`);
  }
  if (!csvText) throw new Error("Results CSV fetch failed from all sources");
  const rows = parseCsv(csvText);
  console.log(`  ${rows.length} result rows`);
  // Column sanity check — fail loudly with the actual header if it drifted.
  const required = ["ONS ID", "Constituency name", "Region name", "Electorate", "Valid votes"];
  for (const col of required) {
    if (!(col in rows[0])) {
      throw new Error(`CSV column "${col}" missing. Headers: ${Object.keys(rows[0]).join(" | ")}`);
    }
  }

  // Integrity check: national party totals must match the official GE2024
  // figures (House of Commons Library CBP-10009) within 0.5% — guards against
  // a corrupted or tampered mirror.
  const OFFICIAL_TOTALS: Record<string, number> = {
    Lab: 9_708_716,
    Con: 6_828_925,
    RUK: 4_117_610,
    LD: 3_519_143,
    SNP: 724_758,
  };
  for (const [col, official] of Object.entries(OFFICIAL_TOTALS)) {
    const actual = rows.reduce((s, r) => s + (Number(r[col]) || 0), 0);
    const drift = Math.abs(actual - official) / official;
    if (drift > 0.005) {
      throw new Error(
        `Integrity check failed: ${col} national total ${actual} vs official ${official}`
      );
    }
  }
  console.log("  integrity check passed (national party totals match official figures)");

  // One UK-wide projection so all region files share a coordinate space.
  const ukFC: FeatureCollection = { type: "FeatureCollection", features: boundaries };
  const projection = geoConicConformal()
    .parallels([50, 60])
    .rotate([2, 0])
    .fitSize([900, 1200], ukFC);
  const pathGen = geoPath(projection) as ((object: unknown) => string | null) & {
    bounds: (object: unknown) => [[number, number], [number, number]];
  };

  interface OutSub {
    id: string;
    name: string;
    path: string;
    electorate: number;
    leanScalar: number;
    partyShares: Record<string, number>;
  }
  const byRegion: Record<string, OutSub[]> = {};
  const boundaryById = new Map(boundaries.map((f) => [f.properties.PCON24CD, f]));
  const problems: string[] = [];

  for (const row of rows) {
    const onsId = row["ONS ID"];
    const regionId = REGION_NAME_TO_ID[row["Region name"]];
    if (!regionId) {
      problems.push(`Unmapped region "${row["Region name"]}" (${onsId})`);
      continue;
    }
    const feature = boundaryById.get(onsId);
    if (!feature) {
      problems.push(`No boundary for ${onsId} ${row["Constituency name"]}`);
      continue;
    }
    const svgPath = pathGen(feature);
    if (!svgPath) {
      problems.push(`Empty path for ${onsId}`);
      continue;
    }

    const validVotes = Number(row["Valid votes"]) || 0;
    const partyShares: Record<string, number> = {};
    if (validVotes > 0) {
      for (const [col, abbr] of Object.entries(PARTY_COLUMNS)) {
        const v = Number(row[col]) || 0;
        if (v > 0) partyShares[abbr] = Number((v / validVotes).toFixed(4));
      }
      const otherVotes = OTHER_COLUMNS.reduce((s, col) => s + (Number(row[col]) || 0), 0);
      if (otherVotes > 0) partyShares.other = Number((otherVotes / validVotes).toFixed(4));
    }
    const leanScalar = Number(
      (
        (RIGHT_PARTIES.reduce((s, p) => s + (partyShares[p] ?? 0), 0) -
          LEFT_PARTIES.reduce((s, p) => s + (partyShares[p] ?? 0), 0)) *
        100
      ).toFixed(1)
    );

    (byRegion[regionId] ??= []).push({
      id: onsId,
      name: row["Constituency name"],
      path: svgPath,
      electorate: Number(row["Electorate"]) || 0,
      leanScalar,
      partyShares,
    });
  }

  if (problems.length) {
    console.error(`\n${problems.length} problems:`);
    for (const p of problems) console.error(`  - ${p}`);
    throw new Error("Build aborted — fix source data mapping first.");
  }

  let total = 0;
  const outDir = path.join(process.cwd(), "src", "data", "subdivisions", "uk");
  await fs.mkdir(outDir, { recursive: true });
  for (const [regionId, subs] of Object.entries(byRegion)) {
    total += subs.length;
    subs.sort((a, b) => a.id.localeCompare(b.id));
    // Per-region viewBox from this region's bounding box (shared projection space)
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const s of subs) {
      const f = boundaryById.get(s.id)!;
      const [[x0, y0], [x1, y1]] = pathGen.bounds(f);
      minX = Math.min(minX, x0);
      minY = Math.min(minY, y0);
      maxX = Math.max(maxX, x1);
      maxY = Math.max(maxY, y1);
    }
    const viewBox = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
    const expected = EXPECTED_SEATS[regionId];
    const flag = subs.length === expected ? "" : `  (game allocates ${expected} seats — drift OK)`;
    console.log(`${regionId}: ${subs.length} constituencies${flag}`);
    await fs.writeFile(
      path.join(outDir, `${regionId}.json`),
      JSON.stringify({ viewBox, subdivisions: subs })
    );
  }
  console.log(`Total: ${total} (expected 650)`);
  if (total !== 650) throw new Error(`Expected 650 constituencies, got ${total}`);
  // shares sanity
  for (const subs of Object.values(byRegion)) {
    for (const s of subs) {
      const sum = Object.values(s.partyShares).reduce((a, b) => a + b, 0);
      if (sum > 1.02) throw new Error(`${s.id}: partyShares sum ${sum} > 1`);
    }
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
