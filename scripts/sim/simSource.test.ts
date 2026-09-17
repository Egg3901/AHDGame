import { describe, expect, it } from "vitest";
import {
  assertSimSourceShape,
  planRunWorldSpawn,
  sourceProvenanceFlags,
  verifySimSource,
  type SimSourceDeps,
} from "./simSource";

const ROOT = "/root/projects/AHDGame/worktrees";
const MAIN = "/root/projects/AHDGame";
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function deps(over: Partial<SimSourceDeps> = {}): SimSourceDeps {
  return {
    realpath: (p) => p,
    isDirectory: () => true,
    gitHead: () => SHA_A,
    gitPorcelain: () => "",
    ...over,
  };
}

const OPTS = { root: ROOT, main: MAIN };

describe("sim pinned source validation", () => {
  it("returns null when unpinned (legacy default-repo path)", () => {
    expect(verifySimSource({}, deps(), OPTS)).toBeNull();
    expect(
      verifySimSource({ sourceWorktree: undefined, sourceCommit: undefined }, deps(), OPTS)
    ).toBeNull();
  });

  it("verifies a clean registered worktree at the requested SHA", () => {
    expect(
      verifySimSource({ sourceWorktree: "muse-992", sourceCommit: SHA_A }, deps(), OPTS)
    ).toEqual({ repoDir: `${ROOT}/muse-992`, worktree: "muse-992", commit: SHA_A });
  });

  it("accepts a canonical absolute path under the root", () => {
    expect(
      verifySimSource({ sourceWorktree: `${ROOT}/muse-992`, sourceCommit: SHA_A }, deps(), OPTS)
    ).toEqual({ repoDir: `${ROOT}/muse-992`, worktree: "muse-992", commit: SHA_A });
  });

  it("rejects a half pin (only one of worktree/commit)", () => {
    expect(() => verifySimSource({ sourceWorktree: "muse-992" }, deps(), OPTS)).toThrow(
      "must both be set"
    );
    expect(() => verifySimSource({ sourceCommit: SHA_A }, deps(), OPTS)).toThrow(
      "must both be set"
    );
  });

  it("rejects non-commit refs and short SHAs", () => {
    for (const bad of [
      "HEAD",
      "main",
      "development",
      "v1.2.3",
      SHA_A.slice(0, 7),
      SHA_A.toUpperCase(),
    ]) {
      expect(
        () => verifySimSource({ sourceWorktree: "muse-992", sourceCommit: bad }, deps(), OPTS),
        bad
      ).toThrow("full 40-hex");
    }
    // Empty pin half fails closed as unset, not as a SHA.
    expect(() =>
      verifySimSource({ sourceWorktree: "muse-992", sourceCommit: "" }, deps(), OPTS)
    ).toThrow("must both be set");
  });

  it("rejects path traversal and escapes", () => {
    for (const bad of ["../main", "..", "a/b", "muse-992/../../etc", "./muse-992"]) {
      expect(
        () => verifySimSource({ sourceWorktree: bad, sourceCommit: SHA_A }, deps(), OPTS),
        bad
      ).toThrow();
    }
    expect(() =>
      verifySimSource({ sourceWorktree: "/etc/passwd", sourceCommit: SHA_A }, deps(), OPTS)
    ).toThrow("must live under");
    expect(() =>
      verifySimSource({ sourceWorktree: `${ROOT}/a/b`, sourceCommit: SHA_A }, deps(), OPTS)
    ).toThrow("single registered worktree");
    expect(() =>
      verifySimSource({ sourceWorktree: `${ROOT}/../main`, sourceCommit: SHA_A }, deps(), OPTS)
    ).toThrow();
  });

  it("rejects a missing or unregistered worktree", () => {
    const missing = deps({
      realpath: () => {
        throw new Error("ENOENT");
      },
    });
    expect(() =>
      verifySimSource({ sourceWorktree: "nope", sourceCommit: SHA_A }, missing, OPTS)
    ).toThrow("not a registered worktree");
  });

  it("rejects symlink escapes", () => {
    const linked = deps({ realpath: () => "/tmp/evil" });
    expect(() =>
      verifySimSource({ sourceWorktree: "muse-992", sourceCommit: SHA_A }, linked, OPTS)
    ).toThrow("symlink escape");
  });

  it("rejects the main checkout by name and via symlink", () => {
    expect(() =>
      verifySimSource({ sourceWorktree: MAIN, sourceCommit: SHA_A }, deps(), OPTS)
    ).toThrow("must not be the main checkout");
    const mainLink = deps({ realpath: (p) => (p === MAIN ? `${ROOT}/muse-992` : p) });
    expect(() =>
      verifySimSource({ sourceWorktree: "muse-992", sourceCommit: SHA_A }, mainLink, OPTS)
    ).toThrow("must not be the main checkout");
  });

  it("rejects a non-directory worktree path", () => {
    const file = deps({ isDirectory: () => false });
    expect(() =>
      verifySimSource({ sourceWorktree: "muse-992", sourceCommit: SHA_A }, file, OPTS)
    ).toThrow("not a directory");
  });

  it("rejects HEAD mismatch (stale pin and moving HEAD)", () => {
    const stale = deps({ gitHead: () => SHA_B });
    expect(() =>
      verifySimSource({ sourceWorktree: "muse-992", sourceCommit: SHA_A }, stale, OPTS)
    ).toThrow("mismatch");
    // Moving HEAD between validation and pre-spawn check fails the second call.
    let head = SHA_A;
    const moving = deps({ gitHead: () => head });
    const req = { sourceWorktree: "muse-992", sourceCommit: SHA_A };
    expect(verifySimSource(req, moving, OPTS)?.commit).toBe(SHA_A);
    head = SHA_B;
    expect(() => verifySimSource(req, moving, OPTS)).toThrow("mismatch");
  });

  it("rejects a dirty worktree", () => {
    const dirty = deps({ gitPorcelain: () => " M src/lib/sim/x.ts\n" });
    expect(() =>
      verifySimSource({ sourceWorktree: "muse-992", sourceCommit: SHA_A }, dirty, OPTS)
    ).toThrow("dirty");
  });

  it("rejects a non-SHA HEAD", () => {
    const weird = deps({ gitHead: () => "HEAD" });
    expect(() =>
      verifySimSource({ sourceWorktree: "muse-992", sourceCommit: SHA_A }, weird, OPTS)
    ).toThrow("not a full commit SHA");
  });
});

describe("sim source shape check (enqueue time)", () => {
  it("passes empty and valid pins", () => {
    expect(() => assertSimSourceShape({})).not.toThrow();
    expect(() =>
      assertSimSourceShape({ sourceWorktree: "muse-992", sourceCommit: SHA_A })
    ).not.toThrow();
  });

  it("rejects half pins, bad SHAs, and bad names", () => {
    expect(() => assertSimSourceShape({ sourceWorktree: "muse-992" })).toThrow("both be set");
    expect(() => assertSimSourceShape({ sourceCommit: SHA_A })).toThrow("both be set");
    expect(() =>
      assertSimSourceShape({ sourceWorktree: "muse-992", sourceCommit: "HEAD" })
    ).toThrow("full 40-hex");
    expect(() => assertSimSourceShape({ sourceWorktree: "../x", sourceCommit: SHA_A })).toThrow();
  });
});

describe("sim spawn planning", () => {
  it("emits no provenance flags when unpinned and keeps the default cwd", () => {
    expect(sourceProvenanceFlags(null)).toEqual([]);
    const plan = planRunWorldSpawn({ mode: "full" }, ["--seed=x"], "/default/repo", null);
    expect(plan.cwd).toBe("/default/repo");
    expect(plan.args).toContain("--mode=full");
    expect(plan.args.some((a) => a.startsWith("--source-"))).toBe(false);
  });

  it("pins cwd to the verified worktree and carries provenance flags", () => {
    const verified = { repoDir: `${ROOT}/muse-992`, worktree: "muse-992", commit: SHA_A };
    expect(sourceProvenanceFlags(verified)).toEqual([
      "--source-worktree=muse-992",
      `--source-commit=${SHA_A}`,
    ]);
    const plan = planRunWorldSpawn({ mode: "full" }, ["--seed=x"], "/default/repo", verified);
    expect(plan.cwd).toBe(`${ROOT}/muse-992`);
    expect(plan.args).toContain("--mode=full");
    expect(plan.args).toContain("--source-worktree=muse-992");
    expect(plan.args).toContain(`--source-commit=${SHA_A}`);
  });
});
