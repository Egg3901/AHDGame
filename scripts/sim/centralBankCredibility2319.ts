/**
 * Deterministic controlled replay for issue #2319. The baseline runs the
 * previous corridor scoring; treatment runs neutral-rate Taylor scoring.
 * Both paths use the same production CPI and scrutiny functions per scenario.
 * No DB, randomness, wall clock, or live-world state is involved.
 * Run: npx tsx scripts/sim/centralBankCredibility2319.ts
 */
import { calculateInflationWithBreakdown } from "@/lib/budget/inflation";
import {
  capScrutinyGain,
  resolveRecoveryDelta,
  stanceIsCorrect,
} from "@/lib/centralBank/credibility";
import { corridorVerdict } from "@/lib/centralBank/rateCorridor";
import { computeScrutinyDelta } from "@/lib/turn/centralBankChairTurn";

const NEUTRAL_RATE = 3;
const TARGET_INFLATION = 2;
const STARTING_SCRUTINY = 20;
const STARTING_RESOLVE_STREAK = 2;
const TURNS = 12;

interface Scenario {
  name: string;
  startingInflation: number;
  primeRate: number;
  gdpGrowth: number;
}

const SCENARIOS: Scenario[] = [
  { name: "neutral rate, on-target CPI", startingInflation: 2, primeRate: 3, gdpGrowth: 2 },
  { name: "below-neutral rate, on-target CPI", startingInflation: 2, primeRate: 2.5, gdpGrowth: 2 },
  { name: "above-neutral rate, on-target CPI", startingInflation: 2, primeRate: 4, gdpGrowth: 2 },
  { name: "off-target CPI, 5% rate path", startingInflation: 4, primeRate: 5, gdpGrowth: 2 },
  { name: "hot GDP, 4% rate path", startingInflation: 2, primeRate: 4, gdpGrowth: 4 },
  { name: "cold GDP, 2% rate path", startingInflation: 2, primeRate: 2, gdpGrowth: 0 },
];

function legacyStanceIsCorrect(primeRate: number, inflation: number): boolean {
  const { stance } = corridorVerdict(primeRate, inflation);
  if (inflation > TARGET_INFLATION + 0.5) return stance === "restrictive";
  if (inflation < TARGET_INFLATION - 0.5) return stance === "accommodative";
  return stance === "neutral";
}

function replay(scenario: Scenario, scoring: "baseline-corridor" | "treatment-taylor") {
  let inflation = scenario.startingInflation;
  let scrutiny = STARTING_SCRUTINY;
  let resolveStreak = STARTING_RESOLVE_STREAK;
  const turns = [];

  for (let turn = 1; turn <= TURNS; turn++) {
    const result = calculateInflationWithBreakdown({
      targetInflation: TARGET_INFLATION,
      neutralPrimeRate: NEUTRAL_RATE,
      primeRate: scenario.primeRate,
      primeRateHistory: [scenario.primeRate],
      unemployment: 5,
      gdpGrowth: scenario.gdpGrowth,
      surplusToGdp: 0,
      tariffRate: 3,
      wageGrowth: 3,
      commodityPressure: 0,
      forexPressure: 0,
      savingsPressure: 0,
      previousInflation: inflation,
      policyStancePressure: 0,
      moneySupplyGrowthPct: scenario.gdpGrowth,
      centralBankScrutiny: scrutiny,
    });
    inflation = result.rate;
    const correctStance =
      scoring === "baseline-corridor"
        ? legacyStanceIsCorrect(scenario.primeRate, inflation)
        : stanceIsCorrect(
            scenario.primeRate,
            inflation,
            TARGET_INFLATION,
            NEUTRAL_RATE,
            scenario.gdpGrowth
          );
    const scrutinyDelta = capScrutinyGain(
      computeScrutinyDelta(inflation, scenario.gdpGrowth, scrutiny, TARGET_INFLATION)
    );
    const recovery = resolveRecoveryDelta({ correctStance, previousStreak: resolveStreak });
    resolveStreak = recovery.resolveStreak;
    scrutiny = Math.max(0, Math.min(100, scrutiny * 0.95 + scrutinyDelta - recovery.relief));
    turns.push({
      turn,
      cpiPct: Number(inflation.toFixed(4)),
      monetaryInflationContributionPp: Number(result.breakdown.monetary.toFixed(4)),
      correctStance,
      resolveStreak,
      scrutiny: Number(scrutiny.toFixed(4)),
      relief: recovery.relief,
    });
  }

  return {
    scoring,
    startingInflationPct: scenario.startingInflation,
    startingScrutiny: STARTING_SCRUTINY,
    startingResolveStreak: STARTING_RESOLVE_STREAK,
    turns,
  };
}

const report = {
  issue: 2319,
  scope:
    "Deterministic controlled replay, not an endogenous world simulation. Each baseline/treatment pair holds the same starting CPI, scrutiny, resolve streak, neutral rate, inflation target, prime rate, GDP growth, and other CPI inputs constant; only the correct-stance rule differs.",
  inputs: {
    neutralRatePct: NEUTRAL_RATE,
    targetInflationPct: TARGET_INFLATION,
    turnsPerPath: TURNS,
    scoringUsesExistingTaylorCoefficients: true,
    cpiFunction: "calculateInflationWithBreakdown",
    scrutinyFunctions: ["computeScrutinyDelta", "capScrutinyGain", "resolveRecoveryDelta"],
  },
  scenarios: SCENARIOS.map((scenario) => ({
    name: scenario.name,
    primeRatePct: scenario.primeRate,
    relationToNeutral:
      scenario.primeRate < NEUTRAL_RATE
        ? "below"
        : scenario.primeRate > NEUTRAL_RATE
          ? "above"
          : "at",
    gdpGrowthPct: scenario.gdpGrowth,
    baseline: replay(scenario, "baseline-corridor"),
    treatment: replay(scenario, "treatment-taylor"),
  })),
};

console.log(JSON.stringify(report, null, 2));
