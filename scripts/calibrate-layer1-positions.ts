/**
 * Dev-only. Two reports:
 *  (1) per-era national gap: deriveGroupLeanFromLayer1(nationalMix) vs defaultLeans (sanity ballpark).
 *  (2) per-state legacy-vs-new STATE lean diff for 2019 (the intentional rebalance to review).
 * Run: npx tsx scripts/calibrate-layer1-positions.ts
 */
import { ERA_COMPOSITIONS, demographicCategories } from "../src/lib/seeds/demographicCategories";
import {
  deriveGroupLeanFromLayer1,
  generateStateDemographicsForTest,
  type Layer1Config,
} from "../src/lib/seeds/stateDemographics";
import { stateCensusData } from "../src/lib/seeds/stateCensusData";
import { calculateStateLean, getDisplayLean } from "../src/lib/utils/demographics";
import type { EraId } from "../src/lib/seeds/presetSelector";

function nationalMix(): Layer1Config {
  const states = Object.values(stateCensusData) as unknown as Array<
    Record<string, Record<string, number>>
  >;
  const dims = ["race", "education", "wealth", "age", "ideology"] as const;
  const acc: Record<string, Record<string, number>> = {};
  for (const dim of dims) {
    acc[dim] = {};
    for (const s of states)
      for (const [k, v] of Object.entries(s[dim])) acc[dim][k] = (acc[dim][k] ?? 0) + v;
    for (const k of Object.keys(acc[dim])) acc[dim][k] /= states.length;
  }
  return acc as unknown as Layer1Config;
}

const mix = nationalMix();
console.log("== national gap to defaultLeans (sanity only) ==");
for (const era of Object.keys(ERA_COMPOSITIONS) as EraId[]) {
  const defaults = ERA_COMPOSITIONS[era].defaultLeans;
  for (const g of Object.keys(defaults)) {
    const d = deriveGroupLeanFromLayer1(g, mix, era);
    console.log(
      `${era} ${g.padEnd(22)} econ Δ${(d.economicLean - defaults[g].economicLean).toFixed(2)} social Δ${(d.socialLean - defaults[g].socialLean).toFixed(2)}`
    );
  }
}

console.log("\n== per-state legacy → new STATE lean (2019 rebalance) ==");
let worstState = 0;
for (const [stateId, cfg] of Object.entries(stateCensusData)) {
  const legacy = generateStateDemographicsForTest(stateId, cfg as Layer1Config, "2019", {});
  const next = generateStateDemographicsForTest(stateId, cfg as Layer1Config, "2019", {
    layer1Positions: true,
  });
  const lL = calculateStateLean(legacy, demographicCategories);
  const nL = calculateStateLean(next, demographicCategories);
  const dDisp =
    getDisplayLean(nL.economicLean, nL.socialLean) - getDisplayLean(lL.economicLean, lL.socialLean);
  worstState = Math.max(worstState, Math.abs(dDisp));
  console.log(
    `${stateId} display ${getDisplayLean(lL.economicLean, lL.socialLean).toFixed(2)} → ${getDisplayLean(nL.economicLean, nL.socialLean).toFixed(2)} (Δ${dDisp.toFixed(2)})`
  );
}
console.log(`\nWORST per-state display Δ ${worstState.toFixed(2)}`);
