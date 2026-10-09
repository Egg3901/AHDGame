import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
import { trackCheckpoint } from "./checkpointTelemetry";
function fakeDb() {
  const insertOne = vi.fn().mockResolvedValue({});
  const updateOne = vi.fn().mockResolvedValue({});
  const createIndex = vi.fn().mockResolvedValue("startedAt_1");
  const db = { collection: () => ({ insertOne, updateOne, createIndex }) } as unknown as Db;
  return { db, insertOne, updateOne };
}
describe("checkpoint telemetry", () => {
  beforeEach(() => vi.clearAllMocks());
  it("records running before work and a clean result after it, without rerunning work", async () => {
    const { db, insertOne, updateOne } = fakeDb();
    const result = { turn: 70, ms: 10, corpsRepriced: 9 };
    const run = vi.fn(async () => {
      expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({ state: "running" }));
      return result;
    });
    expect(await trackCheckpoint("markets", run, db, new Date("2026-10-09T12:15:03Z"))).toBe(
      result
    );
    expect(insertOne.mock.calls[0][0].slotAt.toISOString()).toBe("2026-10-09T12:15:00.000Z");
    expect(updateOne.mock.calls[0][1].$set).toMatchObject({
      state: "clean",
      turn: 70,
      corpsRepriced: 9,
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("preserves skips rather than claiming completion", async () => {
    const { db, updateOne } = fakeDb();
    await trackCheckpoint("markets", async () => null, db);
    expect(updateOne.mock.calls[0][1].$set.state).toBe("skipped");
  });
  it("records partial half-hour failures without publishing error messages", async () => {
    const { db, updateOne } = fakeDb();
    await trackCheckpoint(
      "half-hour",
      async () => ({
        turn: 71,
        ms: 4,
        steps: { growth: { error: "private detail" } },
        market: null,
      }),
      db
    );
    expect(updateOne.mock.calls[0][1].$set).toMatchObject({
      state: "degraded",
      failures: ["growth", "markets"],
    });
    expect(JSON.stringify(updateOne.mock.calls)).not.toContain("private detail");
  });
  it("records aborts and preserves the original error", async () => {
    const { db, updateOne } = fakeDb();
    const error = new Error("original");
    await expect(
      trackCheckpoint(
        "markets",
        async () => {
          throw error;
        },
        db
      )
    ).rejects.toBe(error);
    expect(updateOne.mock.calls[0][1].$set.state).toBe("aborted");
  });
  it("executes gameplay once even when telemetry fails", async () => {
    const { db, insertOne } = fakeDb();
    insertOne.mockRejectedValue(new Error("telemetry unavailable"));
    const run = vi.fn().mockResolvedValue({ turn: 70, ms: 3 });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await trackCheckpoint("markets", run, db)).toEqual({ turn: 70, ms: 3 });
    expect(run).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
