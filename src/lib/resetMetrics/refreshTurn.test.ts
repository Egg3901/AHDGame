import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { buildOpeningMetricSnapshots1991 } from "./seedOpening1991";
import { dueResetMetricIds, refreshResetMetricBoard } from "./rules/refresh";
import type { ResetMetricSnapshot } from "./rules/snapshot";
import { RESET_V2_SEED_REVISION } from "@/lib/resetVersions/rules";
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
      revision: RESET_V2_SEED_REVISION.metrics,
      sourceTurn: 1,
      completedAt: "2026-09-30T00:00:00.000Z",
      verificationHash: "test-hash",
      countries: ["US", "UK", "JP", "IE"],
    },
  },
} as GameState;
const ready = { metrics: true, legislation: false, cabinet: false };

function ownerReadings(
  sourceBoards: readonly ResetMetricSnapshot[] = boards,
  turn = 2
): MetricOwnerTurnReadingsByBoard {
  return Object.fromEntries(
    sourceBoards.map((board) => {
      const dueIds = dueResetMetricIds(board, turn, false, false);
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
  it("recovers a failed prior refresh using its actual CAS turn without backfilling history", async () => {
    const db = createMockDb();
    const stalled = boards.map((board) => ({ ...board, asOfTurn: 12 }));
    db.collection("resetMetricSnapshots").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(stalled),
    });
    db.collection("resetMetricSnapshots").bulkWrite.mockResolvedValue({
      matchedCount: stalled.length,
    });
    const readings = Object.fromEntries(
      stalled.map((board) => [
        board._id,
        {
          updates: Object.fromEntries(
            dueResetMetricIds(board, 14, false, false).map((id) => [
              id,
              { ...board.observations[id]!, source: "current owner at turn 14" },
            ])
          ),
          cohortDue: false,
          electionDue: false,
        },
      ])
    );
    await refreshResetMetricSnapshotsTurn({
      db: db as unknown as Db,
      gameState: { ...state, currentTurn: 13 },
      turn: 14,
      ownerReadings: readings,
      ready,
    });
    const operations = db.collectionMocks.resetMetricSnapshots!.bulkWrite.mock.calls[0]![0];
    for (const operation of operations) {
      expect(operation).toMatchObject({
        updateOne: {
          filter: { worldId, asOfTurn: 12 },
          update: { $set: { asOfTurn: 14, lastRefreshFromTurn: 12 } },
        },
      });
      expect(operation.updateOne.update.$set).not.toHaveProperty("history");
    }
    expect(readings["US:CT"]!.updates).toHaveProperty("16");
    expect(readings["US:CT"]!.updates).toHaveProperty("18");
  });
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

  it("checks all 83 owner bundles before one compare-and-swap bulk", async () => {
    const db = createMockDb();
    db.collection("resetMetricSnapshots").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(boards),
    });
    db.collection("resetMetricSnapshots").bulkWrite.mockResolvedValue({ matchedCount: 83 });
    const result = await refreshResetMetricSnapshotsTurn({
      db: db as unknown as Db,
      gameState: state,
      turn: 2,
      ownerReadings: ownerReadings(),
      ready,
    });
    expect(result).toEqual({ boards: 83, advanced: 83, replayed: 0 });
    const operations = db.collectionMocks.resetMetricSnapshots!.bulkWrite.mock.calls[0]![0];
    expect(operations).toHaveLength(83);
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

  it("rejects a changed owner reading on a persisted same-turn board before writes", async () => {
    const db = createMockDb();
    const previous = boards.map((board) => ({ ...board, asOfTurn: 11 }));
    const firstReadings = ownerReadings(previous, 12);
    const completed = previous.map(
      (board) =>
        refreshResetMetricBoard({
          board,
          turn: 12,
          ...firstReadings[board._id]!,
          allowCatchUp: true,
        }).board
    );
    db.collection("resetMetricSnapshots").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(completed),
    });
    const replayReadings = ownerReadings(completed, 12);
    const ctUpdates = replayReadings["US:CT"]!.updates;
    const changedMetricId = Object.keys(ctUpdates).find((id) => ctUpdates[id]?.value !== null);
    if (!changedMetricId) throw new Error("Fixture has no numeric metric to change");
    const changedObservation = ctUpdates[changedMetricId]!;
    if (changedObservation.value === null) throw new Error("Fixture metric value is missing");
    const changedValue = changedObservation.value + 1;
    const ownerReader = vi.fn(async () => ({
      ...replayReadings,
      "US:CT": {
        ...replayReadings["US:CT"]!,
        updates: {
          ...ctUpdates,
          [changedMetricId]: {
            ...changedObservation,
            value: changedValue,
          },
        },
      },
    }));

    await expect(
      refreshResetMetricSnapshotsTurn({
        db: db as unknown as Db,
        gameState: { ...state, currentTurn: 11 },
        turn: 12,
        ownerReadings: ownerReader,
        ready,
      })
    ).rejects.toThrow("Reset metric turn replay differs from its persisted owner readings");

    expect(ownerReader).toHaveBeenCalledOnce();
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
    db.collection("resetMetricSnapshots").bulkWrite.mockResolvedValue({ matchedCount: 73 });
    expect(
      await refreshResetMetricSnapshotsTurn({
        db: db as unknown as Db,
        gameState: state,
        turn: 2,
        ownerReadings: ownerReadings(),
        ready,
      })
    ).toEqual({ boards: 83, advanced: 73, replayed: 10 });
    expect(db.collectionMocks.resetMetricSnapshots!.bulkWrite.mock.calls[0]![0]).toHaveLength(73);
  });

  it("samples history in the existing bulk write on the annual cadence", async () => {
    const db = createMockDb();
    const annualBoards = boards.map((board) => ({ ...board, asOfTurn: 12 }));
    db.collection("resetMetricSnapshots").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(annualBoards),
    });
    db.collection("resetMetricSnapshots").bulkWrite.mockResolvedValue({ matchedCount: 83 });
    await refreshResetMetricSnapshotsTurn({
      db: db as unknown as Db,
      gameState: { ...state, currentTurn: 12 },
      turn: 13,
      ownerReadings: ownerReadings(annualBoards, 13),
      ready,
    });
    const findOptions = db.collectionMocks.resetMetricSnapshots!.find.mock.calls[0]![1];
    expect(findOptions.projection.history).toBe(1);
    const operations = db.collectionMocks.resetMetricSnapshots!.bulkWrite.mock.calls[0]![0];
    expect(operations[0].updateOne.update.$set.history["07"]).toHaveLength(2);
    expect(operations[0].updateOne.update.$set.history["07"][1].turn).toBe(13);
  });
});
