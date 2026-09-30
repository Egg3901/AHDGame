import { describe, expect, it } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  assertExperimentReportRecovery,
  commitExperimentReportRecovery,
} from "./experimentReportRecovery";
const source = "a".repeat(40),
  collector = "b".repeat(40);
const valid = {
  expectedSimulationCommit: source,
  expectedCollectorCommit: collector,
  requestedCommit: source,
  simulationCommit: source,
  collectorCommit: collector,
  jobStatus: "completed",
  jobSourceCommit: source,
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
    { jobSourceCommit: collector },
    { jobSourceCommit: undefined },
    { dirty: true },
    { controlDatabase: "other" },
    { sandboxUri: "mongodb://localhost:27017/" },
    { controlUri: "mongodb://localhost:27017/" },
  ])("rejects unsafe or unproven recovery %j", (override) =>
    expect(() => assertExperimentReportRecovery({ ...valid, ...override })).toThrow()
  );
});

describe("recovery completion compare-and-set", () => {
  it.each([0, 1])(
    "reports completion only for exactly one matched job (%s)",
    async (matchedCount) => {
      const db = createMockDb();
      db.collection("simJobs").updateOne.mockResolvedValue({ matchedCount });
      const promise = commitExperimentReportRecovery(db as never, {
        runId: "run",
        sourceDatabase: valid.sourceDatabase,
        simulationCommit: source,
        collectorCommit: collector,
      });
      if (matchedCount === 1) await expect(promise).resolves.toBeUndefined();
      else
        await expect(promise).rejects.toThrow("Report persisted but recovery marker not committed");
      expect(db.collection("simJobs").updateOne).toHaveBeenCalledWith(
        { _id: "run", status: "completed", sourceCommit: source, dbName: valid.sourceDatabase },
        expect.objectContaining({ $unset: { experimentsReportError: "" } })
      );
    }
  );
});
