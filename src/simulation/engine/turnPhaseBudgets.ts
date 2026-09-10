/**
 * Per-phase Mongo round-trip budgets.
 *
 * Production turn time is round trips times latency: Mongo is remote and every
 * command costs milliseconds before any work happens, so a phase that quietly
 * gains a per-row query (an N+1) adds seconds to every turn for every player.
 * The profiler found and removed a dozen of those; this table is what stops
 * the next one landing unnoticed.
 *
 * `runPhase` compares each phase's count against its budget and, when it is
 * over, writes a warning to the log and records `roundTrips`, `roundTripBudget`
 * and `overBudget` on the phase's telemetry (turnLogs.phaseStatuses), where
 * the turndiag tooling and the admin turn view can see it. It never fails the
 * turn.
 *
 * Budgets are measured numbers with headroom, not aspirations. When a phase
 * legitimately grows (a new subsystem, more entities), raise its budget here
 * in the same PR with the measurement that justifies it. Measure with
 * `AHD_TURN_ROUNDTRIP_PROFILE=1 npx tsx scripts/perf/one-turn.ts` and find the
 * call sites with `scripts/perf/trace-callsites.ts`.
 */

/** Phases not listed below get this. A phase with no per-row loop needs far less. */
export const DEFAULT_PHASE_ROUND_TRIP_BUDGET = 500;

/**
 * Measured on a seeded 1953 world (turns 33-41, 2026-09-06) after the batching
 * pass, then given roughly 2x headroom because the production world carries
 * about twice the NPPs, funds and positions.
 */
export const PHASE_ROUND_TRIP_BUDGETS: Readonly<Record<string, number>> = {
  corporationTurn: 2000,
  ministerialOrders: 2000,
  indexFunds: 3000,
  fiscalYear: 7000,
  nppUnionBehavior: 1500,
  nppActionProcessing: 3000,
  approvalSnapshot: 1500,
  nppGovernmentPhases: 1000,
  bondTurn: 1000,
  nppBillSponsorship: 800,
  nppBehavior: 800,
  fiscalBaseGrowth: 800,
  inflationRecalc: 600,
  primaryResolution: 2000,
  voteAccumulation: 2000,
  electionResolution: 2000,
  primarySnapshots: 800,
  politicalMetricsDynamics: 600,
  demographicEffects: 600,
  crisisTurn: 600,
  autoCrisisTurn: 600,
  nppCorporateAttacks: 600,
  stateOwnershipConcentration: 400,
};

export function roundTripBudgetFor(phase: string): number {
  return PHASE_ROUND_TRIP_BUDGETS[phase] ?? DEFAULT_PHASE_ROUND_TRIP_BUDGET;
}
