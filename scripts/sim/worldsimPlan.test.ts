import { describe, expect, it } from "vitest";
import { makeWorldsimPlan, planRequestSchema } from "./worldsimPlan";
import {
  assertExistingJobCompatible,
  assertPlannerRuntime,
  plannedJobs,
  budgetedJobWindowFilter,
} from "./worldsimPlanQueue";
import { buildRunWorldArgs } from "./simJobArgs";
const request = () =>
  planRequestSchema.parse({
    baseline: { commit: "a".repeat(40), worktree: "control" },
    candidate: { commit: "b".repeat(40), worktree: "candidate" },
    question: "Do account balances remain conserved?",
    preset: "1991",
    seed: "paired-1",
    maxEngineSeconds: 100000,
  });
describe("change-aware worldsim planning", () => {
  it("does not spend world turns on presentation changes", () => {
    const p = makeWorldsimPlan(request(), ["messages/en/actions.json"], "node");
    expect(p.status).toBe("no-worldsim-needed");
    expect(p.arms).toEqual([]);
  });
  it("unknown paths cannot silently select a cheap UI check", () => {
    expect(makeWorldsimPlan(request(), ["src/lib/newRules.ts"], "node").status).toBe("blocked");
  });
  it("explicit semantic intent overrides presentation paths", () => {
    const p = makeWorldsimPlan(
      { ...request(), intent: "rules" },
      ["src/components/Trade.tsx"],
      "node"
    );
    expect(p.status).toBe("blocked");
  });
  it("budgets both arms and includes two occurrences of every declared cycle", () => {
    const p = makeWorldsimPlan(
      { ...request(), minimumTurns: 3, periods: [4, 12] },
      ["src/lib/economy.ts"],
      "node"
    );
    expect(p.turns).toBe(24);
    expect(p.reservedEngineSeconds).toBe((300 + 24 * 700) * 1.5 * 2);
    expect(p.queue).toEqual({ startPolicy: "window", cloneFromLive: false });
  });
  it("refuses an insufficient budget without shortening the question horizon", () => {
    const p = makeWorldsimPlan(
      { ...request(), minimumTurns: 24, maxEngineSeconds: 100 },
      ["src/lib/economy.ts"],
      "node"
    );
    expect(p.status).toBe("blocked");
    expect(p.turns).toBe(24);
  });
  it("performance selects a one-turn smoke and states its narrower proof", () => {
    const p = makeWorldsimPlan(
      { ...request(), intent: "performance" },
      ["src/simulation/phases/corporationTurn.ts"],
      "node"
    );
    expect(p.turns).toBe(1);
    expect(p.status).toBe("ready");
    expect(p.limitations.join(" ")).toContain("not proof of phase equivalence");
  });
  it("reuses only verified accepted evidence with an identical fingerprint and horizon", () => {
    const r = { ...request(), minimumTurns: 4 };
    const paths = ["src/lib/rules.ts"];
    const first = makeWorldsimPlan(r, paths, "node");
    const acceptedEvidence = first.arms.map((a) => ({
      fingerprint: a.fingerprint,
      verdict: "passed" as const,
      completedTurns: 4,
      reportSha256: "c".repeat(64),
      reportPath: "report.json",
    }));
    expect(makeWorldsimPlan({ ...r, acceptedEvidence }, paths, "node").status).toBe("ready");
    expect(makeWorldsimPlan({ ...r, acceptedEvidence }, paths, "node", () => true).status).toBe(
      "reuse"
    );
    expect(makeWorldsimPlan({ ...r, acceptedEvidence }, paths, "new-node", () => true).status).toBe(
      "ready"
    );
    expect(
      makeWorldsimPlan({ ...r, acceptedEvidence, seed: "other" }, paths, "node", () => true).status
    ).toBe("ready");
    expect(
      makeWorldsimPlan({ ...r, acceptedEvidence, minimumTurns: 8 }, paths, "node", () => true)
        .status
    ).toBe("ready");
  });
  it("invalid numbers and unknown configuration cannot silently change execution", () => {
    expect(() => planRequestSchema.parse({ ...request(), maxEngineSeconds: NaN })).toThrow();
    expect(() => planRequestSchema.parse({ ...request(), cloneFromLive: true })).toThrow();
    expect(() => planRequestSchema.parse({ ...request(), periods: [0] })).toThrow();
  });
  it("budgeted protocol maps to full engine and requires a valid cap", () => {
    expect(buildRunWorldArgs({ mode: "full-budgeted-v1", engineBudgetSeconds: 100 })).toContain(
      "--mode=full"
    );
    for (const cap of [undefined, 0, -1, Infinity, 604801]) {
      expect(() =>
        buildRunWorldArgs({ mode: "full-budgeted-v1", engineBudgetSeconds: cap })
      ).toThrow();
    }
  });
});

describe("queue safety", () => {
  it("pins two isolated budgeted arms with stable ids and no live clone", () => {
    const p = makeWorldsimPlan({ ...request(), minimumTurns: 4 }, ["src/lib/economy.ts"], "node");
    const jobs = plannedJobs(p, new Date(0));
    expect(jobs).toHaveLength(2);
    expect(jobs[0].dbName).not.toBe(jobs[1].dbName);
    expect(jobs.map((j) => j._id)).toEqual(plannedJobs(p, new Date(100)).map((j) => j._id));
    for (const j of jobs) {
      expect(j.dbName).toMatch(/^ahd_sim_plan_/);
      expect(j.startPolicy).toBe("window");
      expect(j.cloneFromLive).toBe(false);
      expect(j.mode).toBe("full-budgeted-v1");
      expect(j.engineBudgetSeconds).toBeGreaterThan(0);
      expect(buildRunWorldArgs(j)).toContain("--mode=full");
    }
  });
  it("cannot queue over-budget or unspecified-horizon plans", () => {
    const p = makeWorldsimPlan(request(), ["src/lib/economy.ts"], "node");
    expect(() => plannedJobs(p, new Date())).toThrow();
  });
  it("does not substitute a fresh world for requested aged evidence", () => {
    const p = makeWorldsimPlan(
      { ...request(), state: "aged", minimumTurns: 4 },
      ["src/lib/economy.ts"],
      "node"
    );
    expect(p.status).toBe("blocked");
    expect(p.blockers.join(" ")).toContain("aged-state fixture");
  });
  it("retains the overnight restriction even outside the worker's configured window", () => {
    expect(budgetedJobWindowFilter(new Date("2026-10-08T06:59:00Z"))).toHaveProperty("mode");
    expect(budgetedJobWindowFilter(new Date("2026-10-08T07:00:00Z"))).toEqual({});
    expect(budgetedJobWindowFilter(new Date("2026-10-08T12:00:00Z"))).toHaveProperty("mode");
    expect(budgetedJobWindowFilter(new Date("2026-12-08T08:00:00Z"))).toEqual({});
  });
});

it("an explicit retry reserves a new attempt without overwriting the old sandbox", () => {
  const r = { ...request(), minimumTurns: 4 };
  const first = makeWorldsimPlan(r, ["src/lib/rules.ts"], "node");
  const retry = makeWorldsimPlan({ ...r, attempt: 2 }, ["src/lib/rules.ts"], "node");
  expect(retry.reservedEngineSeconds).toBe(first.reservedEngineSeconds);
  expect(plannedJobs(retry, new Date())[0]._id).not.toBe(plannedJobs(first, new Date())[0]._id);
  expect(plannedJobs(retry, new Date())[0].dbName).not.toBe(
    plannedJobs(first, new Date())[0].dbName
  );
  expect(plannedJobs(retry, new Date())[0].plannerRuntime).toBe("node");
});
it("an explicit horizon is respected even for presentation paths", () => {
  const p = makeWorldsimPlan(
    { ...request(), minimumTurns: 8 },
    ["messages/en/actions.json"],
    "node"
  );
  expect(p.selection).toBe("matched-world");
  expect(p.turns).toBe(8);
});

it("rejects runtime drift and missing budget runtime metadata", () => {
  expect(() => assertPlannerRuntime({ mode: "full-budgeted-v1" }, "node")).toThrow();
  expect(() =>
    assertPlannerRuntime({ mode: "full-budgeted-v1", plannerRuntime: "other" }, "node")
  ).toThrow();
  expect(() =>
    assertPlannerRuntime({ mode: "full-budgeted-v1", plannerRuntime: "node" }, "node")
  ).not.toThrow();
  expect(() => assertPlannerRuntime({ mode: "full" }, "node")).not.toThrow();
});
it("does not silently reuse a queued job with a different cap", () => {
  const p = makeWorldsimPlan({ ...request(), minimumTurns: 4 }, ["src/lib/rules.ts"], "node");
  const job = plannedJobs(p, new Date())[0];
  expect(() => assertExistingJobCompatible(null, job)).not.toThrow();
  expect(() => assertExistingJobCompatible({ ...job, status: "failed" }, job)).not.toThrow();
  expect(() =>
    assertExistingJobCompatible({ ...job, engineBudgetSeconds: job.engineBudgetSeconds + 1 }, job)
  ).toThrow();
});
