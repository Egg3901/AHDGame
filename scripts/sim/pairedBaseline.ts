/**
 * Production-callable paired-baseline creation surface (issue #1470).
 *
 * Until now buildPairedBaselinePair / pairedBaselineArmId /
 * planPairedBaselineRepair had no runtime callers (tests only): pair
 * creation was manual supervisor procedure. This module wires them up:
 *
 * - planPairedBaselineCreation: pure input validation + deterministic arm-doc
 *   planning. Validates the source pin (shape), pairId/baselineId, strict
 *   control=false/treatment=true flags (via buildPairedBaselinePair), and
 *   sandbox arm db names; rejects anything resembling a live target
 *   (cloneFromLive, explicit db names, LIVE/OPS/MONGODB keys, unknown keys).
 *   Enqueues nothing, touches no database.
 * - resolvePairedBaselineWrites: pure idempotent write planner over already
 *   stored docs. Uses planPairedBaselineRepair for the missing-arm set and
 *   additionally rejects same-_id content divergence AND pairId-tagged docs
 *   outside the two deterministic _ids (manual surgery fails closed).
 * - createPairedBaselinePair: stateful creation against a minimal store
 *   interface. Concurrent/retried creators converge: arms are upserted by
 *   deterministic _id, a duplicate-key race re-reads and re-resolves instead
 *   of forking a second pair.
 * - createPairedBaselineTool: the narrow local-worldsim MCP tool
 *   (sim_create_paired_baseline) built on the above, consistent with the
 *   existing simJobs APIs (same control-plane collection, same validation
 *   helpers, same arm doc shape the worker claims).
 *
 * Safe queue procedure (supervisor):
 *   1. cloneWorld.ts live -> baselineDbNameFor(baselineId) (the ONLY step
 *      that reads the live game database),
 *   2. stampBaseline.ts --baseline-id=<id> (seals the snapshot),
 *   3. sim_create_paired_baseline (this tool; validates + inserts both arms),
 *   4. the sim worker claims each arm: revalidates the seal immediately
 *      before the sandbox-to-sandbox copy and verifies the copied marker
 *      before running turns.
 *
 * Stamp existence is enforced fail-closed at worker claim time, not here:
 * this surface only sees the control-plane queue, never the sandbox Mongo,
 * so it validates provenance shape/identity while the worker validates the
 * actual seal. Unpaired jobs and fresh-bootstrap pairs are untouched by
 * everything here (no provenance in, no provenance out).
 */

import {
  assertSafeToken,
  assertPairedBaselineShape,
  assertRealOutputShadowPinnedPair,
  baselineDbNameFor,
  buildPairedBaselinePair,
  buildRunWorldArgs,
  isBaselineDbName,
  normalizeSimJobRequestedConfig,
  pairedBaselineArmId,
  planPairedBaselineRepair,
  type PairedBaselineArm,
  type SimJobExperimentFields,
} from "./simJobArgs";
import { assertSimSourceShape } from "./simSource";

/** MCP-visible tool name. */
export const PAIRED_BASELINE_TOOL_NAME = "sim_create_paired_baseline";

/** Control-plane collection, mirroring localWorldsimMcp.ts. */
export const PAIRED_BASELINE_JOBS_COLLECTION = "simJobs";

/** Creation input keys. Anything else (cloneFromLive, dbName, runId, LIVE_*,
 * MONGODB_*, OPS_*, ...) is rejected: this surface never names a live DB. */
const CREATION_INPUT_KEYS = [
  "preset",
  "turns",
  "seed",
  "pairId",
  "baselineId",
  "sourceWorktree",
  "sourceCommit",
  "marketSystemMode",
  "labourSystemMode",
  "freightSettlementMode",
  "canonicalFreightBillingEnabled",
  "shortageResponsiveSourcingEnabled",
  "indexFundBondLiquidityEnabled",
  "equityLiquidityFacilityEnabled",
  "nppMarketCoverageEnabled",
  "nppFragileMarketSupplyEnabled",
  "allFeatureFlags",
  "autonomyLevel",
  "mode",
  "countries",
] as const;

/** One planned arm: deterministic queue identity + full job-doc fields
 * (timestamps are stamped by the writer at insert so content comparison
 * stays deterministic across retried creators). */
export interface PlannedPairedArm {
  arm: PairedBaselineArm;
  runId: string;
  dbName: string;
  doc: Record<string, unknown>;
}

export interface PlannedPairedBaseline {
  pairId: string;
  baselineId: string;
  baselineDb: string;
  control: PlannedPairedArm;
  treatment: PlannedPairedArm;
}

/**
 * Sandbox db for one arm. Derived from the seed (never caller-supplied, so
 * two creators cannot disagree): ahd_sim_<seed>-<arm>. Length-guarded to the
 * 64-byte Mongo db-name limit and refused when it would collide with the
 * baseline namespace (a seed starting with "baseline_" would make the arm
 * db look like an immutable snapshot, which the worker refuses to run).
 */
export function pairedBaselineArmDbName(seed: string, arm: PairedBaselineArm): string {
  const name = `ahd_sim_${seed}-${arm}`;
  if (name.length > 64) {
    throw new Error(
      `Job field "dbName" failed validation (arm db "${name}" exceeds the 64-byte Mongo limit: use a shorter seed)`
    );
  }
  assertSafeToken(name, "dbName");
  if (isBaselineDbName(name)) {
    throw new Error(
      `Job field "dbName" failed validation (arm db "${name}" collides with the baseline snapshot namespace: seed must not start with "baseline_")`
    );
  }
  return name;
}

function requiredToken(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== "string") {
    throw new Error(`"${field}" is required (got ${JSON.stringify(value)})`);
  }
  return assertSafeToken(value, field);
}

function turnsOf(value: unknown, maxTurns: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > maxTurns) {
    throw new Error(`"turns" must be an integer 1..${maxTurns} (got ${JSON.stringify(value)})`);
  }
  return n;
}

/**
 * Pure creation planner. Throws on every invalid input (fail closed); the
 * returned arm docs pass assertRealOutputShadowPinnedPair end to end.
 */
export function planPairedBaselineCreation(
  input: Record<string, unknown>,
  opts?: { maxTurns?: number; controlDbName?: string }
): PlannedPairedBaseline {
  const maxTurns = opts?.maxTurns ?? 1000;
  for (const key of Object.keys(input)) {
    if (!(CREATION_INPUT_KEYS as readonly string[]).includes(key)) {
      throw new Error(
        `unknown creation field "${key}": sim_create_paired_baseline accepts only run-profile fields (never cloneFromLive, db names, run ids, or database credentials)`
      );
    }
  }
  const preset = requiredToken(input, "preset");
  const seed = requiredToken(input, "seed");
  const turns = turnsOf(input.turns, maxTurns);

  const base: SimJobExperimentFields = {};
  for (const key of CREATION_INPUT_KEYS) {
    if (
      key === "preset" ||
      key === "turns" ||
      key === "seed" ||
      key === "pairId" ||
      key === "baselineId"
    ) {
      continue;
    }
    const value = input[key];
    if (value !== undefined) (base as Record<string, unknown>)[key] = value;
  }
  // Pinned source: shape-checked here (existence/HEAD/cleanliness stay the
  // worker's job at claim and pre-spawn time, as with sim_run_world).
  // Strict strings first so a non-string pin fails with a plan-time error
  // rather than a downstream TypeError or a stored wrong-typed value.
  if (
    (base.sourceWorktree !== undefined && typeof base.sourceWorktree !== "string") ||
    (base.sourceCommit !== undefined && typeof base.sourceCommit !== "string")
  ) {
    throw new Error(
      `sourceWorktree and sourceCommit must both be strings (got ${JSON.stringify({
        sourceWorktree: base.sourceWorktree,
        sourceCommit: base.sourceCommit,
      })})`
    );
  }
  assertSimSourceShape({
    sourceWorktree: base.sourceWorktree === undefined ? undefined : String(base.sourceWorktree),
    sourceCommit: base.sourceCommit === undefined ? undefined : String(base.sourceCommit),
  });
  if (base.sourceWorktree !== undefined) {
    assertSafeToken(String(base.sourceWorktree), "sourceWorktree");
  }

  const pairId = requiredToken(input, "pairId");
  const baselineId = requiredToken(input, "baselineId");
  const baselineDb = baselineDbNameFor(baselineId);
  // Fail fast on invalid tiers/modes/tokens exactly as the worker would at
  // emission time (buildRunWorldArgs never emits provenance or clone mode).
  buildRunWorldArgs(base);

  const { control, treatment } = buildPairedBaselinePair(base, { pairId, baselineId });

  const arms: PlannedPairedArm[] = (["control", "treatment"] as const).map((arm) => {
    const runId = pairedBaselineArmId(pairId, arm);
    const dbName = pairedBaselineArmDbName(seed, arm);
    if (opts?.controlDbName && dbName === opts.controlDbName) {
      throw new Error(
        `arm db "${dbName}" collides with the control-plane db "${opts.controlDbName}" — refusing to plan`
      );
    }
    const experiment = arm === "control" ? control : treatment;
    const doc: Record<string, unknown> = {
      _id: runId,
      runId,
      status: "queued",
      preset,
      turns,
      seed,
      dbName,
      currentTurn: 0,
      error: null,
      ...experiment,
    };
    return { arm, runId, dbName, doc };
  });
  const [plannedControl, plannedTreatment] = arms as [PlannedPairedArm, PlannedPairedArm];
  // Final gate: the exact assert the report path uses. dbName differs per
  // arm by construction but is run-instance identity (not in
  // SIM_JOB_REQUESTED_CONFIG_KEYS), so pinned identity must still hold.
  assertRealOutputShadowPinnedPair(plannedControl.doc, plannedTreatment.doc);
  assertPairedBaselineShape(plannedControl.doc);
  assertPairedBaselineShape(plannedTreatment.doc);
  return { pairId, baselineId, baselineDb, control: plannedControl, treatment: plannedTreatment };
}

/** Run-identity comparison for one arm: queue-level fields plus the
 * authoritative requested-config projection. Timestamps, status, runId/_id
 * (compared separately by deterministic identity) and other run-instance
 * fields never count. */
export function pairedArmContentMatches(
  existing: Record<string, unknown>,
  planned: Record<string, unknown>
): boolean {
  for (const key of ["preset", "turns", "seed", "dbName"] as const) {
    if (JSON.stringify(existing[key] ?? null) !== JSON.stringify(planned[key] ?? null)) {
      return false;
    }
  }
  const a = normalizeSimJobRequestedConfig(existing);
  const b = normalizeSimJobRequestedConfig(planned);
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Pure idempotent write planner over the pair's already stored docs.
 * Returns the arms still needing inserts (planPairedBaselineRepair over the
 * deterministic _ids). Throws fail-closed on:
 * - a stored arm _id whose content diverges from the plan (same-id content
 *   divergence is caught HERE, not only by the post-hoc assert), and
 * - a pairId-tagged doc outside the two deterministic _ids (manual surgery).
 */
export function resolvePairedBaselineWrites(
  existing: ReadonlyArray<Record<string, unknown>>,
  planned: PlannedPairedBaseline
): { missing: PairedBaselineArm[] } {
  const byId = new Map<string, Record<string, unknown>>();
  for (const doc of existing) {
    if (typeof doc._id === "string") byId.set(doc._id, doc);
  }
  for (const arm of [planned.control, planned.treatment] as const) {
    const stored = byId.get(arm.runId);
    if (stored && !pairedArmContentMatches(stored, arm.doc)) {
      throw new Error(
        `paired arm "${arm.runId}" already exists with different content (baseline/seed/turns/source/flag drift): refusing to overwrite a mismatched arm`
      );
    }
  }
  const known = new Set([planned.control.runId, planned.treatment.runId]);
  for (const doc of existing) {
    // Every doc here came from listByPairId, so every one is pairId-tagged:
    // any _id outside the two deterministic arm ids is manual surgery,
    // whatever its type (a non-string _id must not slip past the guard).
    if (!known.has(doc._id as string)) {
      throw new Error(
        `pair "${planned.pairId}" has an unexpected job "${String(doc._id)}" outside the two deterministic arm ids: refusing to create beside manual surgery`
      );
    }
  }
  const missing = planPairedBaselineRepair([...byId.keys()], planned.pairId);
  return { missing };
}

/** Minimal queue backend: the MCP adapter implements this over the real
 * simJobs collection; tests implement it over a fake. A conflicting _id
 * insert must surface as an error with code 11000 (the mongodb driver
 * does this natively). */
export interface PairedBaselineStore {
  listByPairId(pairId: string): Promise<Array<Record<string, unknown>>>;
  insertArm(doc: Record<string, unknown>): Promise<void>;
}

export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === 11000;
}

export interface PairedBaselineCreationResult {
  pairId: string;
  baselineId: string;
  baselineDb: string;
  repaired: boolean;
  arms: Array<{ arm: PairedBaselineArm; runId: string; dbName: string; created: boolean }>;
}

/**
 * Stateful creation: plan, resolve against stored docs, insert missing arms
 * by deterministic _id. A duplicate-key race (concurrent/retried creator
 * inserted first) re-lists and re-resolves instead of forking: identical
 * content converges, divergent content throws via
 * resolvePairedBaselineWrites. Bounded attempts; a still-missing arm after
 * the bound is a convergence failure, not a silent partial.
 */
export async function createPairedBaselinePair(
  input: Record<string, unknown>,
  store: PairedBaselineStore,
  opts?: { maxTurns?: number; controlDbName?: string }
): Promise<PairedBaselineCreationResult> {
  const planned = planPairedBaselineCreation(input, opts);
  const docs: Record<PairedBaselineArm, Record<string, unknown>> = {
    control: planned.control.doc,
    treatment: planned.treatment.doc,
  };
  const created: Record<PairedBaselineArm, boolean> = { control: false, treatment: false };
  let repaired = false;
  // At most one insert per arm plus one re-resolve per duplicate-key race.
  for (let attempt = 0; attempt < 4; attempt++) {
    const existing = await store.listByPairId(planned.pairId);
    // Repaired means this call found arms it did not create (a partial
    // creation crashed midway, or a concurrent creator won the race), judged
    // on the FIRST listing only: later listings trivially see our own writes.
    if (attempt === 0 && existing.length > 0) repaired = true;
    const { missing } = resolvePairedBaselineWrites(existing, planned);
    if (missing.length === 0) {
      return {
        pairId: planned.pairId,
        baselineId: planned.baselineId,
        baselineDb: planned.baselineDb,
        repaired,
        arms: (["control", "treatment"] as const).map((arm) => ({
          arm,
          runId: arm === "control" ? planned.control.runId : planned.treatment.runId,
          dbName: arm === "control" ? planned.control.dbName : planned.treatment.dbName,
          created: created[arm],
        })),
      };
    }
    let raced = false;
    for (const arm of missing) {
      const now = new Date();
      try {
        await store.insertArm({ ...docs[arm], createdAt: now, updatedAt: now });
        created[arm] = true;
      } catch (err) {
        if (!isDuplicateKeyError(err)) throw err;
        raced = true;
        break;
      }
    }
    if (!raced) {
      // All missing arms inserted by this attempt; loop once more to confirm
      // convergence through the resolver (mismatch throws there).
      continue;
    }
  }
  throw new Error(
    `pair "${planned.pairId}" did not converge after bounded creation attempts: re-list the pair before retrying`
  );
}

/** Structural control-plane handle: satisfied by the real mongodb Db and by
 * fakes. Only find/insertOne on simJobs are ever used. */
export interface PairedBaselineToolDb {
  collection(name: string): {
    find(query: Record<string, unknown>): { toArray(): Promise<Array<Record<string, unknown>>> };
    insertOne(doc: Record<string, unknown>): Promise<unknown>;
  };
}

function toolStr(description: string) {
  return { type: "string", description };
}
function toolInt(description: string, minimum?: number, maximum?: number) {
  return {
    type: "integer",
    description,
    ...(minimum !== undefined ? { minimum } : {}),
    ...(maximum !== undefined ? { maximum } : {}),
  };
}
function toolBool(description: string) {
  return { type: "boolean", description };
}

/** MCP tool description (registered by localWorldsimMcp.ts, the production caller). */
export const PAIRED_BASELINE_TOOL_DESCRIPTION =
  "Create the two queued simJobs arms of an issue-#1470 real-output shadow paired-baseline comparison (control realOutputShadowEnabled=false, treatment true) sharing one stamped immutable baseline snapshot. Validates the source pin, pair/baseline identity, arm sandbox db names, and strict flags; repairs partial creation idempotently; rejects mismatched existing arms; concurrent creators converge. The baseline snapshot must already be captured (cloneWorld.ts) and sealed (stampBaseline.ts): the worker revalidates the seal at claim time. Returns immediately; the worker claims arms within ~15s. Sandbox only, never the live game.";

/** MCP input schema for the tool (plain JSON Schema, as in localWorldsimMcp.ts). */
export const PAIRED_BASELINE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    preset: toolStr('e.g. "1953-default"'),
    turns: toolInt("how many turns to advance per arm (1..1000)", 1, 1000),
    seed: toolStr(
      "RNG seed label — also derives both arm sandbox db names (ahd_sim_<seed>-control/-treatment). Use a short seed: the derived names must fit the 64-byte Mongo limit."
    ),
    pairId: toolStr(
      "pair grouping id shared by both arms (also determines the deterministic arm runIds)"
    ),
    baselineId: toolStr(
      "stamped immutable baseline snapshot id both arms copy (sandbox db ahd_sim_baseline_<id>). Capture + stamp it BEFORE creating the pair."
    ),
    sourceWorktree: toolStr(
      "Pinned source: registered worktree name under /root/projects/AHDGame/worktrees to execute instead of the worker default. Requires sourceCommit."
    ),
    sourceCommit: toolStr(
      "Pinned source: full 40-hex commit SHA that must equal the worktree HEAD. Requires sourceWorktree."
    ),
    marketSystemMode: toolStr("structural-market tier; omit for the preset default"),
    labourSystemMode: toolStr("labour tier; omit for the preset default"),
    freightSettlementMode: {
      type: "string",
      enum: ["shadow", "active"],
      description: "Geographic freight effect for this sandbox comparison only.",
    },
    canonicalFreightBillingEnabled: toolBool("Sandbox-only freight billing override."),
    shortageResponsiveSourcingEnabled: toolBool("Sandbox-only sourcing override."),
    indexFundBondLiquidityEnabled: toolBool("Sandbox-only bond-liquidity override."),
    equityLiquidityFacilityEnabled: toolBool("Sandbox-only equity-liquidity override."),
    nppMarketCoverageEnabled: toolBool("Sandbox-only NPP coverage override."),
    nppFragileMarketSupplyEnabled: toolBool("Sandbox-only fragile-supply override."),
    allFeatureFlags: toolBool("Sandbox-only all-feature sweep flag."),
    autonomyLevel: toolStr("NPP autonomy tier (e.g. v4 for long full-world runs)."),
    mode: toolStr('Sim turn-phase profile ("full" or "elections-only").'),
    countries: toolStr('Elections-only scope, e.g. "US,UK,DE"; omit for global.'),
  },
  required: ["preset", "turns", "seed", "pairId", "baselineId"],
  additionalProperties: false,
};

/**
 * The narrow MCP tool runner. Called by localWorldsimMcp.ts (production
 * caller) and by tests against a fake Db. Never exposes or accepts a live
 * database: no live-credential input or output, arm dbs are derived
 * sandbox names, and the control-plane db collision is refused.
 */
export async function runPairedBaselineTool(
  args: Record<string, unknown>,
  db: PairedBaselineToolDb,
  opts: { controlDbName: string; maxTurns?: number }
): Promise<Record<string, unknown>> {
  const store: PairedBaselineStore = {
    listByPairId: async (pairId) =>
      db.collection(PAIRED_BASELINE_JOBS_COLLECTION).find({ pairId }).toArray(),
    insertArm: async (doc) => {
      await db.collection(PAIRED_BASELINE_JOBS_COLLECTION).insertOne(doc);
    },
  };
  const result = await createPairedBaselinePair(args, store, {
    controlDbName: opts.controlDbName,
    maxTurns: opts.maxTurns,
  });
  return {
    ...result,
    preset: args.preset,
    turns: args.turns,
    seed: args.seed,
    sourceWorktree: args.sourceWorktree || "(worker default)",
    sourceCommit: args.sourceCommit || "(worker default)",
    note: `Baseline "${result.baselineId}" must already be captured into ${result.baselineDb} and sealed with stampBaseline.ts; each arm copies it sandbox-to-sandbox at claim. Poll arm status with sim_run_status.`,
  };
}
