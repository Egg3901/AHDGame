/**
 * Pinned collector provenance (issue #2083).
 *
 * Pinned worldsim jobs execute runWorld.ts from their validated source
 * worktree, so every post-run collector (metrics, experiment, election)
 * must collect from that same worktree: branch-specific report fields are
 * otherwise silently omitted by the shared runtime checkout's older code.
 *
 * This module is the pure, unit-tested seam the worker plans from and the
 * collectors enforce with. Read-only git only (rev-parse HEAD) — never
 * fetch, checkout, reset, or otherwise mutate the tree. Sandbox isolation,
 * the claim window, and capacity admission are untouched.
 */

import { execFileSync } from "child_process";
import { buildActorCoverageSection, summarizeActorCoverageForVerdict } from "@/lib/sim/actorReport";
import type { ActorCoverageManifest } from "@/lib/sim/actorCoverage";
import { sourceProvenanceFlags, type VerifiedSimSource } from "./simSource";

/** Post-run collectors in worker execution order. */
export const COLLECTOR_SCRIPTS = [
  "scripts/sim/collectMetrics.ts",
  "scripts/sim/collectExperimentReport.ts",
  "scripts/sim/collectElectionReport.ts",
] as const;

export interface CollectorSpawnPlan {
  script: (typeof COLLECTOR_SCRIPTS)[number];
  /** Explicit cwd for the collector child process. */
  cwd: string;
  /** Full argv: --db/--run-id plus pinned-source provenance flags. */
  args: string[];
}

/** Pure spawn planner: pins every collector cwd to the verified worktree,
 * falls back to the worker default repo otherwise. worker.ts stays the only
 * production caller and never mutates git state. */
export function planCollectorSpawns(
  job: { dbName: string; runId: string },
  defaultRepoDir: string,
  verified: VerifiedSimSource | null
): CollectorSpawnPlan[] {
  const baseArgs = [`--db=${job.dbName}`, `--run-id=${job.runId}`];
  const flags = sourceProvenanceFlags(verified);
  return COLLECTOR_SCRIPTS.map((script) => ({
    script,
    cwd: verified?.repoDir ?? defaultRepoDir,
    args: [...baseArgs, ...flags],
  }));
}

function flagValue(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return argv.find((v) => v.startsWith(prefix))?.slice(prefix.length);
}

/** Parse the collector's own --source-* argv. Both or neither, full SHA only
 * — mirrors runWorld.ts so a half or short pin fails closed, never silent. */
export function parseCollectorSourceArgs(argv: string[]): {
  sourceWorktree?: string;
  sourceCommit?: string;
} {
  const sourceWorktree = flagValue(argv, "source-worktree");
  const sourceCommit = flagValue(argv, "source-commit");
  if (sourceWorktree === undefined && sourceCommit === undefined) return {};
  if (!sourceWorktree || !sourceCommit) {
    throw new Error("--source-worktree and --source-commit must both be set (got only one)");
  }
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new Error(
      `--source-commit must be a full 40-hex commit SHA (got ${JSON.stringify(sourceCommit)})`
    );
  }
  return { sourceWorktree, sourceCommit };
}

/** Best-effort full HEAD of the checkout the collector executes from. Null
 * outside a git checkout or on unexpected output — the equality check below
 * treats a missing SHA on a pinned job as fail-closed, never as a pass. */
export function resolveCollectorCommit(cwd: string): string | null {
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
    return /^[0-9a-f]{40}$/.test(head) ? head : null;
  } catch {
    return null;
  }
}

export interface CollectorSourceCheck {
  /** Requested pin (collector argv, else the sandbox run doc). Null when unpinned. */
  requestedCommit?: string | null;
  /** SHA runWorld stamped into the sandbox simRuns doc. */
  simExecutedCommit?: string | null;
  /** SHA of the checkout this collector executes from. */
  collectorCommit?: string | null;
}

/**
 * Require simulation and collector SHAs to both equal the requested pin.
 * Unpinned collection (no request) passes through: legacy jobs have nothing
 * to prove. Every pinned mismatch throws — the collector exits nonzero and
 * writes no report, so a stale checkout can never silently attribute. Returns
 * the proven collector SHA for stamping into the control-plane report.
 */
export function assertCollectorSourceMatch(check: CollectorSourceCheck): {
  collectorCommit: string | null;
} {
  const { requestedCommit, simExecutedCommit, collectorCommit } = check;
  if (!requestedCommit) return { collectorCommit: collectorCommit ?? null };
  if (!collectorCommit) {
    throw new Error(
      `Pinned collector has no git HEAD to prove (requested ${requestedCommit}) - refusing to collect`
    );
  }
  if (collectorCommit !== requestedCommit) {
    throw new Error(
      `Collector source mismatch: requested ${requestedCommit} but collecting from ${collectorCommit} - refusing to collect`
    );
  }
  if (!simExecutedCommit) {
    throw new Error(
      `Simulation source unproven for requested ${requestedCommit} - refusing to attribute`
    );
  }
  if (simExecutedCommit !== requestedCommit) {
    throw new Error(
      `Simulation source mismatch: requested ${requestedCommit} but world ran ${simExecutedCommit} - refusing to attribute`
    );
  }
  return { collectorCommit };
}

/** Attach the actor-coverage section (#1993, branch-only on #2040) to an
 * experiment report. A run with no stamped manifest reads UNKNOWN, never
 * silently drops the section; unrelated report fields pass through untouched
 * so branch-specific evidence survives collection. */
export function attachActorCoverageSection(
  report: Record<string, unknown>,
  manifest: ActorCoverageManifest | null | undefined
): void {
  const verdict = summarizeActorCoverageForVerdict(manifest ?? null);
  const section = manifest ? buildActorCoverageSection(manifest) : null;
  report.actorCoverage = {
    manifest: manifest ?? null,
    verdict,
    warnings: section?.warnings ?? [],
    lines: section?.lines ?? [verdict.title, verdict.detail],
  };
}
