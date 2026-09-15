import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildDifferentialTrace,
  normalizeMongoObservation,
  type PhaseCapture,
} from "./differentialTraceExport";

const execFileAsync = promisify(execFile);

describe("authoritative differential trace export", () => {
  it("normalizes generated ids and timestamps while preserving ordered mutations", () => {
    const before = normalizeMongoObservation({
      resources: [{ _id: { $oid: "65aaaaaaaaaaaaaaaaaaaaaa" }, actions: 3 }],
      elections: [],
      budgets: { updatedAt: { $date: "1953-01-01T00:00:00.000Z" }, balance: 8 },
      policies: [],
      playerConsequences: [],
    });
    const captures: PhaseCapture[] = [
      {
        name: "actionRefresh",
        observations: normalizeMongoObservation({
          resources: [{ _id: { $oid: "65aaaaaaaaaaaaaaaaaaaaaa" }, actions: 4 }],
          elections: [],
          budgets: { updatedAt: { $date: "1953-01-02T00:00:00.000Z" }, balance: 8 },
          policies: [],
          playerConsequences: [],
        }),
      },
    ];

    const trace = buildDifferentialTrace({
      revision: "a".repeat(40),
      fixtureId: "1953-US-turn-2",
      era: "1953",
      countryId: "US",
      seed: "fixture-seed",
      sourceSha256: "b".repeat(64),
      initial: before,
      captures,
    });

    expect(trace.phases[0]).toMatchObject({
      index: 0,
      name: "actionRefresh",
      rng: {
        before: { status: "unobservable-fail-closed" },
        after: { status: "unobservable-fail-closed" },
        draws: [],
      },
      observations: {
        resources: { mutations: [{ path: "0.actions", before: 3, after: 4 }] },
        budgets: { mutations: [] },
      },
    });
  });

  it("fails before database access unless the CLI targets an isolated sim database", async () => {
    await expect(
      execFileAsync(
        "npx",
        ["tsx", "scripts/sim/exportDifferentialTrace.ts", "--db", "production"],
        { cwd: process.cwd() }
      )
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("isolated ahd_sim_* sandbox database"),
    });
  });
});
