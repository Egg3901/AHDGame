import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { closeResetRunLog, createResetRunRecord, openResetRunLog } from "./resetRunRecord";

describe("resetRunRecord", () => {
  it("passes a successful step's value through and records nothing", async () => {
    const run = createResetRunRecord();
    const value = await run.step("build", "seedUnions", async () => 42);
    expect(value).toBe(42);
    expect(run.failures).toEqual([]);
  });

  it("contains a throwing step: returns null, records it, does not rethrow", async () => {
    const run = createResetRunRecord();
    const value = await run.step("build", "seedUnions", async () => {
      throw new Error("boom");
    });
    expect(value).toBeNull();
    expect(run.failures).toEqual([{ phase: "build", name: "seedUnions", error: "boom" }]);
  });

  it("keeps going after a failure, so one bad seeder does not hide the next", async () => {
    const run = createResetRunRecord();
    await run.step("build", "a", async () => {
      throw new Error("first");
    });
    await run.step("build", "b", async () => {
      throw new Error("second");
    });
    expect(run.failures.map((f) => f.name)).toEqual(["a", "b"]);
  });

  it("stringifies a non-Error throw rather than losing it", async () => {
    const run = createResetRunRecord();
    await run.step("finalize", "odd", async () => {
      throw "just a string";
    });
    expect(run.failures[0]!.error).toBe("just a string");
  });

  it("tells the operator when a step was contained", async () => {
    // Without this the failure reaches the audit row but NOT the SSE stream the
    // admin is watching, so a degraded reset looks like a clean one.
    const lines: string[] = [];
    const run = createResetRunRecord((m) => lines.push(m));
    await run.step("build", "seedUnions", async () => {
      throw new Error("unions died");
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("seedUnions");
    expect(lines[0]).toContain("unions died");
  });

  it("logs nothing when every step succeeds", async () => {
    const lines: string[] = [];
    const run = createResetRunRecord((m) => lines.push(m));
    await run.step("build", "seedUnions", async () => 1);
    expect(lines).toEqual([]);
  });

  it("derives status: clean run succeeded", () => {
    expect(createResetRunRecord().status(false)).toBe("succeeded");
  });

  it("derives status: isolated failure makes the run partial, not succeeded", async () => {
    const run = createResetRunRecord();
    await run.step("build", "a", async () => {
      throw new Error("x");
    });
    expect(run.status(false)).toBe("partial");
  });

  it("derives status: a structural abort is failed regardless of isolated failures", async () => {
    const run = createResetRunRecord();
    await run.step("build", "a", async () => {
      throw new Error("x");
    });
    expect(run.status(true)).toBe("failed");
  });

  it("mints a distinct runId per run (two resets may start in the same second)", () => {
    expect(createResetRunRecord().runId).not.toBe(createResetRunRecord().runId);
  });
});

describe("reset run persistence", () => {
  it("opens a running row that carries the runId", async () => {
    const db = createMockDb();
    const run = createResetRunRecord();
    await openResetRunLog(db as unknown as Db, run, {
      preset: "1953-default",
      mode: "historical",
      adminUsername: "arlebina",
    });

    const doc = db.collectionMocks.adminLogs!.insertOne.mock.calls[0]![0] as {
      action: string;
      resetRun: { runId: string; status: string; preset: string };
    };
    expect(doc.action).toBe("game_reset");
    expect(doc.resetRun.status).toBe("running");
    expect(doc.resetRun.runId).toBe(run.runId);
    expect(doc.resetRun.preset).toBe("1953-default");
  });

  it("opens the row even with no adminUsername, so script resets are audited too", async () => {
    // The pre-existing insert was gated on `if (adminUsername)`, so a
    // script-driven reset wrote no row at all.
    const db = createMockDb();
    await openResetRunLog(db as unknown as Db, createResetRunRecord(), {
      preset: "1953-default",
      mode: "historical",
    });
    expect(db.collectionMocks.adminLogs!.insertOne).toHaveBeenCalledTimes(1);
  });

  it("closes the row by runId and writes the gameConfig marker", async () => {
    const db = createMockDb();
    const run = createResetRunRecord();
    await closeResetRunLog(db as unknown as Db, run, {
      status: "failed",
      phaseReached: "teardown",
      details: "Game reset: ...",
      logs: ["a", "b"],
    });

    const [filter, update] = db.collectionMocks.adminLogs!.updateOne.mock.calls[0]! as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
    ];
    expect(filter["resetRun.runId"]).toBe(run.runId);
    expect(update.$set["resetRun.status"]).toBe("failed");
    expect(update.$set["resetRun.phaseReached"]).toBe("teardown");

    const marker = db.collectionMocks.gameConfig!.updateOne.mock.calls[0]! as unknown as [
      unknown,
      { $set: { lastReset: { status: string; runId: string } } },
    ];
    expect(marker[1].$set.lastReset.status).toBe("failed");
    expect(marker[1].$set.lastReset.runId).toBe(run.runId);
  });

  it("persists only the last 200 log lines", async () => {
    const db = createMockDb();
    const run = createResetRunRecord();
    const logs = Array.from({ length: 250 }, (_, i) => `line ${i}`);
    await closeResetRunLog(db as unknown as Db, run, {
      status: "succeeded",
      phaseReached: "complete",
      details: "ok",
      logs,
    });
    const update = db.collectionMocks.adminLogs!.updateOne.mock.calls[0]![1] as {
      $set: { "resetRun.logTail": string[] };
    };
    const tail = update.$set["resetRun.logTail"];
    expect(tail).toHaveLength(200);
    expect(tail[tail.length - 1]).toBe("line 249");
  });

  it("never lets a bookkeeping failure mask the run's own error", async () => {
    // closeResetRunLog runs in the orchestrator's `finally`. If the db is what
    // died, this must not throw over the top of the real cause.
    const db = createMockDb();
    db.collection("adminLogs").updateOne.mockRejectedValue(new Error("db gone"));
    await expect(
      closeResetRunLog(db as unknown as Db, createResetRunRecord(), {
        status: "failed",
        phaseReached: "teardown",
        details: "x",
        logs: [],
      })
    ).resolves.toBeUndefined();
  });
});
