#!/usr/bin/env node
// Rewrites `cookPVI` in src/data/counties/{ST}.json from county presidential
// returns, using Cook's current weighting: 75% most recent cycle, 25% prior.
//
// PVI is the county's two-party Republican share minus the national two-party
// Republican share, in percentage points (positive = right, negative = left).
// That is the unit the subdivision distributor expects (`lean / 100` is applied
// as a share shift), so the refreshed values feed the results maps unchanged.
//
// Usage:
//   node scripts/geo/refresh-county-pvi.mjs <recent.csv> <prior.csv>
// CSVs follow the tonmcg/US_County_Level_Election_Results_08-24 layout
// (county_fips, votes_gop, votes_dem).
//
// Gaps: Alaska reports by state house district, so every borough takes the
// statewide PVI. Connecticut's 2022+ returns use planning regions, so its
// legacy counties use the prior cycle alone. Any other county missing from
// both files keeps its existing value.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Official national two-party totals (FEC).
const NATIONAL = {
  2024: { gop: 77_302_580, dem: 75_017_613 },
  2020: { gop: 74_223_975, dem: 81_283_501 },
};
const RECENT_WEIGHT = 0.75;

function parseCsv(path) {
  const [header, ...rows] = readFileSync(path, "utf8").trim().split(/\r?\n/);
  const cols = header.split(",");
  const iFips = cols.indexOf("county_fips");
  const iGop = cols.indexOf("votes_gop");
  const iDem = cols.indexOf("votes_dem");
  const iState = cols.indexOf("state_name");
  const out = new Map();
  for (const line of rows) {
    const f = line.split(",");
    out.set(f[iFips].padStart(5, "0"), {
      state: f[iState],
      gop: Number(f[iGop]),
      dem: Number(f[iDem]),
    });
  }
  return out;
}

function share(gop, dem) {
  return gop + dem > 0 ? gop / (gop + dem) : null;
}

function pvi(row, year) {
  const s = row ? share(row.gop, row.dem) : null;
  if (s == null) return null;
  const n = NATIONAL[year];
  return (s - share(n.gop, n.dem)) * 100;
}

function stateTotals(map, stateName) {
  let gop = 0;
  let dem = 0;
  for (const r of map.values()) {
    if (r.state === stateName) {
      gop += r.gop;
      dem += r.dem;
    }
  }
  return { gop, dem };
}

const [recentPath, priorPath] = process.argv.slice(2);
if (!recentPath || !priorPath) {
  console.error("usage: refresh-county-pvi.mjs <2024.csv> <2020.csv>");
  process.exit(1);
}
const recent = parseCsv(recentPath);
const prior = parseCsv(priorPath);

const alaskaPvi =
  RECENT_WEIGHT * pvi(stateTotals(recent, "Alaska"), 2024) +
  (1 - RECENT_WEIGHT) * pvi(stateTotals(prior, "Alaska"), 2020);

const dir = join(process.cwd(), "src", "data", "counties");
let updated = 0;
let kept = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const path = join(dir, file);
  const data = JSON.parse(readFileSync(path, "utf8"));
  for (const county of data.counties) {
    const a = pvi(recent.get(county.fips), 2024);
    const b = pvi(prior.get(county.fips), 2020);
    let next = null;
    if (a != null && b != null) next = RECENT_WEIGHT * a + (1 - RECENT_WEIGHT) * b;
    else if (b != null) next = b;
    else if (a != null) next = a;
    else if (file === "AK.json") next = alaskaPvi;
    if (next == null) {
      kept++;
      continue;
    }
    county.cookPVI = Math.round(next * 10) / 10;
    updated++;
  }
  writeFileSync(path, JSON.stringify(data));
}
console.log(`updated ${updated} counties, kept ${kept}`);
