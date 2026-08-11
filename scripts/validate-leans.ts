/**
 * Validate derived state leans against 2020 election margins.
 * Run with: npx tsx scripts/validate-leans.ts
 */

import { demographicCategories } from "../src/lib/seeds/demographicCategories";
import { stateDemographics } from "../src/lib/seeds/stateDemographics";
import { calculateStateLean } from "../src/lib/utils/demographics";
import { ELECTION_2020_MARGIN, marginToLean } from "../src/lib/data/2020ElectionResults";

interface Result {
  state: string;
  derivedEcon: number;
  derivedSocial: number;
  derivedDisplay: number;
  actual2020Lean: number;
  error: number;
  direction: string;
}

function getDisplayLean(econ: number, social: number): number {
  if ((econ >= 0 && social >= 0) || (econ <= 0 && social <= 0)) {
    return (econ + social) / 2;
  }
  return Math.abs(econ) > Math.abs(social) ? econ : social;
}

const results: Result[] = [];

for (const demo of stateDemographics) {
  const stateId = demo._id;
  const margin = ELECTION_2020_MARGIN[stateId];
  if (margin === undefined) continue;

  const lean = calculateStateLean(demo, demographicCategories);
  const displayLean = getDisplayLean(lean.economicLean, lean.socialLean);
  const actual = marginToLean(margin);

  const error = displayLean - actual;
  const wrongDirection =
    (displayLean > 0.1 && actual < -0.1) || (displayLean < -0.1 && actual > 0.1);

  results.push({
    state: stateId,
    derivedEcon: lean.economicLean,
    derivedSocial: lean.socialLean,
    derivedDisplay: Math.round(displayLean * 100) / 100,
    actual2020Lean: actual,
    error: Math.round(error * 100) / 100,
    direction: wrongDirection ? "WRONG" : "ok",
  });
}

// Sort by absolute error descending
results.sort((a, b) => Math.abs(b.error) - Math.abs(a.error));

console.log("\n=== STATE LEAN VALIDATION vs 2020 ===\n");
console.log("State  | Derived | Actual | Error  | Dir   | Econ   | Social");
console.log("-------|---------|--------|--------|-------|--------|-------");

for (const r of results) {
  const pad = (n: number) => (n >= 0 ? ` ${n.toFixed(2)}` : `${n.toFixed(2)}`).padStart(6);
  console.log(
    `${r.state.padEnd(6)} | ${pad(r.derivedDisplay)} | ${pad(r.actual2020Lean)} | ${pad(r.error)} | ${r.direction.padEnd(5)} | ${pad(r.derivedEcon)} | ${pad(r.derivedSocial)}`
  );
}

// Summary stats
const errors = results.map((r) => r.error);
const absErrors = errors.map(Math.abs);
const mae = absErrors.reduce((s, e) => s + e, 0) / absErrors.length;
const wrongCount = results.filter((r) => r.direction === "WRONG").length;
const maxErr = Math.max(...absErrors);

console.log(`\n--- Summary ---`);
console.log(`States: ${results.length}`);
console.log(`Mean Absolute Error: ${mae.toFixed(3)}`);
console.log(`Max Absolute Error: ${maxErr.toFixed(3)}`);
console.log(`Wrong Direction: ${wrongCount}/${results.length}`);

// Show population breakdown for a sample state
console.log("\n=== SAMPLE: PA population breakdown ===");
const pa = stateDemographics.find((d) => d._id === "PA");
if (pa) {
  const groups = Object.entries(pa.groups)
    .map(([id, g]) => ({ id, ...g }))
    .sort((a, b) => b.population - a.population);
  for (const g of groups) {
    console.log(
      `  ${g.id.padEnd(24)} pop=${g.population.toFixed(2).padStart(6)}%  econ=${g.economicLean.toFixed(1).padStart(5)}  social=${g.socialLean.toFixed(1).padStart(5)}  turnout=${g.turnout}%`
    );
  }
}
