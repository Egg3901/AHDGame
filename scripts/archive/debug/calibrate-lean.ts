/**
 * Calibrate demographic-derived state leans to match 2020 election results.
 * Run: npx tsx scripts/calibrate-lean.ts
 * Outputs current vs target leans and suggests LEAN_SCALE_FACTOR + LEAN_CALIBRATION_OFFSET.
 */
import { stateDemographics } from "../src/lib/seeds/stateDemographics";
import { demographicCategories } from "../src/lib/seeds/demographicCategories";
import { ELECTION_2020_MARGIN, marginToLean } from "../src/lib/data/2020ElectionResults";
import type { StateDemographics } from "../src/lib/db/types";

function calculateRawLean(demographics: StateDemographics): {
  rawEconomic: number;
  rawSocial: number;
} {
  const groups = demographics.groups;
  const categories = demographicCategories;
  let totalWeight = 0;
  let weightedEconomic = 0;
  let weightedSocial = 0;

  for (const category of categories) {
    const catWeight =
      Number((demographics.categoryWeights ?? {})[category._id as string]) ??
      category.defaultWeight ??
      0;
    if (catWeight <= 0) continue;

    for (const group of category.groups) {
      const stateGroup = groups[group.id];
      if (!stateGroup) continue;

      const pop = Number(stateGroup.population) || 0;
      const turnout =
        typeof stateGroup.turnout === "number"
          ? stateGroup.turnout
          : (Number((group as { defaultTurnout?: number }).defaultTurnout) ?? 55);
      const weight = (pop / 100) * (turnout / 100) * (catWeight / 100);

      const economicLean =
        typeof stateGroup.economicLean === "number"
          ? stateGroup.economicLean
          : (group.defaultEconomicLean ?? 0);
      const socialLean =
        typeof stateGroup.socialLean === "number"
          ? stateGroup.socialLean
          : (group.defaultSocialLean ?? 0);

      totalWeight += weight;
      weightedEconomic += weight * economicLean;
      weightedSocial += weight * socialLean;
    }
  }

  if (totalWeight <= 0) return { rawEconomic: 0, rawSocial: 0 };
  return {
    rawEconomic: weightedEconomic / totalWeight,
    rawSocial: weightedSocial / totalWeight,
  };
}

function displayLean(economic: number, social: number): number {
  const sameSign = economic >= 0 === social >= 0;
  if (sameSign) return (economic + social) / 2;
  return Math.abs(economic) >= Math.abs(social) ? economic : social;
}

const SCALE = 7.26;
const OFFSET = -0.084;

function applyCalibration(raw: number, scale: number, offset: number): number {
  return Math.max(-5, Math.min(5, (raw + offset) * scale));
}

function main() {
  const results: {
    state: string;
    rawE: number;
    rawS: number;
    current: number;
    target: number;
    margin: number;
  }[] = [];

  for (const sd of stateDemographics) {
    const stateId = sd._id as string;
    const { rawEconomic, rawSocial } = calculateRawLean(sd);
    const currentE = applyCalibration(rawEconomic, SCALE, OFFSET);
    const currentS = applyCalibration(rawSocial, SCALE, OFFSET);
    const currentDisplay = displayLean(currentE, currentS);

    const margin = ELECTION_2020_MARGIN[stateId] ?? 0;
    const target = marginToLean(margin);

    results.push({
      state: stateId,
      rawE: Math.round(rawEconomic * 1000) / 1000,
      rawS: Math.round(rawSocial * 1000) / 1000,
      current: Math.round(currentDisplay * 100) / 100,
      target: Math.round(target * 100) / 100,
      margin,
    });
  }

  // Sort by target (bluest first)
  results.sort((a, b) => a.target - b.target);

  console.log("State | RawE   | RawS   | Current | Target | Margin | Error");
  console.log("------|--------|--------|---------|--------|--------|------");
  let sumError = 0;
  for (const r of results) {
    const err = Math.abs(r.current - r.target);
    sumError += err;
    const errStr = err > 1 ? `*** ${err.toFixed(2)}` : err.toFixed(2);
    console.log(
      `${r.state.padEnd(5)} | ${r.rawE.toFixed(3).padStart(6)} | ${r.rawS.toFixed(3).padStart(6)} | ${r.current.toFixed(2).padStart(7)} | ${r.target.toFixed(2).padStart(6)} | ${r.margin.toFixed(1).padStart(6)} | ${errStr}`
    );
  }

  const meanError = sumError / results.length;
  console.log(`\nMean absolute error: ${meanError.toFixed(2)}`);
  console.log(`Current: SCALE=${SCALE}, OFFSET=${OFFSET}`);

  // Linear regression: target = a * rawDisplay + b
  const rawDisplays = results.map((r) => displayLean(r.rawE, r.rawS));
  const targets = results.map((r) => r.target);
  const n = results.length;
  const sumX = rawDisplays.reduce((s, x) => s + x, 0);
  const sumY = targets.reduce((s, y) => s + y, 0);
  const sumXX = rawDisplays.reduce((s, x) => s + x * x, 0);
  const sumXY = rawDisplays.reduce((s, x, i) => s + x * targets[i], 0);
  const denom = n * sumXX - sumX * sumX;
  const a = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 1;
  const b = (sumY - a * sumX) / n;

  console.log(`\nLinear regression target = a*raw + b:`);
  console.log(`  a (scale) = ${a.toFixed(3)}, b (offset) = ${b.toFixed(3)}`);

  // Test new calibration
  let newSumError = 0;
  for (let i = 0; i < results.length; i++) {
    const calibrated = Math.max(-5, Math.min(5, a * rawDisplays[i] + b));
    newSumError += Math.abs(calibrated - targets[i]);
  }
  console.log(`  New mean absolute error: ${(newSumError / n).toFixed(2)}`);

  // For the (raw + offset) * scale formula: we want a*raw + b = (raw + offset) * scale
  // So: a*raw + b = scale*raw + scale*offset => a=scale, b=scale*offset => offset = b/scale
  // But scale and offset in our formula are applied to economic and social separately. We have one scale/offset.
  // Actually our formula is: calibrated = (raw + offset) * scale. So we need scale*raw + scale*offset = a*raw + b
  // => scale = a, scale*offset = b => offset = b/a
  if (Math.abs(a) > 0.01) {
    const optScale = a;
    const optOffset = b / a;
    console.log(`\nSuggested constants for (raw + offset) * scale:`);
    console.log(`  LEAN_SCALE_FACTOR = ${optScale.toFixed(2)}`);
    console.log(`  LEAN_CALIBRATION_OFFSET = ${optOffset.toFixed(3)}`);
  }
}

main();
