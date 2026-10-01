import { describe, expect, it } from "vitest";
import {
  assertEvidenceExtractorSource,
  assertFreshPinnedFundRun,
  type FundRunJob,
  type FundSimRun,
} from "./fundRoundTripProvenance";

const SOURCE = "a".repeat(40);
const DB = "ahd_sim_test_2120";

function fixture(): { job: FundRunJob; run: FundSimRun } {
  return {
    job: {
      status: "completed",
      dbName: DB,
      seed: "test_2120",
      preset: "2019-default",
      turns: 73,
      currentTurn: 74,
      sourceWorktree: "issue-2120-qualification",
      sourceCommit: SOURCE,
      sourceCommitVerified: SOURCE,
      metricsSource: {
        worktree: "issue-2120-qualification",
        requestedCommit: SOURCE,
        simExecutedCommit: SOURCE,
        collectorCommit: SOURCE,
      },
    },
    run: {
      status: "completed",
      dbName: DB,
      seed: "test_2120",
      preset: "2019-default",
      currentTurn: 74,
      bootstrapConformance: { status: "reported", reportId: "fresh-seed-report" },
      effectiveConfigInitial: {
        capturedAtTurn: 1,
        gameState: { currentTurn: 1, preset: "2019-default" },
      },
      source: {
        worktree: "issue-2120-qualification",
        requestedCommit: SOURCE,
        executedCommit: SOURCE,
      },
    },
  };
}

describe("#2120 fresh sandbox provenance", () => {
  it("pins a separate evidence extractor and rejects dirty or mismatched code", () => {
    const extractor = "b".repeat(40);
    expect(() => assertEvidenceExtractorSource(extractor, extractor, "")).not.toThrow();
    expect(() => assertEvidenceExtractorSource(extractor, SOURCE, "")).toThrow();
    expect(() => assertEvidenceExtractorSource(extractor, extractor, " M collector.ts")).toThrow();
  });

  it("accepts the preset's turn-one baseline after exactly 73 advanced turns", () => {
    const { job, run } = fixture();
    expect(() => assertFreshPinnedFundRun(job, run, 1, DB, SOURCE)).not.toThrow();
  });

  it("rejects a resumed world that started at turn ten", () => {
    const { job, run } = fixture();
    run.effectiveConfigInitial = {
      capturedAtTurn: 10,
      gameState: { currentTurn: 10, preset: "2019-default" },
    };
    run.currentTurn = 83;
    job.currentTurn = 83;
    expect(() => assertFreshPinnedFundRun(job, run, 1, DB, SOURCE)).toThrow(/Fresh completed/);
  });

  it("rejects missing fresh-bootstrap evidence, extra runs, or wrong turn advance", () => {
    const { job, run } = fixture();
    expect(() => assertFreshPinnedFundRun(job, run, 2, DB, SOURCE)).toThrow();
    run.bootstrapConformance = undefined;
    expect(() => assertFreshPinnedFundRun(job, run, 1, DB, SOURCE)).toThrow();
    run.bootstrapConformance = { status: "reported", reportId: "fresh-seed-report" };
    job.currentTurn = 75;
    expect(() => assertFreshPinnedFundRun(job, run, 1, DB, SOURCE)).toThrow();
  });

  it("rejects a source or metrics collector mismatch", () => {
    const { job, run } = fixture();
    run.source!.executedCommit = "b".repeat(40);
    expect(() => assertFreshPinnedFundRun(job, run, 1, DB, SOURCE)).toThrow();
    run.source!.executedCommit = SOURCE;
    job.metricsSource!.collectorCommit = "b".repeat(40);
    expect(() => assertFreshPinnedFundRun(job, run, 1, DB, SOURCE)).toThrow();
  });
});
