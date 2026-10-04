/**
 * Deterministic actual-CPI comparison for issue #2323.
 *
 * Replays the production inflation formula for one 48-turn game year using a
 * synthetic neutral economy. It compares the legacy fixed-base FX signal with
 * the production history-window rule, and includes a no-FX baseline. This is a
 * controlled calculation harness, not an integrated world simulation.
 *
 * Run: npx tsx scripts/sim/issue2323FxInflation.ts
 */

import assert from "node:assert/strict";
import { calculateInflationWithBreakdown, type InflationInputs } from "@/lib/budget/inflation";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  calculateFxInflationPressure,
  FX_INFLATION_LOOKBACK_TURNS,
  FX_INFLATION_PRESSURE_CAP,
  type FxRateObservation,
} from "@/lib/turn/rules/fxInflationPressure";

const STARTING_RATE = 1;
const END_TURN = TURNS_PER_YEAR;
const SAMPLE_TURNS = [1, 12, 24, 36, 48] as const;
const ONGOING_DEPRECIATION_TURNS = 24;
const ONGOING_DEPRECIATION_PER_TURN = 0.002;

const NEUTRAL_INPUTS: InflationInputs = {
  unemployment: 5,
  gdpGrowth: 2,
  primeRate: 3,
  neutralPrimeRate: 3,
  surplusToGdp: 0,
  tariffRate: 3,
  wageGrowth: 2.5,
  commodityPressure: 0,
  forexPressure: 0,
  savingsPressure: 0,
  housingCostPressure: 0,
  policyStancePressure: 0,
  moneySupplyGrowthPct: 2,
  moneyGrowthCoeff: 0,
  targetInflation: 2,
  previousInflation: 2,
};

type ScenarioName =
  "flat_baseline" | "fixed_depreciation" | "ongoing_then_flat_depreciation" | "fixed_appreciation";

interface ScenarioResult {
  scenario: ScenarioName;
  baseline: Array<{ turn: number; inflationPct: number }>;
  legacyFixedBase: Array<{ turn: number; inflationPct: number; fxPressure: number }>;
  historyPassThrough: Array<{ turn: number; inflationPct: number; fxPressure: number }>;
  pressureAfterStabilization?: number;
}

function rateAt(scenario: ScenarioName, turn: number): number {
  if (turn <= 0) return STARTING_RATE;
  if (scenario === "fixed_depreciation") return 1.25;
  if (scenario === "fixed_appreciation") return 0.8;
  if (scenario === "ongoing_then_flat_depreciation") {
    return STARTING_RATE * Math.pow(1 + ONGOING_DEPRECIATION_PER_TURN, Math.min(turn, 24));
  }
  return STARTING_RATE;
}

function observationsThrough(scenario: ScenarioName, turn: number): FxRateObservation[] {
  const observations: FxRateObservation[] = [];
  for (let observedTurn = -FX_INFLATION_LOOKBACK_TURNS; observedTurn <= turn; observedTurn++) {
    observations.push({ turn: observedTurn, rate: rateAt(scenario, observedTurn) });
  }
  return observations;
}

function clampLegacyLevelSignal(rate: number): number {
  return Math.max(
    -FX_INFLATION_PRESSURE_CAP,
    Math.min(FX_INFLATION_PRESSURE_CAP, rate / STARTING_RATE - 1)
  );
}

function replay(scenario: ScenarioName, signal: "baseline" | "legacy" | "history") {
  let inflation = NEUTRAL_INPUTS.targetInflation ?? 2;
  const samples: Array<{ turn: number; inflationPct: number; fxPressure: number }> = [];
  let pressureAfterStabilization = 0;

  for (let turn = 1; turn <= END_TURN; turn++) {
    const history = observationsThrough(scenario, turn);
    const rate = rateAt(scenario, turn);
    const fxPressure =
      signal === "baseline"
        ? 0
        : signal === "legacy"
          ? clampLegacyLevelSignal(rate)
          : calculateFxInflationPressure(history, turn + 1);
    inflation = calculateInflationWithBreakdown({
      ...NEUTRAL_INPUTS,
      previousInflation: inflation,
      forexPressure: fxPressure,
    }).rate;

    if (SAMPLE_TURNS.includes(turn as (typeof SAMPLE_TURNS)[number])) {
      samples.push({ turn, inflationPct: round(inflation), fxPressure: round(fxPressure) });
    }
    if (
      signal === "history" &&
      scenario === "ongoing_then_flat_depreciation" &&
      turn === ONGOING_DEPRECIATION_TURNS + FX_INFLATION_LOOKBACK_TURNS
    ) {
      pressureAfterStabilization = fxPressure;
    }
  }

  return { samples, pressureAfterStabilization };
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function run(): void {
  assert.equal(TURNS_PER_YEAR, 48, "scenario lengths use the production game-year constant");
  const names: ScenarioName[] = [
    "flat_baseline",
    "fixed_depreciation",
    "ongoing_then_flat_depreciation",
    "fixed_appreciation",
  ];
  const scenarios: ScenarioResult[] = names.map((scenario) => {
    const baseline = replay(scenario, "baseline").samples.map(({ turn, inflationPct }) => ({
      turn,
      inflationPct,
    }));
    const legacy = replay(scenario, "legacy");
    const treatment = replay(scenario, "history");
    return {
      scenario,
      baseline,
      legacyFixedBase: legacy.samples,
      historyPassThrough: treatment.samples,
      ...(scenario === "ongoing_then_flat_depreciation"
        ? { pressureAfterStabilization: round(treatment.pressureAfterStabilization) }
        : {}),
    };
  });

  const byScenario = new Map(scenarios.map((scenario) => [scenario.scenario, scenario]));
  const fixed = byScenario.get("fixed_depreciation")!;
  const ongoing = byScenario.get("ongoing_then_flat_depreciation")!;
  const appreciation = byScenario.get("fixed_appreciation")!;

  assert.equal(fixed.historyPassThrough[0]?.fxPressure, FX_INFLATION_PRESSURE_CAP);
  assert.equal(fixed.historyPassThrough[1]?.fxPressure, FX_INFLATION_PRESSURE_CAP);
  assert.equal(fixed.historyPassThrough[2]?.fxPressure, 0);
  assert.ok(fixed.legacyFixedBase[4]!.inflationPct > fixed.historyPassThrough[4]!.inflationPct);
  assert.equal(ongoing.pressureAfterStabilization, 0);
  assert.ok(ongoing.legacyFixedBase[4]!.inflationPct > ongoing.historyPassThrough[4]!.inflationPct);
  assert.ok(appreciation.historyPassThrough[0]!.fxPressure < 0);
  assert.equal(appreciation.historyPassThrough[2]!.fxPressure, 0);
  assert.ok(scenarios[0]!.historyPassThrough.every((sample) => sample.inflationPct === 2));

  console.log(
    JSON.stringify(
      {
        issue: 2323,
        turnsPerYear: TURNS_PER_YEAR,
        fxLookbackTurns: FX_INFLATION_LOOKBACK_TURNS,
        scenarioMethod:
          "Production calculateInflationWithBreakdown repeated once per game turn with neutral non-FX drivers. Baseline applies no FX pressure; legacy applies clamped currentRate/baseRate - 1; treatment applies the production history rule. Initial history is seeded at the starting rate for one full lookback window.",
        scenarios,
      },
      null,
      2
    )
  );
}

run();
