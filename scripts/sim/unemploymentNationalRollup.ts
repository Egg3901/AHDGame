/**
 * Compare the national unemployment roll-up against its denominator-aware
 * alternative. Synthetic qualification only; live-world deltas are reported
 * separately from a read-only production snapshot.
 *
 * Run: npx tsx scripts/sim/unemploymentNationalRollup.ts
 */
import assert from "node:assert/strict";
import { aggregateNationalMetricValue } from "@/lib/nationalMetrics/rules";

const populationAverage = (rows: Array<{ value: number; population: number }>) =>
  rows.reduce((sum, row) => sum + row.value * row.population, 0) /
  rows.reduce((sum, row) => sum + row.population, 0);

const unevenParticipation = [
  { value: 10, population: 12_000, gdp: 1, laborForce: 6_000 },
  { value: 5, population: 88_000, gdp: 1, laborForce: 70_400 },
];
const oldPopulationRate = populationAverage(unevenParticipation);
const newLaborForceRate = aggregateNationalMetricValue(
  "economic",
  "unemploymentRate",
  unevenParticipation
);
assert.equal(oldPopulationRate, 5.6);
assert.equal(newLaborForceRate, 5.393);

const partialCoverage = [
  { value: 8, population: 1, gdp: 9, laborForce: 900 },
  { value: 2, population: 9, gdp: 1, laborForce: 100 },
  { value: 99, population: 100, gdp: 100, laborForce: 0 },
  { value: 77, population: 100, gdp: 100 },
];
const partialCoverageResult = aggregateNationalMetricValue(
  "economic",
  "unemploymentRate",
  partialCoverage
);
assert.equal(partialCoverageResult, 83.933);

const regionalLaborForces = [
  { value: 700_000, population: 1_000_000, gdp: 9_000_000 },
  { value: 5_300_000, population: 9_000_000, gdp: 1_000_000 },
];
const nationalLaborForce = aggregateNationalMetricValue(
  "economic",
  "laborForce",
  regionalLaborForces
);
assert.equal(nationalLaborForce, 6_000_000);

console.log(
  JSON.stringify(
    {
      cases: 3,
      unevenParticipation: {
        populationWeighted: oldPopulationRate,
        laborForceWeighted: newLaborForceRate,
        change: Number((newLaborForceRate! - oldPopulationRate).toFixed(3)),
      },
      incompleteLaborForceCoverage: {
        populationFallback: partialCoverageResult,
        allRatedRegionsIncluded: true,
      },
      absoluteLaborForce: {
        nationalSum: nationalLaborForce,
        formerPopulationWeightedAverage: 4_840_000,
      },
      allAssertionsPassed: true,
    },
    null,
    2
  )
);
