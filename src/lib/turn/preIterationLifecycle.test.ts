import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { detectPreIterationComplete } from "@/lib/turn/preIterationLifecycle";
import type { Db } from "mongodb";

vi.mock("@/lib/time/gameTime", () => ({ invalidateGameTimeCache: vi.fn() }));

function withState(
  preIteration: unknown,
  overrides: { preset?: string; startingPartiesMode?: string } = {}
): MockDb {
  const db = createMockDb();
  db.collectionMocks["gameState"] = db.collection("gameState");
  db.collectionMocks["gameState"].findOne = vi.fn().mockResolvedValue({
    preIteration,
    preset: overrides.preset ?? "1953-default",
    startingPartiesMode: overrides.startingPartiesMode ?? "default",
  });
  return db;
}

function withCounts(db: MockDb, pending: number, resolved: number, covered = resolved) {
  db.collectionMocks["elections"] = db.collection("elections");
  db.collectionMocks["elections"].countDocuments = vi.fn().mockResolvedValue(pending);
  db.collectionMocks["elections"].find = vi.fn().mockReturnValue({
    toArray: vi.fn().mockResolvedValue(
      Array.from({ length: resolved }, (_, index) => ({
        _id: `election-${index}`,
        status: "resolved",
      }))
    ),
  });
  for (const name of ["electionCandidates", "electionVoteTallies"]) {
    db.collectionMocks[name] = db.collection(name);
    db.collectionMocks[name].aggregate = vi.fn().mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue(
          Array.from({ length: covered }, (_, index) => ({ _id: `election-${index}` }))
        ),
    });
  }
}

function withPartylessEmptyResolvedRace(db: MockDb, status: "resolved" | "completed") {
  db.collectionMocks["elections"]!.find = vi.fn().mockReturnValue({
    toArray: vi.fn().mockResolvedValue([{ _id: "empty-election", status }]),
  });
  db.collectionMocks["electionCandidates"]!.aggregate = vi.fn().mockReturnValue({
    toArray: vi.fn().mockResolvedValue([]),
  });
  db.collectionMocks["electionVoteTallies"]!.aggregate = vi.fn().mockReturnValue({
    toArray: vi.fn().mockResolvedValue([]),
  });
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

  it("keeps the founding phase active when a resolved race has no candidate or vote coverage", async () => {
    const db = withState({ active: true, startedTurn: 1 });
    withCounts(db, 0, 12, 11);
    const res = await detectPreIterationComplete(db as unknown as Db, 49);
    expect(res.completed).toBe(false);
    expect(db.collectionMocks["gameState"]?.updateOne).not.toHaveBeenCalled();
  });

  it("lets a terminally resolved empty 1991 no-party ballot finish the pinned founding phase", async () => {
    const db = withState(
      { active: true, startedTurn: 1 },
      {
        preset: "1991-default",
        startingPartiesMode: "none",
      }
    );
    withCounts(db, 0, 1, 0);
    withPartylessEmptyResolvedRace(db, "resolved");

    const res = await detectPreIterationComplete(db as unknown as Db, 49);
    expect(res.completed).toBe(true);
  });

  it("does not treat an unfinished empty ballot as complete in the 1991 no-party phase", async () => {
    const db = withState(
      { active: true, startedTurn: 1 },
      {
        preset: "1991-default",
        startingPartiesMode: "none",
      }
    );
    withCounts(db, 0, 1, 0);
    withPartylessEmptyResolvedRace(db, "completed");

    const res = await detectPreIterationComplete(db as unknown as Db, 49);
    expect(res.completed).toBe(false);
    expect(db.collectionMocks["gameState"]?.updateOne).not.toHaveBeenCalled();
  });

  it("still requires vote coverage for an 1991 no-party race with candidates", async () => {
    const db = withState(
      { active: true, startedTurn: 1 },
      {
        preset: "1991-default",
        startingPartiesMode: "none",
      }
    );
    withCounts(db, 0, 1, 1);
    db.collectionMocks["electionCandidates"]!.aggregate = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "election-0" }]),
    });
    db.collectionMocks["electionVoteTallies"]!.aggregate = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const res = await detectPreIterationComplete(db as unknown as Db, 49);
    expect(res.completed).toBe(false);
    expect(db.collectionMocks["gameState"]?.updateOne).not.toHaveBeenCalled();
  });
});
