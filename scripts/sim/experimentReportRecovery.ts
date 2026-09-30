/** Explicit collector-only repair; ordinary pinned collection remains strict. */
export function assertExperimentReportRecovery(input: {
  expectedSimulationCommit: string;
  expectedCollectorCommit: string;
  requestedCommit: string | null;
  simulationCommit: string | null;
  collectorCommit: string | null;
  jobStatus: unknown;
  dirty: boolean;
  sandboxUri: string;
  controlUri: string;
  controlDatabase: string;
  sourceDatabase: string;
  jobDatabase: unknown;
}): void {
  if (
    !/^ahd_sim_[a-zA-Z0-9_-]+$/.test(input.sourceDatabase) ||
    input.jobDatabase !== input.sourceDatabase
  )
    throw new Error("Report recovery database does not match the completed job");
  const sandbox = /^mongodb:\/\/(127\.0\.0\.1|localhost):27018\/?$/;
  if (
    !sandbox.test(input.sandboxUri) ||
    !sandbox.test(input.controlUri) ||
    input.controlDatabase !== "sim_control"
  ) {
    throw new Error("Report recovery requires isolated sandbox and control databases");
  }
  for (const commit of [input.expectedSimulationCommit, input.expectedCollectorCommit]) {
    if (!/^[0-9a-f]{40}$/.test(commit))
      throw new Error("Report recovery requires two full source pins");
  }
  if (input.jobStatus !== "completed" || input.dirty)
    throw new Error("Report recovery requires a completed job and clean collector");
  if (
    input.requestedCommit !== input.expectedSimulationCommit ||
    input.simulationCommit !== input.expectedSimulationCommit ||
    input.collectorCommit !== input.expectedCollectorCommit
  ) {
    throw new Error("Report recovery source pins do not match the retained run and collector");
  }
}
