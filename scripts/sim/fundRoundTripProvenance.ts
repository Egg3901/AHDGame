/** Provenance for a fresh, source-pinned #2120 worldsim run. */
export type FundRunJob = {
  status?: string;
  dbName?: string;
  seed?: string;
  preset?: string;
  turns?: number;
  currentTurn?: number;
  sourceWorktree?: string;
  sourceCommit?: string;
  sourceCommitVerified?: string;
  metricsSource?: {
    worktree?: string;
    requestedCommit?: string;
    simExecutedCommit?: string;
    collectorCommit?: string;
  };
};

export type FundSimRun = {
  status?: string;
  dbName?: string;
  seed?: string;
  preset?: string;
  currentTurn?: number;
  bootstrapConformance?: { status?: string; reportId?: unknown };
  effectiveConfigInitial?: {
    capturedAtTurn?: number;
    gameState?: { currentTurn?: number; preset?: string };
  };
  source?: { worktree?: string; requestedCommit?: string; executedCommit?: string };
};

/** The extractor pin is independent of the source that ran the simulation. */
export function assertEvidenceExtractorSource(
  requestedCommit: string | undefined,
  executedCommit: string | null,
  dirtyStatus: string
): asserts requestedCommit is string {
  if (
    !requestedCommit ||
    !/^[0-9a-f]{40}$/.test(requestedCommit) ||
    executedCommit !== requestedCommit ||
    dirtyStatus.trim() !== ""
  ) {
    throw new Error("Evidence extractor checkout is not clean at its requested source pin");
  }
}

/**
 * A fresh preset bootstrap starts at turn one. A resumed world that already
 * advanced turns has a later initial snapshot or finishes later than the
 * requested turn count. The bootstrap conformance report is stamped only by
 * runWorld's fresh-bootstrap branch.
 */
export function assertFreshPinnedFundRun(
  job: FundRunJob | null,
  run: FundSimRun | null,
  runCount: number,
  dbName: string,
  requestedCommit: string
): asserts job is FundRunJob {
  const baseline = run?.effectiveConfigInitial?.capturedAtTurn;
  if (
    !job ||
    !run ||
    !/^[0-9a-f]{40}$/.test(requestedCommit) ||
    job.status !== "completed" ||
    run.status !== "completed" ||
    job.dbName !== dbName ||
    run.dbName !== dbName ||
    job.dbName !== `ahd_sim_${job.seed}` ||
    run.seed !== job.seed ||
    job.preset !== "2019-default" ||
    run.preset !== job.preset ||
    runCount !== 1 ||
    baseline !== 1 ||
    run.effectiveConfigInitial?.gameState?.currentTurn !== baseline ||
    run.effectiveConfigInitial?.gameState?.preset !== job.preset ||
    run.bootstrapConformance?.status !== "reported" ||
    !run.bootstrapConformance.reportId ||
    !Number.isInteger(job.turns) ||
    (job.turns ?? 0) <= 0 ||
    job.currentTurn !== baseline + job.turns ||
    run.currentTurn !== baseline + job.turns ||
    !job.sourceWorktree ||
    run.source?.worktree !== job.sourceWorktree ||
    job.metricsSource?.worktree !== job.sourceWorktree ||
    job.sourceCommit !== requestedCommit ||
    job.sourceCommitVerified !== requestedCommit ||
    run.source?.requestedCommit !== requestedCommit ||
    run.source?.executedCommit !== requestedCommit ||
    job.metricsSource?.requestedCommit !== requestedCommit ||
    job.metricsSource?.simExecutedCommit !== requestedCommit ||
    job.metricsSource?.collectorCommit !== requestedCommit
  ) {
    throw new Error(
      "Fresh completed job, preset baseline, turn count, or source provenance does not match"
    );
  }
}
