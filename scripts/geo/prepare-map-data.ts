/**
 * Build script: Generate county and congressional district map data
 *
 * Fetches TopoJSON from us-atlas, converts to SVG paths, merges with Cook PVI and population data,
 * and writes per-state JSON files for use in the election map UI.
 *
 * Run: npx tsx scripts/prepare-map-data.ts
 */

import * as topojson from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
// @ts-expect-error - d3-geo v3 type definitions issue
import { geoPath, geoAlbersUsa } from "d3-geo";
import * as fs from "fs/promises";
import * as path from "path";

// FIPS code to state abbreviation mapping
const FIPS_TO_STATE: Record<string, string> = {
  "01": "AL",
  "02": "AK",
  "04": "AZ",
  "05": "AR",
  "06": "CA",
  "08": "CO",
  "09": "CT",
  "10": "DE",
  "11": "DC",
  "12": "FL",
  "13": "GA",
  "15": "HI",
  "16": "ID",
  "17": "IL",
  "18": "IN",
  "19": "IA",
  "20": "KS",
  "21": "KY",
  "22": "LA",
  "23": "ME",
  "24": "MD",
  "25": "MA",
  "26": "MI",
  "27": "MN",
  "28": "MS",
  "29": "MO",
  "30": "MT",
  "31": "NE",
  "32": "NV",
  "33": "NH",
  "34": "NJ",
  "35": "NM",
  "36": "NY",
  "37": "NC",
  "38": "ND",
  "39": "OH",
  "40": "OK",
  "41": "OR",
  "42": "PA",
  "44": "RI",
  "45": "SC",
  "46": "SD",
  "47": "TN",
  "48": "TX",
  "49": "UT",
  "50": "VT",
  "51": "VA",
  "53": "WA",
  "54": "WV",
  "55": "WI",
  "56": "WY",
};

// House seats per state (118th Congress)
const HOUSE_SEATS: Record<string, number> = {
  AL: 7,
  AK: 1,
  AZ: 9,
  AR: 4,
  CA: 52,
  CO: 8,
  CT: 5,
  DE: 1,
  FL: 28,
  GA: 14,
  HI: 2,
  ID: 2,
  IL: 17,
  IN: 9,
  IA: 4,
  KS: 4,
  KY: 6,
  LA: 6,
  ME: 2,
  MD: 8,
  MA: 9,
  MI: 13,
  MN: 8,
  MS: 4,
  MO: 8,
  MT: 2,
  NE: 3,
  NV: 4,
  NH: 2,
  NJ: 12,
  NM: 3,
  NY: 26,
  NC: 14,
  ND: 1,
  OH: 15,
  OK: 5,
  OR: 6,
  PA: 17,
  RI: 2,
  SC: 7,
  SD: 1,
  TN: 9,
  TX: 38,
  UT: 4,
  VT: 1,
  VA: 11,
  WA: 10,
  WV: 2,
  WI: 8,
  WY: 1,
  DC: 0,
};

type CountyTopoJSON = Topology<{ counties: GeometryCollection }>;

interface CountyPopulation {
  [fips: string]: number;
}

interface CountyElectionResult {
  state_fips: string;
  county_fips: string;
  dem_votes: number;
  rep_votes: number;
}

interface CDCookPVI {
  [cd: string]: number; // e.g., "CA-01": -8.2
}

// Fetch and cache data
async function fetchJSON<T = unknown>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  }
  return response.text();
}

// Calculate Cook PVI from county election results
function calculateCountyPVI(
  demVotes: number,
  repVotes: number,
  nationalDemShare: number,
  nationalRepShare: number
): number {
  const total = demVotes + repVotes;
  if (total === 0) return 0;

  const countyDemShare = demVotes / total;
  const countyRepShare = repVotes / total;

  // Calculate partisan lean: (County D% - County R%) - (National D% - National R%)
  const countyMargin = countyDemShare - countyRepShare;
  const nationalMargin = nationalDemShare - nationalRepShare;
  const rawLean = (countyMargin - nationalMargin) * 100;

  // Flip sign to match game convention: negative = left (Dem), positive = right (Rep)
  return -rawLean;
}

// Load county population data from Census GitHub repo
async function loadCountyPopulation(): Promise<CountyPopulation> {
  console.log("Loading county population data from GitHub...");

  // Using a reliable GitHub source with 2020 Census data
  const url = "https://raw.githubusercontent.com/balsama/us_counties_data/master/data/counties.csv";

  try {
    const csvText = await fetchText(url);
    const lines = csvText.split("\n");
    const population: CountyPopulation = {};

    // Parse CSV - format: County,State,"FIPS Code",Population,Area,Density
    // FIPS Code is in column 2 (0-indexed)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = line.split(",");
      if (cols.length < 4) continue;

      let fips = cols[2]?.replace(/"/g, "").trim();
      const pop = parseInt(cols[3]?.replace(/"/g, "").trim() || "0");

      if (!fips || isNaN(pop) || pop <= 0) continue;

      // Ensure FIPS is 5 digits
      if (fips.length < 5) fips = fips.padStart(5, "0");

      population[fips] = pop;
    }

    console.log(`Loaded population data for ${Object.keys(population).length} counties`);
    return population;
  } catch {
    console.warn("Failed to load county population from GitHub, using fallback estimates");
    return {}; // Return empty, we'll use a default value of 50000
  }
}

// Load county election results and calculate PVI
async function loadCountyPVI(): Promise<Record<string, number>> {
  console.log("Loading county election results from GitHub...");

  // Using tonmcg/US_County_Level_Election_Results_08-24
  const url =
    "https://raw.githubusercontent.com/tonmcg/US_County_Level_Election_Results_08-24/master/2020_US_County_Level_Presidential_Results.csv";

  try {
    const csvText = await fetchText(url);
    const lines = csvText.split("\n");
    const pviData: Record<string, number> = {};

    // Parse 2020 election results to calculate PVI
    // data starts at index 1 (index 0 is header row)

    let totalDemVotes = 0;
    let totalRepVotes = 0;
    const countyResults: CountyElectionResult[] = [];

    // First pass: calculate national totals
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = line.split(",");
      if (cols.length < 5) continue;

      // Expected format: state_name,county_fips,county_name,votes_gop,votes_dem,total_votes,...
      // Column 1 is the FULL 5-digit FIPS code (e.g., "01001"), not split into state+county
      const fullFips = cols[1]?.replace(/"/g, "").trim();
      const demVotes = parseFloat(cols[4]?.replace(/"/g, "").trim() || "0");
      const repVotes = parseFloat(cols[3]?.replace(/"/g, "").trim() || "0");

      if (fullFips && fullFips.length === 5 && !isNaN(demVotes) && !isNaN(repVotes)) {
        totalDemVotes += demVotes;
        totalRepVotes += repVotes;
        const stateFips = fullFips.substring(0, 2);
        const countyFips = fullFips.substring(2, 5);
        countyResults.push({
          state_fips: stateFips,
          county_fips: countyFips,
          dem_votes: demVotes,
          rep_votes: repVotes,
        });
      }
    }

    // Calculate national shares
    const totalVotes = totalDemVotes + totalRepVotes;
    const nationalDemShare = totalDemVotes / totalVotes;
    const nationalRepShare = totalRepVotes / totalVotes;

    console.log(
      `National 2020 results: D ${(nationalDemShare * 100).toFixed(1)}% / R ${(nationalRepShare * 100).toFixed(1)}%`
    );

    // Second pass: calculate PVI for each county
    for (const county of countyResults) {
      const fips = county.state_fips + county.county_fips;
      const pvi = calculateCountyPVI(
        county.dem_votes,
        county.rep_votes,
        nationalDemShare,
        nationalRepShare
      );
      pviData[fips] = pvi;
    }

    console.log(`Calculated PVI for ${Object.keys(pviData).length} counties`);
    return pviData;
  } catch (error) {
    console.error("Failed to load county election results:", error);
    return {};
  }
}

// Load CD Cook PVI - Using sample data for key states
// In production, fetch full dataset from Daily Kos Elections or Cook Political Report
// Format: CD code (e.g., "ME-01") -> PVI value (negative = left/Dem, positive = right/Rep)
async function loadCDCookPVI(): Promise<CDCookPVI> {
  console.log("Loading Congressional District partisan lean data...");

  // Sample CD PVI data based on 2020 presidential results
  // This is a subset - in production you'd load all 435 districts
  const cdPVI: CDCookPVI = {
    // Maine
    "ME-01": -9.5, // Portland area - lean Left
    "ME-02": 6.0, // Rural Maine - lean Right

    // California (sample)
    "CA-01": 11.2,
    "CA-12": -40.1, // San Francisco
    "CA-13": -25.3,
    "CA-45": -3.1,

    // Texas (sample)
    "TX-01": 30.5,
    "TX-02": 11.2,
    "TX-07": -4.5,
    "TX-35": -12.1, // Austin

    // Florida (sample)
    "FL-01": 31.8,
    "FL-10": -14.3,
    "FL-27": 9.1,

    // New York (sample)
    "NY-01": 2.8,
    "NY-12": -48.7, // Manhattan
    "NY-14": -29.3, // AOC's district
    "NY-21": 8.2,

    // Add more as needed...
  };

  console.log(`Loaded PVI for ${Object.keys(cdPVI).length} congressional districts (sample)`);
  console.log("Note: Using sample CD PVI data. In production, load full 435-district dataset.");
  return cdPVI;
}

interface GeoFeature {
  type: string;
  id?: string;
  geometry: unknown;
  properties: Record<string, unknown> | null;
}

// Project GeoJSON feature to SVG path
function featureToPath(
  feature: GeoFeature,
  projection: unknown,
  pathGenerator: (f: GeoFeature) => string | null
): string | null {
  const projected = {
    type: feature.type,
    geometry: feature.geometry,
    properties: feature.properties,
  };

  const pathStr = pathGenerator(projected);
  return pathStr;
}

// Calculate bounding box and viewBox for a set of paths
function calculateViewBox(paths: string[], padding = 20): string {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const path of paths) {
    if (!path) continue;

    // Extract coordinates from path string (simplified - just look for M and L commands)
    const matches = path.matchAll(/([ML])\s*([-\d.]+)[,\s]+([-\d.]+)/g);
    for (const match of matches) {
      const x = parseFloat(match[2]);
      const y = parseFloat(match[3]);
      if (!isNaN(x) && !isNaN(y)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (!isFinite(minX)) {
    return "0 0 800 600"; // default fallback
  }

  const width = maxX - minX + 2 * padding;
  const height = maxY - minY + 2 * padding;

  return `${minX - padding} ${minY - padding} ${width} ${height}`;
}

// Main processing
async function main() {
  console.log("Starting map data generation...\n");

  // Create output directories
  const countiesDir = path.join(process.cwd(), "src", "data", "counties");
  const districtsDir = path.join(process.cwd(), "src", "data", "congressional-districts");

  await fs.mkdir(countiesDir, { recursive: true });
  await fs.mkdir(districtsDir, { recursive: true });

  // Load auxiliary data
  const [countyPopulation, countyPVI, cdPVI] = await Promise.all([
    loadCountyPopulation(),
    loadCountyPVI(),
    loadCDCookPVI(),
  ]);

  // Fetch TopoJSON data
  console.log("\nFetching county TopoJSON data from us-atlas...");
  const countyTopo = await fetchJSON<CountyTopoJSON>(
    "https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json"
  );

  console.log("\nFetching congressional district TopoJSON data...");
  let cdTopo: { features: GeoFeature[] } | null = null;

  try {
    // Try to fetch actual CD boundaries (118th Congress if available)
    // Note: This is using older CD boundaries as a placeholder until 118th Congress TopoJSON is available
    cdTopo = await fetchJSON<{ features: GeoFeature[] }>(
      "https://eric.clst.org/assets/wiki/uploads/Stuff/gz_2010_us_500_11_5m.json"
    );
    console.log("Loaded congressional district geodata");
  } catch {
    console.warn("Could not load CD geodata, will create simplified placeholder");
  }

  console.log("Converting TopoJSON to GeoJSON...");

  // Process counties
  console.log("\nProcessing counties...");
  const countyFeatures = topojson.feature(countyTopo, countyTopo.objects.counties);
  const projection = geoAlbersUsa();
  const pathGenerator = geoPath(projection);

  // Group counties by state
  const countiesByState: Record<
    string,
    { fips: string; name: string; path: string; population: number; cookPVI: number }[]
  > = {};

  let countiesWithPVI = 0;
  let countiesWithPop = 0;

  for (const feature of (countyFeatures as unknown as { features: GeoFeature[] }).features) {
    const fips = feature.id;
    if (!fips || fips.length < 2) continue;

    const stateFips = fips.substring(0, 2);
    const state = FIPS_TO_STATE[stateFips];

    if (!state) continue;

    if (!countiesByState[state]) {
      countiesByState[state] = [];
    }

    const pathStr = featureToPath(feature, projection, pathGenerator);
    if (!pathStr) continue;

    const population = countyPopulation[fips] || 50000; // default fallback
    const cookPVI = countyPVI[fips] || 0;

    if (countyPopulation[fips]) countiesWithPop++;
    if (countyPVI[fips]) countiesWithPVI++;

    countiesByState[state].push({
      fips,
      name: (feature.properties?.name as string) || "Unknown",
      path: pathStr,
      population,
      cookPVI: parseFloat(cookPVI.toFixed(1)),
    });
  }

  // Write county files
  for (const [state, counties] of Object.entries(countiesByState)) {
    const paths = counties.map((c) => c.path).filter(Boolean);
    const viewBox = calculateViewBox(paths);

    const data = {
      viewBox,
      counties,
    };

    const filePath = path.join(countiesDir, `${state}.json`);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    console.log(`✓ ${state}: ${counties.length} counties`);
  }

  // Process congressional districts
  console.log("\nProcessing congressional districts...");
  const cdsByState: Record<string, { cd: string; path: string; cookPVI: number }[]> = {};

  if (cdTopo && cdTopo.features) {
    // Process actual CD geodata (GeoJSON format from Census)
    for (const feature of cdTopo.features) {
      const props = feature.properties as Record<string, string> | null;
      if (!props) continue;
      const stateFips = props.STATE || props.STATEFP;
      const cdNum = props.CD || props.CD118FP || props.CDLABEL;

      if (!stateFips || !cdNum) continue;

      const state = FIPS_TO_STATE[stateFips];
      if (!state) continue;

      const pathStr = featureToPath(feature, projection, pathGenerator);
      if (!pathStr) continue;

      const cdCode = `${state}-${cdNum.padStart(2, "0")}`;
      const cookPVI = cdPVI[cdCode] || 0;

      if (!cdsByState[state]) cdsByState[state] = [];

      cdsByState[state].push({
        cd: cdCode,
        path: pathStr,
        cookPVI: parseFloat(cookPVI.toFixed(1)),
      });
    }
  } else {
    // Fallback: Create simplified placeholder districts using county groupings
    console.log("Creating simplified congressional district placeholders...");
    for (const [state, counties] of Object.entries(countiesByState)) {
      const numDistricts = HOUSE_SEATS[state] || 1;
      const countiesPerDistrict = Math.ceil(counties.length / numDistricts);

      for (let i = 0; i < numDistricts; i++) {
        const districtCounties = counties.slice(
          i * countiesPerDistrict,
          (i + 1) * countiesPerDistrict
        );
        if (districtCounties.length === 0) continue;

        const districtPath = districtCounties.map((c) => c.path).join(" ");
        const cdCode = `${state}-${(i + 1).toString().padStart(2, "0")}`;
        const cookPVI = cdPVI[cdCode] || 0;

        if (!cdsByState[state]) cdsByState[state] = [];

        cdsByState[state].push({
          cd: cdCode,
          path: districtPath,
          cookPVI: parseFloat(cookPVI.toFixed(1)),
        });
      }
    }
  }

  // Write CD files
  for (const [state, districts] of Object.entries(cdsByState)) {
    const paths = districts.map((d) => d.path).filter(Boolean);
    const viewBox = calculateViewBox(paths);

    const data = {
      viewBox,
      districts,
    };

    const filePath = path.join(districtsDir, `${state}.json`);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    console.log(`✓ ${state}: ${districts.length} districts`);
  }

  console.log("\n✅ Map data generation complete!");
  console.log(`Counties: ${Object.keys(countiesByState).length} states`);
  console.log(`Congressional Districts: ${Object.keys(cdsByState).length} states`);
  console.log(`Counties with real population data: ${countiesWithPop}`);
  console.log(`Counties with real PVI data: ${countiesWithPVI}`);
}

main().catch(console.error);
