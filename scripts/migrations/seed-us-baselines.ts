/**
 * One-time migration: seed state baselines for US states with realistic values.
 * Without baselines, policy effects target a default of 50,
 * which clamps to the max (25%) for unemployment, causing all states
 * to be pushed to depression-level unemployment.
 *
 * Usage: npx tsx scripts/migrations/seed-us-baselines.ts [--reset]
 */

import { MongoClient } from "mongodb";
import * as fs from "fs";

// US state abbreviations
const US_STATE_IDS = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
];

// State economic tiers (based on population/GDP)
const STATE_TIERS: Record<string, number> = {
  // Tier 4 (largest economies)
  CA: 4,
  TX: 4,
  FL: 4,
  NY: 4,
  // Tier 3
  IL: 3,
  PA: 3,
  OH: 3,
  GA: 3,
  NC: 3,
  MI: 3,
  // Tier 2
  NJ: 2,
  VA: 2,
  WA: 2,
  AZ: 2,
  MA: 2,
  TN: 2,
  IN: 2,
  MO: 2,
  MD: 2,
  WI: 2,
  CO: 2,
  MN: 2,
  SC: 2,
  AL: 2,
  LA: 2,
  KY: 2,
  OR: 2,
  OK: 2,
  CT: 2,
  UT: 2,
  IA: 2,
  AR: 2,
  MS: 2,
  NV: 2,
  KS: 2,
  NM: 2,
  NE: 2,
  ID: 2,
  WV: 2,
  HI: 2,
  NH: 2,
  ME: 2,
  MT: 2,
  RI: 2,
  DE: 2,
  SD: 2,
  ND: 2,
  AK: 2,
  VT: 2,
  WY: 2,
  // Tier 1 (smaller economies)
  // Default to tier 1 for any not listed
};

// Base values for each tier (tier 3 = average)
// These should match the stateMetrics seed values
const TIER_BASES = {
  economic: {
    unemploymentRate: [7.2, 5.8, 4.5, 3.5, 2.8], // Lower is better
    medianIncome: [42000, 52000, 62000, 75000, 92000],
    gdpGrowth: [0.5, 1.5, 2.5, 3.2, 4.0],
    povertyRate: [18, 14, 11, 9, 7], // Lower is better
    costOfLiving: [85, 92, 100, 110, 125],
    smallBusinessFormation: [3.5, 4.5, 5.5, 6.5, 8.0],
  },
  education: {
    highSchoolGradRate: [82, 85, 88, 91, 94],
    collegeEnrollment: [45, 52, 58, 64, 70],
    testPerformance: [95, 100, 105, 110, 115],
    educationSpending: [12000, 14000, 16000, 18000, 20000],
    literacyRate: [85, 89, 92, 95, 98],
    workforceSkill: [55, 62, 68, 74, 80],
  },
  healthcare: {
    uninsuredRate: [12, 9, 7, 5, 3], // Lower is better
    affordabilityIndex: [65, 72, 78, 84, 90],
    physicianRate: [180, 220, 260, 300, 350],
    lifeExpectancy: [75, 77, 79, 81, 83],
    preventableMortality: [180, 150, 125, 105, 90], // Lower is better
    publicHealthPreparedness: [60, 68, 75, 82, 88],
  },
  infrastructure: {
    roadCondition: [55, 62, 70, 78, 85],
    broadbandAccess: [70, 78, 85, 91, 96],
    publicTransit: [30, 42, 55, 68, 80],
    waterQuality: [85, 89, 92, 95, 98],
    powerGridReliability: [96, 97.5, 98.5, 99.2, 99.8],
    infrastructureInvestmentGap: [25, 18, 12, 7, 3], // Lower is better
  },
  publicSafety: {
    crimeRate: [5500, 4200, 3200, 2400, 1800], // Lower is better
    violentCrimeRate: [650, 480, 350, 260, 180], // Lower is better
    policePerCapita: [1.8, 2.1, 2.4, 2.7, 3.0],
    incarcerationRate: [800, 600, 450, 350, 250], // Lower is better
    recidivismRate: [45, 38, 32, 26, 20], // Lower is better
    publicSafetyConfidence: [45, 52, 60, 68, 75],
  },
  environment: {
    airQuality: [60, 68, 75, 82, 88],
    renewableEnergy: [8, 14, 22, 32, 45],
    carbonEmissions: [280, 220, 175, 140, 110], // Lower is better
    recyclingRate: [15, 22, 30, 38, 48],
    climateResilience: [40, 48, 55, 62, 70],
    protectedLand: [5, 8, 12, 18, 25],
  },
  social: {
    socialMobility: [35, 42, 50, 58, 68],
    incomeInequality: [0.52, 0.47, 0.43, 0.39, 0.35], // Lower is better (Gini)
    homelessnessRate: [0.8, 0.55, 0.38, 0.25, 0.15], // Lower is better
    foodInsecurity: [15, 11, 8, 5, 3], // Lower is better
    civicParticipation: [45, 52, 58, 64, 72],
    socialCohesion: [50, 55, 60, 65, 72],
  },
  governance: {
    governmentTransparency: [45, 52, 60, 68, 78],
    budgetBalance: [-8, -4, 0, 3, 6], // Surplus/deficit as % of revenue
    corruptionIndex: [55, 62, 70, 78, 88], // Higher = less corrupt
    voterTurnout: [45, 52, 58, 64, 70],
    publicTrust: [25, 32, 40, 48, 58],
  },
  population: {
    populationGrowth: [-0.5, 0.3, 0.8, 1.2, 1.8],
    urbanizationRate: [55, 65, 75, 84, 92],
    medianAge: [42, 39, 37, 35, 33],
    migrationRate: [-2, -0.5, 0.5, 1.5, 3],
  },
  mediaInformation: {
    mediaPolarization: [70, 60, 50, 40, 30], // Lower is better
    disinformationRisk: [55, 48, 40, 32, 25], // Lower is better
    pressFreedom: [65, 72, 78, 84, 90],
    socialMediaSentiment: [35, 42, 50, 58, 68],
    newsTrust: [30, 36, 42, 48, 55],
  },
};

// Add small random variation
function randomize(
  base: number,
  variance: number,
  stateIndex: number,
  metricIndex: number
): number {
  const seed = (stateIndex * 17 + metricIndex * 31 + base * 7) % 100;
  const offset = ((seed % 100) / 100 - 0.5) * 2 * variance;
  return Math.round((base + offset) * 100) / 100;
}

function generateStateBaselines(
  stateIds: string[]
): { _id: string; baselines: Record<string, Record<string, number>> }[] {
  return stateIds.map((stateId, stateIndex) => {
    const tier = STATE_TIERS[stateId] ?? 1;
    const baselines: Record<string, Record<string, number>> = {};

    const categories = Object.keys(TIER_BASES) as (keyof typeof TIER_BASES)[];
    categories.forEach((category, catIndex) => {
      baselines[category] = {};
      const metrics = Object.keys(
        TIER_BASES[category]
      ) as (keyof (typeof TIER_BASES)[typeof category])[];
      metrics.forEach((metric, metricIndex) => {
        const baseValue = TIER_BASES[category][metric][tier];
        const variance = baseValue * 0.15; // 15% variance
        baselines[category][metric] = randomize(
          baseValue,
          variance,
          stateIndex + catIndex,
          metricIndex
        );
      });
    });

    return { _id: stateId, baselines };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const reset = args.includes("--reset");

  const envFile = fs.readFileSync(".env.local", "utf-8");
  const uriMatch = envFile.match(/MONGODB_URI=(.+)/);
  if (!uriMatch) throw new Error("MONGODB_URI not found in .env.local");
  const uri = uriMatch[1].trim();

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");

  // Check existing baselines
  const existingCount = await db
    .collection("stateBaselines")

    .countDocuments({ _id: { $regex: /^[A-Z]{2}$/ } } as any);

  if (existingCount > 0 && !reset) {
    console.log(`Found ${existingCount} existing US state baselines. Use --reset to overwrite.`);
    await client.close();
    return;
  }

  if (reset && existingCount > 0) {
    await db.collection("stateBaselines").deleteMany({ _id: { $regex: /^[A-Z]{2}$/ } } as any);
    console.log(`Deleted ${existingCount} existing US state baselines.`);
  }

  // Generate baselines
  const baselines = generateStateBaselines(US_STATE_IDS);

  // Insert all baselines
  const result = await db
    .collection("stateBaselines")

    .insertMany(baselines.map((b) => ({ _id: b._id, baselines: b.baselines })) as any);
  console.log(`Seeded ${result.insertedCount} US state baselines.`);

  // Show samples
  const samples = ["CA", "TX", "WY"];
  for (const state of samples) {
    const s = baselines.find((b) => b._id === state);
    if (s) {
      console.log(`\n${state} (tier ${STATE_TIERS[state] ?? 1}):`);
      console.log("  Unemployment baseline:", s.baselines.economic.unemploymentRate);
      console.log("  GDP growth baseline:", s.baselines.economic.gdpGrowth);
      console.log("  Median income baseline:", s.baselines.economic.medianIncome);
    }
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
