/**
 * Issue #952 deterministic balance harness.
 *
 * Compares the legacy one-turn revenue-growth signal with the proposed
 * trailing EMA signal under recurring settlement noise. It uses the production
 * signal and output-gap functions and does not read or write a database.
 *
 * Run: npx tsx scripts/sim/gdpRevenueSignalNoise.ts
 */

import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { advanceOutputGap } from "@/lib/metricEngine/outputGap";
import {
  advanceRevenueEma,
  computeRealizedRevenueGrowthRate,
  computeTrailingRevenueGrowthRate,
  selectRevenueTrendBaseline,
  updateRevenueSnapshots,
  type RevenueSnapshot,
  SECTOR_SIGNAL_MAX,
  SECTOR_SIGNAL_MIN,
} from "@/lib/turn/gdpGrowth";

const ANNUAL_TREND = 4;
const TURNS = TURNS_PER_YEAR * 3;
const NOISE = [0, 0.04, -0.03, 0.08, -0.06, 0.12, -0.04, 0.17, -0.08, 0.05, -0.02, 0.1];

type Sample = {
  turn: number;
  oldSignal: number;
  trailingSignal: number;
  oldGap: number;
  trailingGap: number;
};

function run(): Sample[] {
  const rows: Sample[] = [];
  let previousRevenue: number | undefined;
  let revenueEma: number | undefined;
  let snapshots: RevenueSnapshot[] | undefined;
  let oldGap = 0;
  let trailingGap = 0;

  for (let turn = 0; turn < TURNS; turn++) {
    const underlyingRevenue = 1000 * Math.pow(1 + ANNUAL_TREND / 100, turn / TURNS_PER_YEAR);
    const revenue = underlyingRevenue * (1 + NOISE[turn % NOISE.length]!);
    const oldSignal =
      computeRealizedRevenueGrowthRate(revenue, previousRevenue, 1, TURNS_PER_YEAR) ?? ANNUAL_TREND;

    revenueEma = advanceRevenueEma(revenueEma, revenue);
    const baseline = selectRevenueTrendBaseline(snapshots, turn);
    const trailingSignal =
      computeTrailingRevenueGrowthRate(revenueEma, baseline, TURNS_PER_YEAR) ?? oldSignal;
    snapshots = updateRevenueSnapshots(snapshots, turn, revenueEma);

    const oldStep = advanceOutputGap(oldGap, oldSignal, ANNUAL_TREND, TURNS_PER_YEAR);
    const trailingStep = advanceOutputGap(
      trailingGap,
      trailingSignal,
      ANNUAL_TREND,
      TURNS_PER_YEAR
    );
    oldGap = oldStep.gap;
    trailingGap = trailingStep.gap;
    rows.push({ turn, oldSignal, trailingSignal, oldGap, trailingGap });
    previousRevenue = revenue;
  }

  return rows;
}

function summarize(label: string, values: number[], target: number) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const meanAbsoluteError =
    values.reduce((sum, value) => sum + Math.abs(value - target), 0) / values.length;
  const clampHits = values.filter(
    (value) => value === SECTOR_SIGNAL_MIN || value === SECTOR_SIGNAL_MAX
  ).length;
  return {
    signal: label,
    mean: mean.toFixed(2),
    meanAbsoluteError: meanAbsoluteError.toFixed(2),
    clampHits: `${clampHits}/${values.length}`,
    minimum: Math.min(...values).toFixed(2),
    maximum: Math.max(...values).toFixed(2),
  };
}

const rows = run();
const mature = rows.filter((row) => row.turn >= TURNS_PER_YEAR);
console.log(`Issue #952: ${ANNUAL_TREND}% annual trend with recurring -8% to +17% level noise`);
console.table([
  summarize(
    "one-turn",
    mature.map((row) => row.oldSignal),
    ANNUAL_TREND
  ),
  summarize(
    "trailing EMA",
    mature.map((row) => row.trailingSignal),
    ANNUAL_TREND
  ),
]);

console.log("\nOutput-gap stock after each mature year (target 0):");
console.table(
  rows
    .filter((row) => row.turn === TURNS_PER_YEAR * 2 - 1 || row.turn === TURNS - 1)
    .map((row) => ({
      turn: row.turn + 1,
      oneTurnGap: row.oldGap.toFixed(2),
      trailingGap: row.trailingGap.toFixed(2),
    }))
);

const shockTurn = 96;
let shockEma = 1000;
const shockSnapshots: RevenueSnapshot[] = [{ turn: shockTurn - TURNS_PER_YEAR, value: 1000 }];
const shockRevenue = 1100;
shockEma = advanceRevenueEma(shockEma, shockRevenue);
const shockBaseline = selectRevenueTrendBaseline(shockSnapshots, shockTurn);
const shockOld = computeRealizedRevenueGrowthRate(shockRevenue, 1000, 1, TURNS_PER_YEAR);
const shockTrailing = computeTrailingRevenueGrowthRate(shockEma, shockBaseline, TURNS_PER_YEAR);
console.log("\nIsolated one-turn +10% revenue wobble:");
console.table([
  { signal: "one-turn", annualizedPercent: shockOld?.toFixed(2) },
  { signal: "trailing EMA", annualizedPercent: shockTrailing?.toFixed(2) },
]);
