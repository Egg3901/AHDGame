/**
 * Pure FX-to-inflation pass-through rule. It treats exchange-rate movements as
 * a finite import-price impulse, not a permanent signal from the currency level.
 */
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

/** One game quarter of FX movement is observed; the level shock exits after that window. */
export const FX_INFLATION_LOOKBACK_TURNS = 12;
/** Match the downstream CPI calculator's maximum FX pressure input. */
export const FX_INFLATION_PRESSURE_CAP = 0.25;

export interface FxRateObservation {
  turn: number;
  rate: number;
}

/**
 * Annualized bounded change in local-currency units per internal unit.
 * `observations` are the settled snapshots available before this turn's forex
 * pass. The current endpoint is the latest observation strictly before turn;
 * the comparison endpoint is the latest observation at least one lookback
 * window earlier. Missing/invalid/initial history yields no FX impulse.
 */
export function calculateFxInflationPressure(
  observations: readonly FxRateObservation[],
  turn: number
): number {
  const valid = observations
    .filter(
      (observation) =>
        Number.isInteger(observation.turn) &&
        observation.turn < turn &&
        Number.isFinite(observation.rate) &&
        observation.rate > 0
    )
    .sort((a, b) => a.turn - b.turn);
  const current = valid.at(-1);
  if (!current) return 0;

  const priorCutoff = current.turn - FX_INFLATION_LOOKBACK_TURNS;
  let prior: FxRateObservation | undefined;
  for (const observation of valid) {
    if (observation.turn <= priorCutoff) prior = observation;
    else break;
  }
  if (!prior) return 0;

  const elapsedTurns = current.turn - prior.turn;
  if (elapsedTurns <= 0) return 0;

  const annualizedLogChange =
    (Math.log(current.rate) - Math.log(prior.rate)) * (TURNS_PER_YEAR / elapsedTurns);
  const positiveCapLog = Math.log1p(FX_INFLATION_PRESSURE_CAP);
  const negativeCapLog = Math.log1p(-FX_INFLATION_PRESSURE_CAP);
  if (annualizedLogChange >= positiveCapLog) return FX_INFLATION_PRESSURE_CAP;
  if (annualizedLogChange <= negativeCapLog) return -FX_INFLATION_PRESSURE_CAP;
  return Math.expm1(annualizedLogChange);
}
