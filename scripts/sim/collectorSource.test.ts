import { describe, expect, it } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  COLLECTOR_SCRIPTS,
  assertCollectorSourceMatch,
  attachActorCoverageSection,
  parseCollectorSourceArgs,
  planCollectorSpawns,
  resolveCollectorCommit,
} from "./collectorSource";
import { evaluateActorCoverage } from "@/lib/sim/actorCoverage";
import { snapshotActorPopulation } from "@/lib/sim/syntheticActors";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const PINNED_DIR = "/root/projects/AHDGame/worktrees/branch-2040";
const DEFAULT_REPO = "/opt/shared-runtime-checkout";

function branchFixtureManifest() {
  // The #2040 branch-only evidence: an actor-coverage manifest the shared
  // runtime collector has no handling for. Built through the production
  // evaluators so the fixture tracks the real manifest shape.
  return evaluateActorCoverage(
    snapshotActorPopulation({
      mode: "pure-npp",
      preset: "1953-default",
      characters: 0,
      users: 0,
      syntheticCharacters: 0,
      syntheticUsers: 0,
    }),
    "1953-01-01T00:00:00.000Z"
  );
}

describe("worker collector spawn planning (#2083)", () => {
  it("covers every post-run collector in run order", () => {
    expect(COLLECTOR_SCRIPTS).toEqual([
      "scripts/sim/collectMetrics.ts",
      "scripts/sim/collectExperimentReport.ts",
      "scripts/sim/collectElectionReport.ts",
    ]);
    const plans = planCollectorSpawns({ dbName: "ahd_sim_x", runId: "job1" }, DEFAULT_REPO, null);
    expect(plans.map((p) => p.script)).toEqual([...COLLECTOR_SCRIPTS]);
  });

  it("keeps the shared checkout cwd when unpinned (legacy behavior)", () => {
    for (const plan of planCollectorSpawns(
      { dbName: "ahd_sim_x", runId: "job1" },
      DEFAULT_REPO,
      null
    )) {
      expect(plan.cwd).toBe(DEFAULT_REPO);
      expect(plan.args.some((a) => a.startsWith("--source-"))).toBe(false);
      expect(plan.args).toContain("--db=ahd_sim_x");
      expect(plan.args).toContain("--run-id=job1");
    }
  });

  it("gives every collector the pinned cwd plus provenance flags", () => {
    const verified = { repoDir: PINNED_DIR, worktree: "branch-2040", commit: SHA_A };
    const plans = planCollectorSpawns(
      { dbName: "ahd_sim_x", runId: "job1" },
      DEFAULT_REPO,
      verified
    );
    expect(plans).toHaveLength(3);
    for (const plan of plans) {
      expect(plan.cwd).toBe(PINNED_DIR);
      expect(plan.args).toContain("--source-worktree=branch-2040");
      expect(plan.args).toContain(`--source-commit=${SHA_A}`);
    }
  });
});

describe("collector source args", () => {
  it("passes unpinned invocations through with no pin", () => {
    expect(parseCollectorSourceArgs(["--db=x", "--run-id=y"])).toEqual({});
  });

  it("rejects a half pin", () => {
    expect(() => parseCollectorSourceArgs([`--source-worktree=w`])).toThrow("both be set");
    expect(() => parseCollectorSourceArgs([`--source-commit=${SHA_A}`])).toThrow("both be set");
  });

  it("rejects a non-SHA commit", () => {
    expect(() => parseCollectorSourceArgs(["--source-worktree=w", "--source-commit=HEAD"])).toThrow(
      "full 40-hex"
    );
  });

  it("parses a valid pin", () => {
    expect(parseCollectorSourceArgs(["--source-worktree=w", `--source-commit=${SHA_A}`])).toEqual({
      sourceWorktree: "w",
      sourceCommit: SHA_A,
    });
  });
});

describe("collector source equality (#2083)", () => {
  it("passes unpinned collection through (legacy, nothing to prove)", () => {
    expect(
      assertCollectorSourceMatch({
        requestedCommit: null,
        simExecutedCommit: null,
        collectorCommit: null,
      })
    ).toEqual({ collectorCommit: null });
  });

  it("passes when simulation and collector SHAs both equal the request", () => {
    expect(
      assertCollectorSourceMatch({
        requestedCommit: SHA_A,
        simExecutedCommit: SHA_A,
        collectorCommit: SHA_A,
      })
    ).toEqual({ collectorCommit: SHA_A });
  });

  it("fails closed when the collector runs different code than the simulation", () => {
    expect(() =>
      assertCollectorSourceMatch({
        requestedCommit: SHA_A,
        simExecutedCommit: SHA_A,
        collectorCommit: SHA_B,
      })
    ).toThrow("mismatch");
  });

  it("fails closed when the simulation ran different code than requested", () => {
    expect(() =>
      assertCollectorSourceMatch({
        requestedCommit: SHA_A,
        simExecutedCommit: SHA_B,
        collectorCommit: SHA_A,
      })
    ).toThrow("mismatch");
  });

  it("fails closed when either SHA is missing on a pinned job", () => {
    expect(() =>
      assertCollectorSourceMatch({
        requestedCommit: SHA_A,
        simExecutedCommit: SHA_A,
        collectorCommit: null,
      })
    ).toThrow();
    expect(() =>
      assertCollectorSourceMatch({
        requestedCommit: SHA_A,
        simExecutedCommit: null,
        collectorCommit: SHA_A,
      })
    ).toThrow();
  });
});

describe("collector git HEAD resolution", () => {
  it("returns null outside a git checkout (fail-closed input, never throws)", () => {
    const empty = mkdtempSync(join(tmpdir(), "collector-source-"));
    expect(resolveCollectorCommit(empty)).toBeNull();
  });

  it("resolves a full SHA inside this checkout", () => {
    expect(resolveCollectorCommit(process.cwd())).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("branch-only report fields survive collection (#2083)", () => {
  it("attaches the actor-coverage section from a pinned-branch manifest", () => {
    const report: Record<string, unknown> = { turn: 7 };
    attachActorCoverageSection(report, branchFixtureManifest());
    const section = report.actorCoverage as {
      manifest: unknown;
      verdict: { status: string; title: string };
      warnings: string[];
      lines: string[];
    };
    expect(section.manifest).not.toBeNull();
    expect(section.verdict.status).toBe("warn");
    expect(section.warnings).toHaveLength(12);
    expect(section.lines[0]).toContain("0/12 mechanics covered");
    expect(report.turn).toBe(7);
  });

  it("keeps the section (UNKNOWN verdict) when the run predates stamping", () => {
    const report: Record<string, unknown> = {};
    attachActorCoverageSection(report, null);
    const section = report.actorCoverage as { manifest: null; warnings: string[]; lines: string[] };
    expect(section.manifest).toBeNull();
    expect(section.lines.join("\n")).toContain("unknown");
  });

  it("leaves unrelated branch-only report fields untouched", () => {
    const report: Record<string, unknown> = {
      branchOnlyProbe: { marker: "branch-2040", values: [1, 2, 3] },
    };
    attachActorCoverageSection(report, branchFixtureManifest());
    expect(report.branchOnlyProbe).toEqual({ marker: "branch-2040", values: [1, 2, 3] });
    expect(report.actorCoverage).toBeDefined();
  });
});
