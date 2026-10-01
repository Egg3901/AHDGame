import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { buildOpeningMetricSnapshots1991 } from "./seedOpening1991";
import { refreshResetMetricBoard } from "./rules/refresh";
import {
  refreshResetMetricSnapshotsTurn,
  type MetricOwnerTurnReadingsByBoard,
} from "./refreshTurn";

const worldId = "metrics-world";
const boards = buildOpeningMetricSnapshots1991(worldId, 1);
const state = {
  currentTurn: 1,
  resetWorldId: worldId,
  metricsSystemVersion: "v2",
  resetVersionSeeds: {
    metrics: {
      worldId,
      revision: 1,
      sourceTurn: 1,
      completedAt: "2026-09-30T00:00:00.000Z",
      verificationHash: "test-hash",
    },
  },
} as GameState;
const ready = { metrics: true, legislation: false, cabinet: false };

function ownerReadings(): MetricOwnerTurnReadingsByBoard {
  return Object.fromEntries(
    boards.map((board) => {
      const dueIds = refreshResetMetricBoard({
        board,
        turn: 2,
        updates: {},
        cohortDue: false,
        electionDue: false,
      }).dueIds;
      return [
        board._id,
        {
          updates: Object.fromEntries(dueIds.map((id) => [id, board.observations[id]!])),
          cohortDue: false,
          electionDue: false,
        },
      ];
    })
  );
}

describe("v2 metric turn persistence shell", () => {
  it("does nothing while the effective version remains v1", async () => {
    const db = createMockDb();
    expect(
      await refreshResetMetricSnapshotsTurn({
        db: db as unknown as Db,
        gameState: state,
        turn: 2,
        ownerReadings: {},
        ready: { ...ready, metrics: false },
      })
    ).toEqual({ boards: 0, advanced: 0, replayed: 0 });
    expect(db.collectionMocks.resetMetricSnapshots).toBeUndefined();
  });

  it("checks all 74 owner bundles before one compare-and-swap bulk", async () => {
    const db = createMockDb();
    db.collection("resetMetricSnapshots").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(boards),
    });
    db.collection("resetMetricSnapshots").bulkWrite.mockResolvedValue({ matchedCount: 74 });
    const result = await refreshResetMetricSnapshotsTurn({
      db: db as unknown as Db,
      gameState: state,
      turn: 2,
      ownerReadings: ownerReadings(),
      ready,
    });
    expect(result).toEqual({ boards: 74, advanced: 74, replayed: 0 });
    const operations = db.collectionMocks.resetMetricSnapshots!.bulkWrite.mock.calls[0]![0];
    expect(operations).toHaveLength(74);
    expect(operations[0]).toMatchObject({
      updateOne: { filter: { worldId, asOfTurn: 1 }, update: { $set: { asOfTurn: 2 } } },
    });
  });

  it("refuses a missing due owner before any write", async () => {
    const db = createMockDb();
    db.collection("resetMetricSnapshots").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(boards),
    });
    const readings = ownerReadings();
    const national = readings["US:national"]!;
    const missingPrice = { ...national.updates };
    delete missingPrice["07"];
    const incomplete = { ...readings, "US:national": { ...national, updates: missingPrice } };
    await expect(
      refreshResetMetricSnapshotsTurn({
        db: db as unknown as Db,
        gameState: state,
        turn: 2,
        ownerReadings: incomplete,
        ready,
      })
    ).rejects.toThrow("did not refresh US:national");
    expect(db.collectionMocks.resetMetricSnapshots!.bulkWrite).not.toHaveBeenCalled();
  });

  it("rejects a board whose region identity disagrees with its key", async () => {
    const db = createMockDb();
    db.collection("resetMetricSnapshots").find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue(
          boards.map((board) => (board._id === "US:PA" ? { ...board, regionId: "NY" } : board))
        ),
    });
    await expect(
      refreshResetMetricSnapshotsTurn({
        db: db as unknown as Db,
        gameState: state,
        turn: 2,
        ownerReadings: ownerReadings(),
        ready,
      })
    ).rejects.toThrow("invalid board identity US:PA");
    expect(db.collectionMocks.resetMetricSnapshots!.bulkWrite).not.toHaveBeenCalled();
  });

  it("replays already-written boards and advances only the remaining boards", async () => {
    const db = createMockDb();
    const partial = boards.map((board, index) => (index < 10 ? { ...board, asOfTurn: 2 } : board));
    db.collection("resetMetricSnapshots").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(partial),
    });
    db.collection("resetMetricSnapshots").bulkWrite.mockResolvedValue({ matchedCount: 64 });
    expect(
      await refreshResetMetricSnapshotsTurn({
        db: db as unknown as Db,
        gameState: state,
        turn: 2,
        ownerReadings: ownerReadings(),
        ready,
      })
    ).toEqual({ boards: 74, advanced: 64, replayed: 10 });
    expect(db.collectionMocks.resetMetricSnapshots!.bulkWrite.mock.calls[0]![0]).toHaveLength(64);
  });
});
