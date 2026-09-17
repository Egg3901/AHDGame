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
  /**
   * Clone source (issue #1470 pinned-pair audit). NOT emitted by
   * buildRunWorldArgs: worker.ts consumes it directly (cloneWorld.ts from the
   * live DB, then runWorld --clone-mode). Kept on this interface so the
   * pinned-pair builder can carry clone parity through its spread with full
   * typing; the worker remains the only --clone-mode emitter.
   */
  cloneFromLive?: boolean;
  /**
   * Pinned source (#1966). NOT emitted by buildRunWorldArgs: the worker
   * consumes it directly (verifySimSource + planRunWorldSpawn in simSource.ts
   * select the checkout the run executes from). Kept on this interface so
   * the pinned-pair builder carries source parity through its spread with
   * full typing; the worker remains the only consumer.
   */
  sourceWorktree?: string;
  sourceCommit?: string;
  /**
   * Paired-baseline identity (issue #1470 experiment-validity audit). Both
   * set or both absent; when set, both arms of a pinned pair carry the SAME
   * values. pairId groups the two arms; baselineId names the single
   * immutable sandbox snapshot (ahd_sim_baseline_<baselineId>) both arms
   * copy instead of cloning live independently. NOT emitted by
   * buildRunWorldArgs: baselineProvenanceFlags carries them as
   * --pair-id/--baseline-id provenance argv so runWorld stamps them on the
   * simRuns doc; the worker consumes baselineId directly for the
   * sandbox-to-sandbox copy. Kept here so the pair builder carries them
   * through its spread with full typing.
   */
  pairId?: string;
  baselineId?: string;
}

/**
 * Job fields the experiment report records as `requestedConfig` (run
 * identity: what the queue asked for, beside the sandbox's
 * `effectiveConfigInitial` for what the run actually saw). Single source of
 * truth shared by simJobArgs consumers and collectExperimentReport.ts, so a
 * new queueable field cannot be emitted by the worker yet dropped from the
 * report. Consumers project through normalizeSimJobRequestedConfig, never by
 * filtering on this list directly, so normalization stays in one place.
 */
export const SIM_JOB_REQUESTED_CONFIG_KEYS = [
  "preset",
  "turns",
  "seed",
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
  // Run-profile fields: the worker emits both as runWorld argv (--mode,
  // --countries), so a pair differing here is NOT a clean comparison and a
  // report dropping them misstates run identity. Appended (never reordered)
  // so older readers see a stable prefix.
  "mode",
  "countries",
  // Clone source: worker.ts clones the live world into the sandbox db, then
  // runs runWorld --clone-mode (skips fresh preset bootstrap, autonomizes
  // live controllers). A clone arm and a fresh-bootstrap arm start from
  // different initial state, so a pair differing here is NOT a clean
  // comparison. Appended last so older readers see a stable prefix; older
  // jobs without it project exactly as before (absent stays absent).
  //
  // Deliberately NOT here: startPolicy (claim-window scheduling metadata read
  // only by claimFilterAt — never reaches runWorld argv or the sandbox DB),
  // run-instance identity (_id/runId/dbName/status/timestamps/counters —
  // pinning dbName across arms would force the shared-db resume collision),
  // and the live-source env (LIVE_MONGODB_URI/LIVE_DB_NAME are process env,
  // not per-job requested fields).
  "cloneFromLive",
  // Pinned source (#1966): the worker executes the run from the pinned
  // worktree checkout, so arms pinned to different commits run different
  // code. Appended last so older readers see a stable prefix; older jobs
  // without it project exactly as before (absent stays absent).
  "sourceWorktree",
  "sourceCommit",
  // Paired baseline (issue #1470 experiment-validity audit): the single
  // immutable sandbox snapshot both arms start from. Appended last so older
  // readers see a stable prefix; older jobs without it project exactly as
  // before (absent stays absent).
  "pairId",
  "baselineId",
] as const;

/**
 * Pinned control/treatment pair for the issue-#1470 real-output comparison
 * (acceptance item 4 readiness). A rigorous comparison needs two queued jobs
 * that are IDENTICAL except the shadow flag: same preset, turns, seed, clone
 * source, and every other experiment field, with the control explicitly false
 * and the treatment explicitly true. Explicit (not absent) on both arms so
 * run identity stays unambiguous in `requestedConfig`.
 *
 * Pure: builds job-spec fragments only. Enqueues nothing, enables nothing,
 * touches no live config.
 */
export function buildRealOutputShadowPinnedPair(base: SimJobExperimentFields): {
  control: SimJobExperimentFields;
  treatment: SimJobExperimentFields;
} {
  if (base.realOutputShadowEnabled !== undefined) {
    throw new Error(
      "buildRealOutputShadowPinnedPair: base must not set realOutputShadowEnabled (the pair sets it)"
    );
  }
  if (base.cloneFromLive === true) {
    throw new Error(
      "buildRealOutputShadowPinnedPair: base must not set cloneFromLive (independent claim-time clones do not share a starting world; use buildPairedBaselinePair)"
    );
  }
  return {
    control: { ...base, realOutputShadowEnabled: false },
    treatment: { ...base, realOutputShadowEnabled: true },
  };
}

/**
 * Canonical form of a queued `countries` scope string. runWorld parses the
 * scope as trim + UPPERCASE into a Set (order-insensitive), so "us, UK " and
 * "UK,US" are the same run. Normalize the same way (sorted, so order never
 * counts as drift) for identity and comparison. Non-strings pass through
 * untouched so a wrong-typed value still fails loudly downstream instead of
 * being laundered into a string. Whitespace-only normalizes to undefined
 * (unset): the worker emits no --countries flag for it, so the run is global.
 */
export function normalizeSimCountries(value: unknown): string | undefined {
  if (typeof value !== "string") return value as string | undefined;
  const ids = value
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean)
    .sort();
  return ids.length ? ids.join(",") : undefined;
}

/**
 * Authoritative requested configuration: the SIM_JOB_REQUESTED_CONFIG_KEYS
 * projection of a job doc (or reported requestedConfig map) with run-profile
 * values normalized. collectExperimentReport.ts builds `requestedConfig`
 * through this, and the pinned-pair assert compares through it, so the
 * report and the comparison can never disagree on what run identity is.
 *
 * Compatibility: absent and undefined stay absent (no defaults injected), so
 * older jobs without mode/countries/cloneFromLive/pinned-source/paired-baseline
 * project exactly as before, and scheduling metadata (startPolicy) passes
 * through dropped on both old and new docs alike.
 */
export function normalizeSimJobRequestedConfig(
  job: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SIM_JOB_REQUESTED_CONFIG_KEYS) {
    if (!(key in job)) continue;
    const raw = job[key];
    if (raw === undefined) continue;
    if (key === "countries") {
      const normalized = normalizeSimCountries(raw);
      if (normalized === undefined) continue;
      out[key] = normalized;
      continue;
    }
    out[key] = raw;
  }
  return out;
}

/**
 * Validates a queued (or reported) control/treatment pair as pinned: the
 * control carries explicit false, the treatment explicit true, and every
 * other SIM_JOB_REQUESTED_CONFIG_KEYS entry is identical under
 * normalizeSimJobRequestedConfig (absent and undefined count as the same
 * unset; countries compare case-, spacing-, and order-insensitively, matching
 * what runWorld actually sees). Accepts full job docs or `requestedConfig`
 * maps, not just experiment fragments, so preset, turns, seed, mode,
 * countries, clone-source, and paired-baseline drift are caught too.
 * Scheduling metadata (startPolicy) and run-instance identity are not run
 * identity and never count as drift. Throws on the first mismatch so the
 * caller knows exactly what unpinned the comparison.
 *
 * Fail-closed on independent live clones (issue #1470
 * experiment-validity audit): two arms that each set cloneFromLive clone the
 * live world at their own claim times, so no flag comparison can prove they
 * started from the same world (not even identical flags). Any cloneFromLive
 * on a pinned pair therefore throws; paired clone comparisons must go
 * through the shared baseline (buildPairedBaselinePair), which both arms
 * copy instead of cloning live.
 */
export function assertRealOutputShadowPinnedPair(
  control: Record<string, unknown>,
  treatment: Record<string, unknown>
): void {
  if (control.realOutputShadowEnabled !== false) {
    throw new Error(
      `pinned pair control must carry realOutputShadowEnabled: false (got ${JSON.stringify(
        control.realOutputShadowEnabled
      )})`
    );
  }
  if (treatment.realOutputShadowEnabled !== true) {
    throw new Error(
      `pinned pair treatment must carry realOutputShadowEnabled: true (got ${JSON.stringify(
        treatment.realOutputShadowEnabled
      )})`
    );
  }
  // Baseline provenance shape first, so a malformed id fails as malformed
  // rather than as drift. Both-or-neither: one arm carrying pair/baseline
  // identity the other lacks is a mismatched start by construction.
  assertPairedBaselineShape(control);
  assertPairedBaselineShape(treatment);
  // Independent live clones can never share a proven start: each arm clones
  // at its own claim time. Fail closed even when the flags match.
  for (const [arm, doc] of [
    ["control", control],
    ["treatment", treatment],
  ] as const) {
    if (doc.cloneFromLive === true) {
      throw new Error(
        `pinned pair ${arm} sets cloneFromLive: paired arms must copy the shared baseline ` +
          `(baselineId) instead of cloning live independently (independent claim-time clones ` +
          `do not share an identical starting world)`
      );
    }
  }
  const a = normalizeSimJobRequestedConfig(control);
  const b = normalizeSimJobRequestedConfig(treatment);
  for (const key of SIM_JOB_REQUESTED_CONFIG_KEYS) {
    if (key === "realOutputShadowEnabled") continue;
    const va = key in a ? a[key] : undefined;
    const vb = key in b ? b[key] : undefined;
    if (JSON.stringify(va ?? null) !== JSON.stringify(vb ?? null)) {
      throw new Error(
        `pinned pair drifted on "${key}": control=${JSON.stringify(va)} treatment=${JSON.stringify(
          vb
        )}`
      );
    }
  }
}

/**
 * Paired-baseline contract (issue #1470 experiment-validity audit). A paired
 * control/treatment request that independently clones live state at different
 * claim times does NOT share an identical starting world. Paired clone
 * comparisons therefore share one immutable sandbox snapshot instead:
 *
 *   1. The supervisor captures the baseline ONCE from live into the sandbox
 *      db baselineDbNameFor(baselineId) (cloneWorld.ts with SOURCE at the
 *      live DB), then stamps it with stampBaseline.ts. That capture is the
 *      only step that ever reads the live game database.
 *   2. Pair creation inserts two simJobs docs with deterministic _ids
 *      (pairedBaselineArmId) carrying the SAME pairId + baselineId, via
 *      buildPairedBaselinePair. Retries upsert by _id, so a retried creation
 *      can never produce a second mismatched pair; planPairedBaselineRepair
 *      recovers a partial creation by reporting exactly which arms are
 *      missing.
 *   3. At claim time the worker copies baseline -> arm db sandbox-to-sandbox
 *      (cloneWorld.ts with SOURCE at the SANDBOX, never live), verifies the
 *      baseline marker, and runs --clone-mode. See planBaselineCopy.
 *
 * Everything here is pure (no Mongo, no env) so creation, repair, and claim
 * planning are unit-testable; worker.ts, stampBaseline.ts, and runWorld.ts
 * stay the only production callers.
 */

/** Sandbox db name holding the immutable snapshot for a baseline id. */
export function baselineDbNameFor(baselineId: string): string {
  assertBaselineId(baselineId);
  // Mongo db names cap at 64 bytes: the 17-char prefix leaves 47 for the id.
  if (baselineId.length > 47) {
    throw new Error(
      `baselineId too long for a sandbox db name (max 47 chars, got ${baselineId.length})`
    );
  }
  return `ahd_sim_baseline_${baselineId}`;
}

/** True for sandbox db names reserved for immutable baseline snapshots. */
export function isBaselineDbName(name: string): boolean {
  return name.startsWith("ahd_sim_baseline_");
}

/** Strict shape check for one baseline id: non-empty SAFE_TOKEN string. */
export function assertBaselineId(value: unknown): string {
  if (typeof value !== "string" || !SAFE_TOKEN.test(value)) {
    throw new Error(`baselineId must match ${SAFE_TOKEN} (got ${JSON.stringify(value)})`);
  }
  return value;
}

/** Strict shape check for one pair id: non-empty SAFE_TOKEN string. */
export function assertPairId(value: unknown): string {
  if (typeof value !== "string" || !SAFE_TOKEN.test(value)) {
    throw new Error(`pairId must match ${SAFE_TOKEN} (got ${JSON.stringify(value)})`);
  }
  return value;
}

/**
 * Both-or-neither shape check for paired-baseline provenance on one arm doc
 * (full job doc or requestedConfig map). Neither set passes (fresh preset
 * bootstrap is deterministic, so unbaselined pairs are still clean). One set
 * without the other throws; malformed values throw. Returns the validated
 * pair when both are set, null when neither is.
 */
export function assertPairedBaselineShape(doc: {
  pairId?: unknown;
  baselineId?: unknown;
}): { pairId: string; baselineId: string } | null {
  const { pairId, baselineId } = doc;
  if (pairId === undefined && baselineId === undefined) return null;
  if (pairId === undefined || baselineId === undefined) {
    throw new Error(
      `pairId and baselineId must both be set (got pairId=${JSON.stringify(pairId)} baselineId=${JSON.stringify(baselineId)})`
    );
  }
  return { pairId: assertPairId(pairId), baselineId: assertBaselineId(baselineId) };
}

/**
 * Builds a baselined pinned pair: identical arms sharing pairId + baselineId,
 * differing only in the shadow flag (control explicit false, treatment
 * explicit true). Pure: enqueues nothing, enables nothing, touches no live
 * config. The base must not set the shadow flag (the pair sets it), must not
 * set pair/baseline identity (the pair sets it), and must not set
 * cloneFromLive (paired arms copy the shared baseline; an independent live
 * clone is exactly the mismatched start this contract removes).
 */
export function buildPairedBaselinePair(
  base: SimJobExperimentFields,
  provenance: { pairId: string; baselineId: string }
): { control: SimJobExperimentFields; treatment: SimJobExperimentFields } {
  if (base.realOutputShadowEnabled !== undefined) {
    throw new Error(
      "buildPairedBaselinePair: base must not set realOutputShadowEnabled (the pair sets it)"
    );
  }
  if (base.pairId !== undefined || base.baselineId !== undefined) {
    throw new Error(
      "buildPairedBaselinePair: base must not set pairId/baselineId (the pair sets them)"
    );
  }
  if (base.cloneFromLive !== undefined) {
    throw new Error(
      "buildPairedBaselinePair: base must not set cloneFromLive (paired arms copy the shared baseline instead of cloning live)"
    );
  }
  const pairId = assertPairId(provenance.pairId);
  const baselineId = assertBaselineId(provenance.baselineId);
  return {
    control: { ...base, pairId, baselineId, realOutputShadowEnabled: false },
    treatment: { ...base, pairId, baselineId, realOutputShadowEnabled: true },
  };
}

/** Durable arm of a baselined pair. */
export type PairedBaselineArm = "control" | "treatment";

/**
 * Deterministic simJobs _id for one arm. Pair creation inserts (upserts) by
 * this id, so a crashed-and-retried creation converges on the same two docs
 * instead of producing a second mismatched pair.
 */
export function pairedBaselineArmId(pairId: string, arm: PairedBaselineArm): string {
  return `${assertPairId(pairId)}-${arm}`;
}

/**
 * Crash-safe creation recovery: given the arm docs already present for a
 * pair (rows matching pairId, or their _ids), returns exactly which arms
 * still need inserting. Empty means the pair is complete; re-running a
 * completed creation inserts nothing. Foreign docs (other pairs) are
 * ignored. Pure over plain records so queue backends stay out of this
 * module; the caller queries simJobs by pairId and upserts the missing arms
 * by pairedBaselineArmId.
 */
export function planPairedBaselineRepair(
  existing: ReadonlyArray<{ _id: string } | string>,
  pairId: string
): PairedBaselineArm[] {
  const want: PairedBaselineArm[] = ["control", "treatment"];
  const ids = new Set(existing.map((doc) => (typeof doc === "string" ? doc : doc._id)));
  return want.filter((arm) => !ids.has(pairedBaselineArmId(pairId, arm)));
}

/**
 * Pure claim planner for a baselined arm: derives the sandbox-to-sandbox
 * copy (baseline snapshot db -> arm db). Throws when the job carries no
 * baseline, when the destination is itself a baseline snapshot db (baseline
 * dbs never run turns: they are immutable sources), or when source and
 * destination coincide. The worker resolves both names against the SANDBOX
 * Mongo only; the live game database is never an endpoint of this copy.
 */
export function planBaselineCopy(job: {
  pairId?: unknown;
  baselineId?: unknown;
  dbName?: unknown;
}): { sourceDb: string; destDb: string } {
  const provenance = assertPairedBaselineShape(job);
  if (!provenance) {
    throw new Error("planBaselineCopy: job carries no paired-baseline provenance");
  }
  const { dbName } = job;
  if (typeof dbName !== "string" || !SAFE_TOKEN.test(dbName)) {
    throw new Error(
      `planBaselineCopy: job dbName must match ${SAFE_TOKEN} (got ${JSON.stringify(dbName)})`
    );
  }
  if (isBaselineDbName(dbName)) {
    throw new Error(
      `planBaselineCopy: refusing to run turns against baseline snapshot db "${dbName}" (baselines are immutable copy sources, never run targets)`
    );
  }
  const sourceDb = baselineDbNameFor(provenance.baselineId);
  if (sourceDb === dbName) {
    throw new Error(`planBaselineCopy: source and destination coincide ("${dbName}")`);
  }
  return { sourceDb, destDb: dbName };
}

/**
 * Provenance argv the worker passes to runWorld so the child stamps executed
 * pair/baseline identity onto the simRuns doc. Empty when unbaselined.
 * Values are shape-checked here so a malformed id fails at plan time, not
 * mid-run. Emitted only by planRunWorldSpawn (simSource.ts); never by hand.
 */
export function baselineProvenanceFlags(job: SimJobExperimentFields): string[] {
  const provenance = assertPairedBaselineShape(job);
  if (!provenance) return [];
  return [`--pair-id=${provenance.pairId}`, `--baseline-id=${provenance.baselineId}`];
}

/**
 * Immutability guard for the baseline snapshot marker (stampBaseline.ts).
 * The marker records the live gameState turn (and doc count) seen at capture;
 * a re-stamp observing a different turn or count means something ran against
 * the baseline db, so the snapshot is no longer immutable and stamping must
 * refuse. Same observation re-stamps idempotently. Pure so the refusal is
 * unit-testable without Mongo.
 */
export function assertBaselineStampCompatible(
  existing: { baselineId: string; sourceTurn: number; docCount: number } | null,
  observed: { baselineId: string; sourceTurn: number; docCount: number }
): void {
  if (!existing) return;
  if (existing.sourceTurn !== observed.sourceTurn || existing.docCount !== observed.docCount) {
    throw new Error(
      `baseline "${observed.baselineId}" changed since capture (turn ${existing.sourceTurn}->${observed.sourceTurn}, docs ${existing.docCount}->${observed.docCount}): refusing to re-stamp a mutated snapshot`
    );
  }
}

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
