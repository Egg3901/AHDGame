import {
  totalPopulation,
  medianAgeFromVector,
  sexRatioFromVector,
  dependencyRatio,
  type AgeSexVector,
} from "./cohortVector";
import type { CohortFlowTallies } from "./cohortFlows";

export interface PopulationMetricValues {
  populationGrowth: number; // annualized % change
  migrationRate: number; // annualized net migration % of population (UN-clamped flow)
  medianAge: number;
  sexRatio: number; // share-male %
  dependencyRatio: number;
  demographicDecline: number; // 0-100, higher = stronger natural decrease + aging pressure
}

/**
 * Derive the dynamic population metrics from the before/after vectors + this
 * turn's flow tallies (design §4.3). Growth/migration are ANNUALIZED (per-turn ×
 * turnsPerYear). migrationRate is computed from the UN-clamped flow so the stock
 * stays honest even when the surfaced metric value later saturates its ±5 bound
 * (audit-7) — clamping happens at the metric-write/bounds layer, not here.
 */
export function derivePopulationMetrics(
  before: AgeSexVector,
  after: AgeSexVector,
  flows: CohortFlowTallies,
  turnsPerYear: number
): PopulationMetricValues {
  const popBefore = Math.max(1, totalPopulation(before));
  const popAfter = Math.max(1, totalPopulation(after));
  const perTurnGrowth = (popAfter - popBefore) / popBefore;
  const populationGrowth = perTurnGrowth * 100 * turnsPerYear;
  const migrationRate = (flows.netMigration / popAfter) * 100 * turnsPerYear;

  // Natural change rate (births − deaths) annualized; the decline index rises as
  // it goes negative and as the dependency ratio (aging pressure) grows.
  const naturalPerTurn = (flows.births - flows.deaths) / popBefore;
  const naturalAnnualPct = naturalPerTurn * 100 * turnsPerYear;
  const dep = dependencyRatio(after);
  // Map: 0 natural change + moderate dependency (~0.5) → ~50; strong natural
  // decrease and high dependency push toward 100; strong increase toward 0.
  const declineRaw = 50 - naturalAnnualPct * 10 + (dep - 0.5) * 40;
  const demographicDecline = Math.max(0, Math.min(100, declineRaw));

  return {
    populationGrowth,
    migrationRate,
    medianAge: medianAgeFromVector(after),
    sexRatio: sexRatioFromVector(after),
    dependencyRatio: dep,
    demographicDecline,
  };
}
