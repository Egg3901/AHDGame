/**
 * Calibration script for the UK Layer-1 demographic model.
 * Run: npx tsx --tsconfig tsconfig.json scripts/calibrate-uk-layer1.ts
 *
 * Computes derived display leans for all 12 UK regions and compares vs targets.
 */
import { ukLayer1Model, ukGroupIds } from "../src/lib/seeds/international/uk";
import {
  deriveCountryGroupPopulations,
  deriveCountryGroupLean,
  deriveCountryGroupTurnout,
} from "../src/lib/seeds/international/derive";
import { ukDemographicCategories } from "../src/lib/seeds/uk/ukDemographicCategories";
import { calculateStateLean, getDisplayLean } from "../src/lib/utils/demographics";
import type { StateDemographics } from "../src/lib/db/types";

const TARGETS: Record<string, number> = {
  LON: -1.5,
  SCO: -0.28,
  WAL: -0.51,
  SEE: 0.78,
  SWE: 0.51,
  EAE: 0.86,
  EMI: 0.61,
  WMI: 0.63,
  YHU: 0.96,
  NWE: 0.69,
  NEE: 1.13,
  NIR: 0.9,
};

const TARGET_SIGNS: Record<string, number> = {
  LON: -1,
  SCO: -1,
  WAL: -1,
  SEE: 1,
  SWE: 1,
  EAE: 1,
  EMI: 1,
  WMI: 1,
  YHU: 1,
  NWE: 1,
  NEE: 1,
  NIR: 1,
};

const model = ukLayer1Model;
const regions = Object.keys(model.census);

const rows: Array<{
  region: string;
  econ: number;
  social: number;
  display: number;
  targetSign: number;
  signOk: boolean;
  targetVal: number;
}> = [];

for (const region of regions) {
  const censusConfig = model.census[region]; // { archetype: { groupId: pct, ... } }

  // Derive population shares (turnout-weighted)
  const pops = deriveCountryGroupPopulations(model, censusConfig);

  // Build StateDemographics-like groups record
  const groups: StateDemographics["groups"] = {};
  for (const gid of ukGroupIds) {
    const lean = deriveCountryGroupLean(model, gid, censusConfig);
    const turnout = deriveCountryGroupTurnout(model, gid);
    groups[gid] = {
      population: pops[gid] ?? 0,
      economicLean: lean.economicLean,
      socialLean: lean.socialLean,
      turnout,
    };
  }

  const demographics: StateDemographics = {
    _id: region,
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups,
    lastUpdated: new Date(),
  };

  const { economicLean, socialLean } = calculateStateLean(demographics, ukDemographicCategories);
  const display = getDisplayLean(economicLean, socialLean);
  const targetSign = TARGET_SIGNS[region] ?? 0;
  const signOk =
    targetSign === 0 || Math.sign(display) === targetSign || (display === 0 && targetSign === 0);

  rows.push({
    region,
    econ: economicLean,
    social: socialLean,
    display,
    targetSign,
    signOk,
    targetVal: TARGETS[region] ?? 0,
  });
}

// Print table
console.log("\nUK Layer-1 Calibration Results");
console.log("=".repeat(75));
console.log("Region | Econ    | Social  | Display | Target  | Sign | Status");
console.log("-".repeat(75));

let allPass = true;
for (const r of rows) {
  const signStr = r.targetSign > 0 ? " R " : r.targetSign < 0 ? " L " : " ? ";
  const status = r.signOk ? "PASS" : "FAIL";
  if (!r.signOk) allPass = false;
  console.log(
    `${r.region.padEnd(6)} | ${r.econ.toFixed(3).padStart(7)} | ${r.social.toFixed(3).padStart(7)} | ${r.display.toFixed(3).padStart(7)} | ${r.targetVal.toFixed(3).padStart(7)} |${signStr}| ${status}`
  );
}

console.log("=".repeat(75));
console.log(
  allPass ? "\n✓ All 12 signs correct!" : "\n✗ Some signs incorrect — recalibrate census data."
);
process.exit(allPass ? 0 : 1);
