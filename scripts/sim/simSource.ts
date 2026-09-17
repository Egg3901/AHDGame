/**
 * Pinned sim source binding (issue #1966).
 *
 * Lets a queued sandbox job name the EXACT registered worktree + commit it
 * must execute, so an unmerged balance branch can produce machine-verifiable
 * pre-merge evidence. The worker runs runWorld from that path with an
 * explicit cwd and never changes git state.
 *
 * Safety contract (fail closed, no mutation):
 * - Only a canonical registered AHDGame worktree beneath the sanctioned
 *   worktree root. Leaf names match the job SAFE_TOKEN shape; absolute paths
 *   are canonicalized and must resolve to exactly <root>/<leaf>.
 * - Symlinks rejected via realpath equality. Main checkout rejected.
 * - Requested commit must be a full 40-hex SHA and must equal the worktree
 *   HEAD, checked at validation AND again immediately before spawn (a moving
 *   HEAD between the two checks fails the job).
 * - Worktree must be clean (empty `git status --porcelain`).
 * - Read-only git only: `rev-parse HEAD` + `status --porcelain`. No fetch,
 *   checkout, reset, or any other mutation, ever.
 * - No arbitrary command or path fields: the job carries only
 *   sourceWorktree + sourceCommit, both tightly validated.
 *
 * Sandbox Mongo isolation, the claim window, and capacity admission are
 * untouched by this module.
 */

import { execFileSync } from "child_process";
import { realpathSync, statSync } from "fs";
import { posix } from "path";
import { buildRunWorldArgs, type SimJobExperimentFields } from "./simJobArgs";

export const SIM_WORKTREE_ROOT = "/root/projects/AHDGame/worktrees";
export const SIM_MAIN_CHECKOUT = "/root/projects/AHDGame";

/** Full commit SHA only. Short SHAs, branch names, tags, and HEAD all fail. */
const FULL_SHA = /^[0-9a-f]{40}$/;
/** Same token shape as every other job-derived value (see simJobArgs.ts). */
const SAFE_TOKEN = /^[a-zA-Z0-9_-]{1,64}$/;

export interface SimSourceRequest {
  sourceWorktree?: string;
  sourceCommit?: string;
}

/** Injected filesystem/git access so every path is unit-testable. */
export interface SimSourceDeps {
  /** Canonical path (resolves symlinks). Throws when the path is missing. */
  realpath: (p: string) => string;
  /** True when the path exists and is a directory. */
  isDirectory: (p: string) => boolean;
  /** Trimmed `git rev-parse HEAD` inside the directory. */
  gitHead: (repoDir: string) => string;
  /** Raw `git status --porcelain` inside the directory. */
  gitPorcelain: (repoDir: string) => string;
}

/** Live filesystem/git access for the worker. Read-only git (rev-parse +
 * status) - never fetch, checkout, reset, or otherwise mutate the tree. */
export function defaultSimSourceDeps(): SimSourceDeps {
  return {
    realpath: (p) => realpathSync(p),
    isDirectory: (p) => {
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    },
    gitHead: (repoDir) =>
      execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf8" }).trim(),
    gitPorcelain: (repoDir) =>
      execFileSync("git", ["status", "--porcelain"], { cwd: repoDir, encoding: "utf8" }),
  };
}

export interface VerifiedSimSource {
  /** Canonical repo dir to spawn runWorld with as cwd. */
  repoDir: string;
  /** Registered worktree leaf name. */
  worktree: string;
  /** Verified full commit SHA (== worktree HEAD). */
  commit: string;
}

/** Shape-only check for enqueue time (MCP). Existence/HEAD/cleanliness are
 * the worker's job at claim and pre-spawn time, when the tree can be seen. */
export function assertSimSourceShape(req: SimSourceRequest): void {
  const { sourceWorktree, sourceCommit } = req;
  if (sourceWorktree === undefined && sourceCommit === undefined) return;
  if (!sourceWorktree || !sourceCommit) {
    throw new Error("sourceWorktree and sourceCommit must both be set (got only one)");
  }
  assertLeafOrRootedPath(sourceWorktree);
  if (!FULL_SHA.test(sourceCommit)) {
    throw new Error(
      `sourceCommit must be a full 40-hex commit SHA (got ${JSON.stringify(sourceCommit)})`
    );
  }
}

function assertLeafOrRootedPath(value: string): string {
  if (value.includes("/")) {
    if (!value.startsWith("/")) {
      throw new Error(
        `sourceWorktree must be a worktree name or absolute path (got ${JSON.stringify(value)})`
      );
    }
    const normalized = posix.normalize(value);
    const prefix = `${SIM_WORKTREE_ROOT}/`;
    if (!normalized.startsWith(prefix)) {
      throw new Error(
        `sourceWorktree must live under ${SIM_WORKTREE_ROOT} (got ${JSON.stringify(value)})`
      );
    }
    const leaf = normalized.slice(prefix.length);
    if (!SAFE_TOKEN.test(leaf)) {
      throw new Error(
        `sourceWorktree must be a single registered worktree directly under ${SIM_WORKTREE_ROOT} (got ${JSON.stringify(value)})`
      );
    }
    return leaf;
  }
  if (!SAFE_TOKEN.test(value)) {
    throw new Error(`sourceWorktree must match ${SAFE_TOKEN} (got ${JSON.stringify(value)})`);
  }
  return value;
}

/**
 * Verify a pinned source against the live filesystem. Returns null when the
 * job carries no pin (legacy default-repo behavior, unchanged). Throws on
 * every invalid pin: fail closed, the worker marks the job failed.
 */
export function verifySimSource(
  req: SimSourceRequest,
  deps: SimSourceDeps,
  opts?: { root?: string; main?: string }
): VerifiedSimSource | null {
  const { sourceWorktree, sourceCommit } = req;
  if (sourceWorktree === undefined && sourceCommit === undefined) return null;
  if (!sourceWorktree || !sourceCommit) {
    throw new Error("sourceWorktree and sourceCommit must both be set (got only one)");
  }
  if (!FULL_SHA.test(sourceCommit)) {
    throw new Error(
      `sourceCommit must be a full 40-hex commit SHA (got ${JSON.stringify(sourceCommit)})`
    );
  }
  const root = opts?.root ?? SIM_WORKTREE_ROOT;
  const main = opts?.main ?? SIM_MAIN_CHECKOUT;
  if (sourceWorktree.startsWith("/") && posix.normalize(sourceWorktree) === posix.normalize(main)) {
    throw new Error("sourceWorktree must not be the main checkout");
  }
  const leaf = assertLeafOrRootedPath(sourceWorktree);
  const candidate = posix.join(root, leaf);

  let resolved: string;
  try {
    resolved = deps.realpath(candidate);
  } catch {
    throw new Error(`sourceWorktree "${leaf}" is not a registered worktree under ${root}`);
  }
  if (resolved !== candidate) {
    throw new Error(
      `sourceWorktree "${leaf}" resolves outside its registered path (symlink escape refused)`
    );
  }
  if (!deps.isDirectory(candidate)) {
    throw new Error(`sourceWorktree "${leaf}" is not a directory`);
  }
  let mainResolved: string | null = null;
  try {
    mainResolved = deps.realpath(main);
  } catch {
    mainResolved = null;
  }
  if (candidate === main || (mainResolved !== null && resolved === mainResolved)) {
    throw new Error("sourceWorktree must not be the main checkout");
  }

  const head = deps.gitHead(candidate).trim();
  if (!FULL_SHA.test(head)) {
    throw new Error(
      `sourceWorktree "${leaf}" HEAD is not a full commit SHA (got ${JSON.stringify(head)})`
    );
  }
  if (head !== sourceCommit) {
    throw new Error(
      `sourceCommit mismatch for worktree "${leaf}": requested ${sourceCommit} but HEAD is ${head}`
    );
  }
  const porcelain = deps.gitPorcelain(candidate);
  if (porcelain.trim().length > 0) {
    throw new Error(`sourceWorktree "${leaf}" is dirty - refusing to run on uncommitted state`);
  }
  return { repoDir: candidate, worktree: leaf, commit: sourceCommit };
}

/** Provenance flags the worker passes to runWorld so the child can re-check
 * HEAD itself and stamp executed identity into simRuns. Empty when unpinned. */
export function sourceProvenanceFlags(verified: VerifiedSimSource | null): string[] {
  if (!verified) return [];
  return [`--source-worktree=${verified.worktree}`, `--source-commit=${verified.commit}`];
}

export interface RunWorldSpawnPlan {
  /** Explicit cwd for the runWorld child process. */
  cwd: string;
  /** Full argv: caller base args + experiment args + source provenance flags. */
  args: string[];
}

/** Pure spawn planner: pins cwd to the verified worktree, falls back to the
 * worker default repo otherwise. Unit-tested; worker.ts stays the only
 * production caller and never mutates git state. */
export function planRunWorldSpawn(
  job: SimJobExperimentFields,
  baseArgs: string[],
  defaultRepoDir: string,
  verified: VerifiedSimSource | null
): RunWorldSpawnPlan {
  return {
    cwd: verified?.repoDir ?? defaultRepoDir,
    args: [...baseArgs, ...buildRunWorldArgs(job), ...sourceProvenanceFlags(verified)],
  };
}
