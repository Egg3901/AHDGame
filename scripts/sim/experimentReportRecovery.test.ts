import { describe, expect, it } from "vitest";
import { assertExperimentReportRecovery } from "./experimentReportRecovery";
const source = "a".repeat(40),
  collector = "b".repeat(40);
const valid = {
  expectedSimulationCommit: source,
  expectedCollectorCommit: collector,
  requestedCommit: source,
  simulationCommit: source,
  collectorCommit: collector,
  jobStatus: "completed",
  dirty: false,
  sandboxUri: "mongodb://127.0.0.1:27018/",
  controlUri: "mongodb://127.0.0.1:27018/",
  controlDatabase: "sim_control",
  sourceDatabase: "ahd_sim_fixture",
  jobDatabase: "ahd_sim_fixture",
};
describe("explicit experiment report recovery", () => {
  it("accepts different proven runtime and collector pins", () =>
    expect(() => assertExperimentReportRecovery(valid)).not.toThrow());
  it.each([
    { jobDatabase: "ahd_sim_other" },
    { expectedSimulationCommit: "short" },
    { expectedCollectorCommit: "" },
    { requestedCommit: collector },
    { simulationCommit: collector },
    { collectorCommit: source },
    { jobStatus: "running" },
    { dirty: true },
    { controlDatabase: "other" },
    { sandboxUri: "mongodb://localhost:27017/" },
    { controlUri: "mongodb://localhost:27017/" },
  ])("rejects unsafe or unproven recovery %j", (override) =>
    expect(() => assertExperimentReportRecovery({ ...valid, ...override })).toThrow()
  );
});
