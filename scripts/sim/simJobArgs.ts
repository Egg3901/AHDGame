// Canonical tier lists, not local literals: a local literal silently omitted
// every tier added after it was written (it stopped at "capital", so a
// "plants" job was rejected as invalid). Pure constant modules: no Mongo, no
// env, safe to import eagerly.
import { MARKET_MODE_ORDER, type MarketSystemMode } from "@/lib/market/modes";
import { LABOUR_MODE_ORDER, type LabourSystemMode } from "@/lib/labour/modes";
import { REAL_OUTPUT_SHADOW_CLI_FLAG } from "@/lib/economy/realOutputShadow";

/** Subset of a simJobs document that controls runWorld CLI emission. */
export interface SimJobExperimentFields {
  marketSystemMode?: string;
  labourSystemMode?: string;
  freightSettlementMode?: string;
  canonicalFreightBillingEnabled?: boolean;
  shortageResponsiveSourcingEnabled?: boolean;
  indexFundBondLiquidityEnabled?: boolean;
  equityLiquidityFacilityEnabled?: boolean;
  nppMarketCoverageEnabled?: boolean;
  nppFragileMarketSupplyEnabled?: boolean;
  /**
   * Real-output shadow diagnostic (issue #1470). Queued sim-only: emitted as
   * the canonical CLI flag so runWorld writes it onto the SANDBOX
   * gameConfig. Absent means unset (off). Never enabled in production or by
   * the all-feature sweep.
   */
  realOutputShadowEnabled?: boolean;
  allFeatureFlags?: boolean;
  autonomyLevel?: string;
  mode?: string;
  countries?: string;
}

/**
 * Job fields the experiment report records as `requestedConfig` (run
 * identity: what the queue asked for, beside the sandbox's
 * `effectiveConfigInitial` for what the run actually saw). Single source of
 * truth shared by simJobArgs consumers and collectExperimentReport.ts, so a
 * new queueable field cannot be emitted by the worker yet dropped from the
 * report.
 */
export const SIM_JOB_REQUESTED_CONFIG_KEYS = [
  "preset",
  "turns",
  "seed",
  "startPolicy",
  "marketSystemMode",
  "labourSystemMode",
  "autonomyLevel",
  "allFeatureFlags",
  "freightSettlementMode",
  "canonicalFreightBillingEnabled",
  "shortageResponsiveSourcingEnabled",
  "indexFundBondLiquidityEnabled",
  "equityLiquidityFacilityEnabled",
  "nppMarketCoverageEnabled",
  "nppFragileMarketSupplyEnabled",
  "realOutputShadowEnabled",
] as const;

/** Pattern every job-derived value (id/seed/preset/dbName) must match before
 * it is used as a Mongo db name or passed as a child-process CLI arg. */
const SAFE_TOKEN = /^[a-zA-Z0-9_-]{1,64}$/;

export function assertSafeToken(value: string, field: string): string {
  if (!SAFE_TOKEN.test(value)) {
    throw new Error(
      `Job field "${field}" failed validation (got ${JSON.stringify(value)}): must match ${SAFE_TOKEN}`
    );
  }
  return value;
}

const AUTONOMY_LEVELS = ["v3", "v4", "v5"];
const SIM_TURN_PHASE_MODES = ["full", "elections-only"];

function booleanFlag(
  job: SimJobExperimentFields,
  field: keyof SimJobExperimentFields,
  flag: string,
  args: string[]
): void {
  const value = job[field];
  if (value !== undefined) {
    if (typeof value !== "boolean") {
      throw new Error(`${String(field)} must be boolean`);
    }
    args.push(`--${flag}=${String(value)}`);
  }
}

/** Pure builder for the conditional runWorld CLI args of one sim job.
 * Extracted from worker.ts so argument emission is unit-testable; worker.ts
 * stays the only caller in production. */
export function buildRunWorldArgs(job: SimJobExperimentFields): string[] {
  const args: string[] = [];
  if (job.marketSystemMode) {
    if (!MARKET_MODE_ORDER.includes(job.marketSystemMode as MarketSystemMode)) {
      throw new Error(`invalid marketSystemMode "${job.marketSystemMode}"`);
    }
    args.push(`--market-mode=${job.marketSystemMode}`);
  }
  if (job.labourSystemMode) {
    if (!LABOUR_MODE_ORDER.includes(job.labourSystemMode as LabourSystemMode)) {
      throw new Error(`invalid labourSystemMode "${job.labourSystemMode}"`);
    }
    args.push(`--labour-mode=${job.labourSystemMode}`);
  }
  if (job.freightSettlementMode) {
    if (
      !(["shadow", "active"] as const).includes(job.freightSettlementMode as "shadow" | "active")
    ) {
      throw new Error(`invalid freightSettlementMode "${job.freightSettlementMode}"`);
    }
    args.push(`--freight-settlement=${job.freightSettlementMode}`);
  }
  booleanFlag(job, "canonicalFreightBillingEnabled", "canonical-freight-billing", args);
  booleanFlag(job, "shortageResponsiveSourcingEnabled", "shortage-responsive-sourcing", args);
  booleanFlag(job, "indexFundBondLiquidityEnabled", "index-fund-bond-liquidity", args);
  booleanFlag(job, "equityLiquidityFacilityEnabled", "equity-liquidity-facility", args);
  booleanFlag(job, "nppMarketCoverageEnabled", "npp-market-coverage", args);
  booleanFlag(job, "nppFragileMarketSupplyEnabled", "npp-fragile-market-supply", args);
  // Explicit true AND false are both emitted so control arms stay explicit;
  // absent stays absent (off). Never implied by --all-feature-flags.
  booleanFlag(job, "realOutputShadowEnabled", REAL_OUTPUT_SHADOW_CLI_FLAG, args);
  if (job.allFeatureFlags !== undefined) {
    if (typeof job.allFeatureFlags !== "boolean") {
      throw new Error("allFeatureFlags must be boolean");
    }
    if (job.allFeatureFlags) args.push("--all-feature-flags");
  }
  // NPP autonomy tier. Without this an MCP-launched run silently used the
  // harness default (v3) while hand-launched runs used v4, so the two were
  // not comparable and the MCP could not reproduce a long full-world run.
  if (job.autonomyLevel) {
    if (!AUTONOMY_LEVELS.includes(job.autonomyLevel)) {
      throw new Error(`invalid autonomyLevel "${job.autonomyLevel}"`);
    }
    args.push(`--autonomy=${job.autonomyLevel}`);
  }
  // Elections-only turn profile + country scope (sim-only). runWorld.ts
  // writes gameConfig.simTurnPhaseMode (skips economy phases) and scopes
  // election spawning via countryGameStates.
  if (job.mode) {
    if (!SIM_TURN_PHASE_MODES.includes(job.mode)) {
      throw new Error(`invalid mode "${job.mode}"`);
    }
    args.push(`--mode=${job.mode}`);
  }
  if (job.countries) {
    // Comma-separated ids become part of a child-process argv — validate each.
    const ids = job.countries
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    for (const id of ids) assertSafeToken(id, "countries[]");
    if (ids.length) args.push(`--countries=${ids.join(",")}`);
  }
  return args;
}
