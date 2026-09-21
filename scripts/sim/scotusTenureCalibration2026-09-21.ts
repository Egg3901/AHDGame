import { TURNS_PER_YEAR } from "../../src/lib/constants/turnTime";
import {
  DIVERGENT_TENURE_HAZARD_PER_TURN,
  DIVERGENT_TENURE_MEDIAN_TURNS,
} from "../../src/lib/scotus/tenure";

const COHORT_SIZE = 100_000;
const MAX_TURNS = 100 * TURNS_PER_YEAR;
const OLD_HAZARD = 0.015;

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function simulate(hazard: number, seed: number) {
  const random = mulberry32(seed);
  const departures: number[] = [];
  for (let justice = 0; justice < COHORT_SIZE; justice += 1) {
    let turn = 1;
    while (turn <= MAX_TURNS && random() >= hazard) turn += 1;
    departures.push(turn);
  }
  departures.sort((a, b) => a - b);
  const survived = (turns: number) =>
    departures.filter((turn) => turn > turns).length / COHORT_SIZE;
  return {
    annualDeparture: 1 - survived(TURNS_PER_YEAR),
    fiveYearSurvival: survived(5 * TURNS_PER_YEAR),
    medianTurns: departures[Math.floor(COHORT_SIZE / 2)]!,
  };
}

const oldResult = simulate(OLD_HAZARD, 2054);
const newResult = simulate(DIVERGENT_TENURE_HAZARD_PER_TURN, 2280);
const theoreticalAnnual = 1 - Math.pow(1 - DIVERGENT_TENURE_HAZARD_PER_TURN, TURNS_PER_YEAR);

console.log(
  JSON.stringify(
    {
      cohortSize: COHORT_SIZE,
      turnsPerYear: TURNS_PER_YEAR,
      targetMedianTurns: DIVERGENT_TENURE_MEDIAN_TURNS,
      hazardPerTurn: DIVERGENT_TENURE_HAZARD_PER_TURN,
      theoreticalAnnualDeparture: theoreticalAnnual,
      old: oldResult,
      calibrated: newResult,
    },
    null,
    2
  )
);
