import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { buildOpeningMetricSnapshots1991 } from "./seedOpening1991";
import { loadPoliticalApprovalBases } from "@/lib/politicalLegislation/politicalApprovalProvider";
import { loadResetApprovalModifiers } from "./loadApprovalModifiers";
import { RESET_V2_SEED_REVISION } from "@/lib/resetVersions/rules";
import type { GameState } from "@/lib/db/types/gameState";
const boards = buildOpeningMetricSnapshots1991("approval-test", 1).filter(
  (board) => board.countryId === "UK"
);
const states = boards
  .filter((board) => board.regionId)
  .map((board) => ({ _id: board.regionId!, countryId: "UK", population: 100 }));
const game = {
  _id: "current",
  currentTurn: 1,
  preset: "1991-default",
  currentYear: 1991,
  startingYear: 1991,
  metricsSystemVersion: "v2",
  resetWorldId: "approval-test",
  resetVersionSeeds: {
    metrics: {
      worldId: "approval-test",
      revision: RESET_V2_SEED_REVISION.metrics,
      sourceTurn: 1,
      completedAt: "2026-10-09T00:00:00Z",
      verificationHash: "verified",
    },
  },
} as GameState;
let db: ReturnType<typeof createMockDb>;
beforeEach(() => {
  db = createMockDb();
  db.collection("gameState").findOne.mockResolvedValue(game);
  db.collection("states").find().toArray.mockResolvedValue(states);
  db.collection("resetMetricSnapshots").find().toArray.mockResolvedValue(boards);
  db.collectionMocks.resetMetricSnapshots!.find.mockClear();
});
describe("Metrics v2 approval source", () => {
  it("loads bases and named conditions without consulting the v1 political board", async () => {
    const result = await loadPoliticalApprovalBases(db as unknown as Db, "UK");
    expect(result!.byRegion.size).toBe(states.length);
    expect(result!.modifiersByRegion!.get("SCO")!.length).toBeGreaterThan(0);
    expect(db.collectionMocks.politicalMetrics).toBeUndefined();
    expect(db.collectionMocks.resetMetricSnapshots!.find).toHaveBeenCalledOnce();
  });
  it("rejects a missing, mismatched, incomplete or stale owner board", async () => {
    for (const rows of [
      [],
      boards.map((board) => ({ ...board, worldId: "other" })),
      boards.map((board) => ({ ...board, observations: {} })),
      boards.map((board) => ({ ...board, asOfTurn: 0 })),
    ]) {
      db.collection("resetMetricSnapshots").find().toArray.mockResolvedValue(rows);
      await expect(loadPoliticalApprovalBases(db as unknown as Db, "UK")).rejects.toThrow();
    }
  });
  it("accepts the refreshed next-turn boards during a turn snapshot", async () => {
    db.collection("resetMetricSnapshots")
      .find()
      .toArray.mockResolvedValue(boards.map((board) => ({ ...board, asOfTurn: 2 })));
    expect((await loadPoliticalApprovalBases(db as unknown as Db, "UK", 2))!.byRegion.size).toBe(
      states.length
    );
    await expect(loadPoliticalApprovalBases(db as unknown as Db, "UK")).rejects.toThrow();
  });
  it("serves current/next boards only within a verified processing window, while snapshots stay exact", async () => {
    const mixed = boards.map((board, i) => ({
      ...board,
      asOfTurn: i % 2 ? 2 : 1,
      lastRefreshFromTurn: 1,
    }));
    db.collection("resetMetricSnapshots").find().toArray.mockResolvedValue(mixed);
    const processing = {
      ...game,
      isProcessing: true,
      processingKind: "turn" as const,
      processingTargetTurn: 2,
    };
    db.collection("gameState").findOne.mockResolvedValue(processing);
    expect((await loadPoliticalApprovalBases(db as unknown as Db, "UK"))!.byRegion.size).toBe(
      states.length
    );
    await expect(loadPoliticalApprovalBases(db as unknown as Db, "UK", 2)).rejects.toThrow();
    db.collection("gameState").findOne.mockResolvedValue({
      ...processing,
      processingKind: "forexMigration",
    });
    await expect(loadPoliticalApprovalBases(db as unknown as Db, "UK")).rejects.toThrow();
    db.collection("gameState").findOne.mockResolvedValue(processing);
    db.collection("resetMetricSnapshots")
      .find()
      .toArray.mockResolvedValue(mixed.map((board) => ({ ...board, asOfTurn: 3 })));
    await expect(loadPoliticalApprovalBases(db as unknown as Db, "UK")).rejects.toThrow();
  });
  it("does not query the v2 collection when the country is not activated", async () => {
    const count = db.collection("resetMetricSnapshots").find.mock.calls.length;
    expect(await loadResetApprovalModifiers(db as unknown as Db, "DE", [], game)).toBeNull();
    expect(db.collection("resetMetricSnapshots").find.mock.calls.length).toBe(count);
  });
});
