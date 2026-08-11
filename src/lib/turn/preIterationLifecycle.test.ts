import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { detectPreIterationComplete } from "@/lib/turn/preIterationLifecycle";
import type { Db } from "mongodb";

vi.mock("@/lib/time/gameTime", () => ({ invalidateGameTimeCache: vi.fn() }));

function withState(preIteration: unknown): MockDb {
  const db = createMockDb();
  db.collectionMocks["gameState"] = db.collection("gameState");
  db.collectionMocks["gameState"].findOne = vi.fn().mockResolvedValue({ preIteration });
  return db;
}

function withCounts(db: MockDb, pending: number, resolved: number) {
  db.collectionMocks["elections"] = db.collection("elections");
  db.collectionMocks["elections"].countDocuments = vi
    .fn()
    .mockResolvedValueOnce(pending) // active/upcoming
    .mockResolvedValueOnce(resolved); // completed/resolved
}

describe("detectPreIterationComplete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("no-ops when no pre-iteration is active", async () => {
    const db = withState({ active: false, startedTurn: 1 });
    const res = await detectPreIterationComplete(db as unknown as Db, 30);
    expect(res.completed).toBe(false);
    expect(db.collectionMocks["gameState"]?.updateOne).not.toHaveBeenCalled();
  });

  it("no-ops when founding races are still campaigning", async () => {
    const db = withState({ active: true, startedTurn: 1 });
    withCounts(db, 12, 40); // 12 still active/upcoming
    const res = await detectPreIterationComplete(db as unknown as Db, 30);
    expect(res.completed).toBe(false);
    expect(db.collectionMocks["gameState"]?.updateOne).not.toHaveBeenCalled();
  });

  it("no-ops on turn 1 before any founding race has resolved", async () => {
    const db = withState({ active: true, startedTurn: 1 });
    withCounts(db, 0, 0); // none spawned/resolved yet
    const res = await detectPreIterationComplete(db as unknown as Db, 1);
    expect(res.completed).toBe(false);
    expect(db.collectionMocks["gameState"]?.updateOne).not.toHaveBeenCalled();
  });

  it("completes and stamps the offset once every founding race has resolved", async () => {
    const db = withState({ active: true, startedTurn: 1 });
    withCounts(db, 0, 288); // all resolved
    const res = await detectPreIterationComplete(db as unknown as Db, 97);
    expect(res.completed).toBe(true);

    const call = db.collectionMocks["gameState"]?.updateOne.mock.calls[0];
    expect(call?.[0]).toEqual({ _id: "current" });
    const set = (call?.[1] as { $set: Record<string, unknown> }).$set;
    expect(set["preIteration.active"]).toBe(false);
    expect(set["preIteration.completedTurn"]).toBe(97);
    // Offset = completedTurn - 1 so the calendar resumes at the era start (1).
    expect(set.preIterationTurns).toBe(96);
  });
});
