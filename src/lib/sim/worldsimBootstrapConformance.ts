/**
 * Fresh-bootstrap seed conformance for worldsim runs (#1992).
 *
 * The reset/bootstrap admin path records a pre-open conformance diagnostic
 * (`resetAndBootstrapGameWorld` step 4), but `scripts/sim/runWorld.ts` calls
 * `bootstrapGameWorld()` directly and begins advancing turns — so sandbox
 * worlds had no authoritative pre-turn `seedDiagnostics` document or captured
 * seed baseline, and the audit could not separate bad seed data from
 * mechanical drift.
 *
 * `runWorldsimBootstrapConformance` closes that gap. Call it once, on a fresh
 * bootstrap, after `bootstrapGameWorld()` returns and BEFORE sim-only state
 * mutation (tier patches, autonomy, seat backfill, corp spawn) or the first
 * `processTurn()`:
 *
 *   1. runs seed conformance against the isolated sandbox DB;
 *   2. persists the full report (preset, run id, seed, source revision,
 *      effective feature manifest, world turn) with trigger
 *      `worldsim-post-bootstrap`;
 *   3. captures the drift baseline when conformance is clean AND no baseline
 *      exists yet;
 *   4. returns a summary the caller stamps on the sim run manifest.
 *
 * Findings never throw from this helper. The worldsim runner decides whether
 * to advance turns after inspecting the result. A diagnostic throw is
 * persisted as a `diagnostic_error` report and returned as `diagnostic-error`
 * so the failure stays visible. Resumed and live-clone runs never reach this
 * (they skip bootstrap), and a pre-existing worldsim-post-bootstrap report
 * short-circuits to `skipped-existing` without touching the baseline.
 *
 * Sandbox-only by construction: it only ever touches the passed `db`, which
 * the caller pinned to the isolated sandbox before any engine import.
 */

import type { Db } from "mongodb";
import {
  captureSeedBaseline,
  diagnosticErrorReport,
  formatDiagnosticSummary,
  loadSeedBaseline,
  runSeedDiagnostic,
  type SeedDiagnosticFeatureManifest,
  type SeedDiagnosticReport,
} from "@/lib/admin/seedDiagnostic";

/** Trigger identifying a fresh worldsim bootstrap conformance report. */
export const WORLDSIM_BOOTSTRAP_TRIGGER = "worldsim-post-bootstrap" as const;

export interface WorldsimBootstrapProvenance {
  runId: string;
  seed: string;
  preset: string;
  sourceRevision: string | null;
  sourceWorktree: string | null;
  featureManifest: SeedDiagnosticFeatureManifest;
}

export type WorldsimBootstrapConformanceStatus =
  "reported" | "skipped-existing" | "diagnostic-error";

export interface WorldsimBootstrapConformanceResult {
  status: WorldsimBootstrapConformanceStatus;
  /** Fresh report, error report, or the pre-existing report on resume. */
  report: SeedDiagnosticReport | null;
  baselineCaptured: boolean;
  /** One-line summary for run logs and the sim run manifest. */
  summary: string;
}

export interface WorldsimFeatureManifestInput {
  autonomyLevel: string;
  actorMode: string;
  simTurnPhaseMode: string;
  preIteration: boolean;
  preservePlayerRail: boolean;
  commandEconomy: boolean;
  scarcityDrift: boolean;
  brandLoyalty: boolean;
  brandLoyaltySlice: boolean;
  sectorQuality: boolean;
  demographicsDemand: boolean;
  macroGrowth: boolean;
  allFeatureFlags: boolean;
  marketMode?: string;
  labourMode?: string;
  freightSettlementMode?: string;
  canonicalFreightBillingEnabled?: boolean;
  shortageResponsiveSourcingEnabled?: boolean;
  indexFundBondLiquidityEnabled?: boolean;
  sovereignIssuanceConsolidationEnabled?: boolean;
  domesticSovereignBondCoverageEnabled?: boolean;
  equityLiquidityFacilityEnabled?: boolean;
  nppMarketCoverageEnabled?: boolean;
  nppFragileMarketSupplyEnabled?: boolean;
  frontierEntryExperimentEnabled?: boolean;
  difficulty?: string;
}

/**
 * Flatten the run's effective configuration into a deterministic manifest for
 * the persisted report. Unset tier overrides record as null (preset default).
 */
export function buildWorldsimFeatureManifest(
  input: WorldsimFeatureManifestInput
): SeedDiagnosticFeatureManifest {
  return {
    autonomyLevel: input.autonomyLevel,
    actorMode: input.actorMode,
    simTurnPhaseMode: input.simTurnPhaseMode,
    preIteration: input.preIteration,
    preservePlayerRail: input.preservePlayerRail,
    commandEconomy: input.commandEconomy,
    scarcityDrift: input.scarcityDrift,
    brandLoyalty: input.brandLoyalty,
    brandLoyaltySlice: input.brandLoyaltySlice,
    sectorQuality: input.sectorQuality,
    demographicsDemand: input.demographicsDemand,
    macroGrowth: input.macroGrowth,
    allFeatureFlags: input.allFeatureFlags,
    marketMode: input.marketMode ?? null,
    labourMode: input.labourMode ?? null,
    freightSettlementMode: input.freightSettlementMode ?? null,
    canonicalFreightBillingEnabled: input.canonicalFreightBillingEnabled ?? null,
    shortageResponsiveSourcingEnabled: input.shortageResponsiveSourcingEnabled ?? null,
    indexFundBondLiquidityEnabled: input.indexFundBondLiquidityEnabled ?? null,
    sovereignIssuanceConsolidationEnabled: input.sovereignIssuanceConsolidationEnabled ?? null,
    domesticSovereignBondCoverageEnabled: input.domesticSovereignBondCoverageEnabled ?? null,
    equityLiquidityFacilityEnabled: input.equityLiquidityFacilityEnabled ?? null,
    nppMarketCoverageEnabled: input.nppMarketCoverageEnabled ?? null,
    nppFragileMarketSupplyEnabled: input.nppFragileMarketSupplyEnabled ?? null,
    frontierEntryExperimentEnabled: input.frontierEntryExperimentEnabled ?? null,
    difficulty: input.difficulty ?? null,
  };
}

export async function runWorldsimBootstrapConformance(
  db: Db,
  provenance: WorldsimBootstrapProvenance
): Promise<WorldsimBootstrapConformanceResult> {
  const existing = (await db.collection("seedDiagnostics").findOne({
    mode: "conformance",
    trigger: WORLDSIM_BOOTSTRAP_TRIGGER,
  } as never)) as SeedDiagnosticReport | null;
  if (existing) {
    return {
      status: "skipped-existing",
      report: existing,
      baselineCaptured: false,
      summary: "Seed conformance already recorded for this world — keeping the original baseline",
    };
  }

  let report: SeedDiagnosticReport;
  try {
    report = await runSeedDiagnostic(db, {
      mode: "conformance",
      trigger: WORLDSIM_BOOTSTRAP_TRIGGER,
      preset: provenance.preset,
      runId: provenance.runId,
      seed: provenance.seed,
      sourceRevision: provenance.sourceRevision,
      sourceWorktree: provenance.sourceWorktree,
      featureManifest: provenance.featureManifest,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorReport = diagnosticErrorReport(message, {
      preset: provenance.preset,
      trigger: WORLDSIM_BOOTSTRAP_TRIGGER,
      runId: provenance.runId,
      seed: provenance.seed,
      sourceRevision: provenance.sourceRevision,
      sourceWorktree: provenance.sourceWorktree,
      featureManifest: provenance.featureManifest,
    });
    try {
      await db.collection("seedDiagnostics").insertOne(errorReport as never);
    } catch {
      // Persistence of the error report is best-effort.
    }
    return {
      status: "diagnostic-error",
      report: errorReport,
      baselineCaptured: false,
      summary: `Seed diagnostic failed: ${message}`,
    };
  }

  // A world with criticals (or any other reason the seed is suspect) must not
  // become the drift reference.
  let baselineCaptured = false;
  if (report.summary.critical === 0) {
    const stored = await loadSeedBaseline(db);
    if (!stored) {
      await captureSeedBaseline(db, { preset: provenance.preset });
      baselineCaptured = true;
    }
  }

  const summary = baselineCaptured
    ? `${formatDiagnosticSummary(report)} — seed baseline captured`
    : formatDiagnosticSummary(report);
  return { status: "reported", report, baselineCaptured, summary };
}
