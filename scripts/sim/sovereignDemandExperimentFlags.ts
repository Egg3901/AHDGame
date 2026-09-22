/**
 * Shared carry chain for the two #1001 dark gates.
 *
 * sovereignIssuanceConsolidationEnabled (gated tranche merge) and
 * domesticSovereignBondCoverageEnabled (gated home-sovereign funds) must
 * travel the same path every other experiment flag travels, end to end:
 *
 *   worldsim sim_run_world args -> persisted simJobs fields ->
 *   worker runWorld CLI args -> sandbox gameConfig ->
 *   experiment-report requestedConfig identity.
 *
 * Every hop funnels through this module so one round-trip test proves the
 * whole chain instead of each hop re-implementing the mapping. Pure data
 * mapping only: no database, wall clock, randomness, or environment reads.
 * Absent stays absent (scheduler default off); explicit false pins the
 * control arm; anything non-boolean is rejected, never coerced.
 */

export const SOVEREIGN_DEMAND_EXPERIMENT_FIELDS = [
  "sovereignIssuanceConsolidationEnabled",
  "domesticSovereignBondCoverageEnabled",
] as const;

export type SovereignDemandExperimentField = (typeof SOVEREIGN_DEMAND_EXPERIMENT_FIELDS)[number];

export interface SovereignDemandExperimentFlags {
  sovereignIssuanceConsolidationEnabled?: boolean;
  domesticSovereignBondCoverageEnabled?: boolean;
}

/** runWorld.ts CLI flag each persisted field maps to. */
const RUN_WORLD_FLAG: Record<SovereignDemandExperimentField, string> = {
  sovereignIssuanceConsolidationEnabled: "sovereign-issuance-consolidation",
  domesticSovereignBondCoverageEnabled: "domestic-sovereign-bond-coverage",
};

/**
 * Validate an untrusted source (MCP tool args, a simJobs doc) and pick the
 * #1001 experiment fields. Present booleans are kept, including explicit
 * false; absent stays absent; anything else throws.
 */
export function pickSovereignDemandExperimentFlags(
  source: Record<string, unknown>
): SovereignDemandExperimentFlags {
  const out: SovereignDemandExperimentFlags = {};
  for (const field of SOVEREIGN_DEMAND_EXPERIMENT_FIELDS) {
    const value = source[field];
    if (value === undefined) continue;
    if (typeof value !== "boolean") {
      throw new Error(`${field} must be boolean (got ${JSON.stringify(value)})`);
    }
    out[field] = value;
  }
  return out;
}

/**
 * Map persisted #1001 fields to the exact runWorld.ts CLI args the worker
 * spawns. Output strings match the `--<flag>=true|false` form runWorld.ts
 * parses with parseOptionalBoolean; absent fields produce no arg so the
 * sandbox keeps the scheduler default (off).
 */
export function sovereignDemandRunWorldArgs(flags: SovereignDemandExperimentFlags): string[] {
  const out: string[] = [];
  for (const field of SOVEREIGN_DEMAND_EXPERIMENT_FIELDS) {
    const value = flags[field];
    if (value === undefined) continue;
    out.push(`--${RUN_WORLD_FLAG[field]}=${String(value)}`);
  }
  return out;
}
