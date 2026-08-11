import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("gameTime", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { invalidateGameTimeCache } = await import("./gameTime");
    invalidateGameTimeCache();
  });

  it("repairs stale gameState clock fields from the latest successful turn log", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 449,
      currentYear: 2035,
      isActive: true,
      lastTurnProcessed: new Date("2026-04-29T15:00:00.000Z"),
      nextScheduledTurn: new Date("2026-04-29T23:00:00.000Z"),
      pausedAt: null,
      corporationActionsPaused: false,
      playerTransfersPaused: false,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-29T15:00:00.000Z"),
    });
    const latestLog = {
      turn: 452,
      year: 2029,
      gameTime: new Date("2026-04-29T21:00:00.000Z"),
      success: true,
    };
    db.collection("turnLogs").find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([latestLog]),
    });

    const { getGameTime } = await import("./gameTime");
    const result = await getGameTime();

    expect(result.currentTurn).toBe(452);
    expect(result.lastTurnProcessed.toISOString()).toBe("2026-04-29T21:00:00.000Z");
    expect(result.effectiveNow.toISOString()).toBe("2026-04-29T21:00:00.000Z");
    expect(db.collectionMocks.turnLogs.find).toHaveBeenCalledWith({
      success: true,
      $or: [{ iteration: { $exists: false } }, { iteration: null }],
    });
    expect(db.collectionMocks.gameState.updateOne).toHaveBeenCalledWith(
      { _id: "current" },
      expect.objectContaining({
        $set: expect.objectContaining({
          currentTurn: 452,
          // STARTING_YEAR (2019) + floor((452-1)/48) = 2019 + 9 = 2028.
          currentYear: 2028,
          lastTurnProcessed: new Date("2026-04-29T21:00:00.000Z"),
        }),
      })
    );
  });

  it("ignores successful turn logs from a different iteration", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 12,
      // Matches STARTING_YEAR (2019) so no year-repair triggers; this test
      // checks iteration filtering, not year repair.
      currentYear: 2019,
      isActive: true,
      lastTurnProcessed: new Date("2026-04-29T15:00:00.000Z"),
      nextScheduledTurn: new Date("2026-04-29T23:00:00.000Z"),
      pausedAt: null,
      iteration: { type: "Iteration", number: 2 },
      corporationActionsPaused: false,
      playerTransfersPaused: false,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-29T15:00:00.000Z"),
    });
    db.collection("turnLogs").find.mockImplementation((filter: Record<string, unknown>) => {
      const matchesCurrentIteration =
        filter["iteration.type"] === "Iteration" && filter["iteration.number"] === 2;
      return {
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue(
          matchesCurrentIteration
            ? []
            : [
                {
                  turn: 452,
                  year: 2029,
                  iteration: { type: "Iteration", number: 1 },
                  gameTime: new Date("2026-04-29T21:00:00.000Z"),
                  success: true,
                },
              ]
        ),
      };
    });

    const { getGameTime } = await import("./gameTime");
    const result = await getGameTime();

    expect(result.currentTurn).toBe(12);
    expect(result.lastTurnProcessed.toISOString()).toBe("2026-04-29T15:00:00.000Z");
    expect(db.collectionMocks.turnLogs.find).toHaveBeenCalledWith({
      success: true,
      "iteration.type": "Iteration",
      "iteration.number": 2,
    });
    expect(db.collectionMocks.gameState.updateOne).not.toHaveBeenCalled();
  });

  it("respects GameState.startingYear when computing repaired year (1991 preset stays 1991)", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 1,
      currentYear: 1991, // 1991 preset
      startingYear: 1991, // honored by repairedYear calc
      isActive: true,
      lastTurnProcessed: new Date("2026-04-29T15:00:00.000Z"),
      nextScheduledTurn: new Date("2026-04-29T23:00:00.000Z"),
      pausedAt: null,
      corporationActionsPaused: false,
      playerTransfersPaused: false,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-29T15:00:00.000Z"),
    });
    db.collection("turnLogs").find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { getGameTime } = await import("./gameTime");
    await getGameTime();

    // repairedYear = startingYear (1991) + floor(0/48) = 1991 — matches stored
    // currentYear, so the repair calc must NOT clobber 1991 back to 2019. The
    // absence of an updateOne call proves the year-mismatch repair didn't fire.
    expect(db.collectionMocks.gameState.updateOne).not.toHaveBeenCalled();
  });

  it("exposes the per-game startingYear from GameState (1991 preset)", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 1,
      currentYear: 1991,
      startingYear: 1991,
      isActive: true,
      lastTurnProcessed: new Date("2026-04-29T15:00:00.000Z"),
      nextScheduledTurn: new Date("2026-04-29T23:00:00.000Z"),
      pausedAt: null,
      corporationActionsPaused: false,
      playerTransfersPaused: false,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-29T15:00:00.000Z"),
    });
    db.collection("turnLogs").find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { getGameTime } = await import("./gameTime");
    const result = await getGameTime();

    expect(result.startingYear).toBe(1991);
  });

  it("exposes STARTING_YEAR as startingYear when GameState omits it", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 1,
      currentYear: 2019,
      // startingYear field intentionally omitted
      isActive: true,
      lastTurnProcessed: new Date("2026-04-29T15:00:00.000Z"),
      nextScheduledTurn: new Date("2026-04-29T23:00:00.000Z"),
      pausedAt: null,
      corporationActionsPaused: false,
      playerTransfersPaused: false,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-29T15:00:00.000Z"),
    });
    db.collection("turnLogs").find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { getGameTime } = await import("./gameTime");
    const result = await getGameTime();

    expect(result.startingYear).toBe(2019);
  });

  it("legacy GameState without startingYear falls back to STARTING_YEAR constant", async () => {
    // A pre-2026-05-20 row that never had `startingYear` set. currentYear is
    // 2019 (matching the global constant), so repair should be a no-op.
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 1,
      currentYear: 2019,
      // startingYear field intentionally omitted
      isActive: true,
      lastTurnProcessed: new Date("2026-04-29T15:00:00.000Z"),
      nextScheduledTurn: new Date("2026-04-29T23:00:00.000Z"),
      pausedAt: null,
      corporationActionsPaused: false,
      playerTransfersPaused: false,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-29T15:00:00.000Z"),
    });
    db.collection("turnLogs").find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { getGameTime } = await import("./gameTime");
    await getGameTime();

    expect(db.collectionMocks.gameState.updateOne).not.toHaveBeenCalled();
  });
});
