// Remediation ledger types.
//
// A `Defect` is ONE corruption-class bug carrying BOTH halves of its fix:
// the code change that stops new bad rows, and the data heal that repairs the
// rows already written. Shipping one without the other is the standard failure
// mode: code-only leaves players staring at wrong numbers forever, heal-only
// re-corrupts on the next turn.
//
// The lifecycle is fixed and the runner enforces it:
//
//   detect -> plan -> apply -> verify
//
// `detect`, `plan` and `verify` are READ ONLY and always safe to call. `apply`
// is the only writer, and it cannot run without a live confirm token minted by
// `plan` against the exact world state it saw (see token.ts).
//
// Deliberately parallel to src/lib/migrations/types.ts, and it reuses that
// module's result shape so one vocabulary covers both systems. The split:
// migrations are one-shot schema/data cutovers ordered in a registry; heals are
// idempotent repairs to state that a shipped bug produced. If re-running it is
// not a safe no-op, it is a migration, not a heal.

import type { Db } from "mongodb";
import type { MigrationResult } from "@/lib/migrations/types";

/** Environments a defect can be healed in. Always named explicitly, never inferred. */
export type HealEnv = "dev" | "sandbox" | "prod";

export const HEAL_ENVS: readonly HealEnv[] = ["dev", "sandbox", "prod"] as const;

/** Result of a heal. Same shape migrations report, so tooling reads one format. */
export type HealResult = MigrationResult & {
  /**
   * Documents this heal CREATED, by collection. Rollback deletes these.
   * A backup snapshot cannot capture a document that did not exist yet, so a
   * defect whose apply() inserts MUST report the new ids here or its rollback
   * is incomplete.
   */
  insertedIds?: TouchedDocs[];
};

/** Documents a plan intends to touch. Drives the generic pre-write snapshot. */
export interface TouchedDocs {
  collection: string;
  /** Stringified _id values. Order-insensitive: the digest sorts before hashing. */
  ids: string[];
}

/**
 * Read-only detector output. This IS the definition of the bug: if you cannot
 * write a query that counts the bad rows, you cannot verify the heal worked and
 * the defect does not belong in the ledger yet.
 */
export interface DetectResult {
  /** Number of bad rows/entities. Zero means healthy. */
  affected: number;
  /** A handful of offending documents for eyeballing. Cap at ~10. */
  sample: unknown[];
  notes?: string[];
}

/**
 * Read-only dry run. Everything apply() will do, described but not done.
 */
export interface HealPlan {
  /** Entities the heal will change. Normally equals DetectResult.affected. */
  affected: number;
  /** Documents to be mutated or deleted. Snapshotted to healBackups before any write. */
  touched: TouchedDocs[];
  /**
   * Net currency this heal creates (positive) or destroys (negative), in the
   * relevant local units. MUST be 0 unless the defect declares `mintsMoney`.
   * Half the incident history on this box is a heal that quietly printed money.
   */
  moneyDelta: number;
  /** One line an operator can read and approve. */
  summary: string;
  notes?: string[];
  /**
   * Defect-specific data handed straight back to apply(), so apply() does not
   * recompute (and cannot silently disagree with what was approved).
   */
  payload?: unknown;
}

/** Verifier output: the detector plus whatever invariants the defect cares about. */
export interface VerifyResult {
  ok: boolean;
  /** Detector count after the heal. Must be 0 for `ok`. */
  remaining: number;
  notes: string[];
}

/** Named guards the runner enforces before apply(). Unknown names are a hard error. */
export type GuardName =
  /** gameState.isProcessing must be false — never write mid-turn. */
  | "turn-lock-free"
  /** Refuse if the plan touches more than N entities. `max-affected:5000` */
  | `max-affected:${number}`
  /** Refuse if plan.moneyDelta !== 0. Implied unless the defect sets mintsMoney. */
  | "money-conserving";

export interface CodeFix {
  /** PR number in egg3901/a-house-divided. */
  pr?: number;
  /** Branch the fix must have reached. Informational. */
  mergedTo?: string;
  /**
   * Commit that must be an ANCESTOR of whatever is deployed to the target env
   * before the heal may run there. This is the code gate — the mechanism that
   * makes "fix both halves" enforced rather than aspirational.
   */
  requiredCommit?: string;
  /** GitHub issue this defect closes. */
  issue?: number;
}

/**
 * The THIRD surface, and the one everyone forgets.
 *
 * A code fix stops new bad rows in running worlds. A heal repairs the rows
 * already written. Neither touches the SEED — so if the seed emits the bad
 * shape, every world reset, every new era and every sandbox rebuild puts the
 * corruption straight back. Healing live data against a bad seed is a treadmill.
 *
 * `status` is mandatory on every defect and defaults to nothing: you have to
 * say which. `unknown` is allowed but `plan` warns on it loudly, because an
 * unassessed defect is one world reset away from undoing your heal.
 */
export interface SeedFix {
  /**
   * - `fixed`       the seed no longer emits the bad shape
   * - `not-needed`  the corruption is runtime-only; `note` must say why
   * - `unknown`     nobody has looked yet. Warned about on every plan.
   */
  status: "fixed" | "not-needed" | "unknown";
  /** Seed files involved, or that were checked and cleared. */
  files?: string[];
  /** Required for `not-needed`: the reason a seed cannot produce this. */
  note?: string;
  /**
   * Country/era pair the seed-audit MCP can replay to check whether a fresh
   * seed reproduces the bad shape. Turns `unknown` into an answer.
   */
  seedCheck?: { countryId: string; era: string };
}

/** Context handed to detect/plan/apply/verify. */
export interface HealContext {
  env: HealEnv;
  /** True inside plan(). Belt and braces: plan() must not write regardless. */
  dryRun: boolean;
  /** Run id, present in apply(). Same id as the healRuns marker and healBackups rows. */
  runId?: string;
  now: Date;
}

/**
 * One defect: both halves, linked by `id`.
 */
export interface Defect {
  /** Stable forever. `AHD-<issue#>` or `AHD-<slug>`. Used as a key in healRuns. */
  id: string;
  title: string;
  severity: "P0" | "P1" | "P2" | "P3";
  /** Half A. Absent only for corruption with no code cause (bad seed, manual edit). */
  codeFix?: CodeFix;
  /**
   * Half C. MANDATORY — set `{ status: "unknown" }` if nobody has looked, but
   * you cannot omit the question. See SeedFix.
   */
  seedFix: SeedFix;
  /** Environments this defect may be healed in. */
  envs: HealEnv[];
  /**
   * Re-running apply() after success must be a safe no-op. The runner refuses
   * to register a non-idempotent defect: that is a migration.
   */
  idempotent: true;
  /** Set only when the heal legitimately changes total money. Requires a note saying why. */
  mintsMoney?: boolean;
  guards: GuardName[];

  /** READ ONLY. Counts bad rows. */
  detect: (db: Db, ctx: HealContext) => Promise<DetectResult>;
  /** READ ONLY. Produces the write plan. */
  plan: (db: Db, ctx: HealContext) => Promise<HealPlan>;
  /** The ONLY writer. Receives the exact plan that was approved. */
  apply: (db: Db, plan: HealPlan, ctx: HealContext) => Promise<HealResult>;
  /** READ ONLY. Detector plus invariants. */
  verify: (db: Db, ctx: HealContext) => Promise<VerifyResult>;
}

/** Row in the `healRuns` collection. The audit trail heals have never had. */
export interface HealRun {
  _id: string;
  defectId: string;
  env: HealEnv;
  startedAt: Date;
  finishedAt?: Date;
  status: "running" | "succeeded" | "failed" | "rolled-back";
  operator: string;
  planSummary: string;
  planAffected: number;
  moneyDelta: number;
  result?: HealResult;
  error?: string;
  /** Outcome of the code gate at apply time, including any recorded override. */
  codeGate?: CodeGateResult;
  backupCount: number;
  verify?: VerifyResult;
}

/** Row in `healBackups`. One per document, snapshotted before the first write. */
export interface HealBackup {
  runId: string;
  defectId: string;
  collection: string;
  docId: string;
  doc: Record<string, unknown>;
  createdAt: Date;
}

/**
 * One cell of the env matrix: is THIS defect clean in THIS env?
 *
 * The reason this exists: `Defect.envs` says where a heal MAY run, not where it
 * HAS run. Without a per-env view the standing question "is sandbox still
 * dirty?" only gets answered when somebody remembers to ask it, which is how
 * sandbox stays broken for weeks after prod is healed.
 */
export interface EnvStatus {
  env: HealEnv;
  /** False when the env has no configured database. */
  configured: boolean;
  /** Detector count. null when unreachable or unconfigured. */
  affected: number | null;
  /** "clean" | "DIRTY" | "unconfigured" | "error" */
  state: "clean" | "dirty" | "unconfigured" | "error";
  lastRun?: { runId: string; at: Date; status: string; operator: string };
  error?: string;
}

/** A defect's standing across every environment. */
export interface DefectStatus {
  defectId: string;
  title: string;
  severity: Defect["severity"];
  seedFix: SeedFix;
  envs: EnvStatus[];
  /** Any env dirty. The thing a nightly job alerts on. */
  anyDirty: boolean;
  /** Warnings that are not per-env: unassessed seed, unpinned code fix. */
  warnings: string[];
}

/**
 * An ad-hoc repair: corruption with no ledger entry yet.
 *
 * This exists so that reaching for mongosh is never the easier option. A
 * one-off written here goes through the SAME machinery as a registered defect
 * — dry run, confirm token, turn lock, row cap, pre-write snapshot, healRuns
 * record, rollback — instead of through an unlogged shell that nobody can
 * audit or undo.
 *
 * It is not a replacement for a ledger entry. Anything that recurs should be
 * promoted into `defects/`; `heal_history` makes the repeats visible.
 */
export interface AdhocSpec {
  /** Required. Goes into healRuns as the only explanation that will survive. */
  description: string;
  /** Ticket or issue reference, if there is one. */
  ticket?: string;
  collection: string;
  /** Match expression. An empty filter needs confirmWholeCollection. */
  filter: Record<string, unknown>;
  action:
    | { kind: "set"; set: Record<string, unknown> }
    | { kind: "unset"; unset: string[] }
    | { kind: "delete" };
  /**
   * Refuse if more documents match than this. Required: an unbounded ad-hoc
   * write is the single most dangerous thing anyone can do to this database.
   */
  expectedMax: number;
  /** Required when the write touches a money-shaped field. */
  touchesMoney?: boolean;
  /** Required to run against an empty filter (the whole collection). */
  confirmWholeCollection?: boolean;
}

/**
 * Verdict on "is the code fix live in this env yet". Computed OUTSIDE this
 * module (it needs git and the Railway deploy state) and passed in, because
 * nothing in the Next runtime can shell out to git.
 */
export interface CodeGateResult {
  ok: boolean;
  /** Commit currently deployed to the target env, if known. */
  deployedSha?: string;
  requiredCommit?: string;
  detail: string;
  /** Set when an operator knowingly bypassed a failing gate. Recorded forever. */
  override?: { reason: string; operator: string };
}
