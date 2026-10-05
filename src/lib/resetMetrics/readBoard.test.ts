import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { buildOpeningMetricSnapshots1991 } from "./seedOpening1991";
import { readResetMetricBoard } from "./readBoard";
import { RESET_V2_SEED_REVISION } from "@/lib/resetVersions/rules";

const ready = { metrics: true, legislation: false, cabinet: false };
const seed = {
  worldId: "world-test",
  revision: RESET_V2_SEED_REVISION.metrics,
  sourceTurn: 1,
  completedAt: "2026-09-29T00:00:00.000Z",
  verificationHash: "verified",
};

describe("v2 metric board read", () => {
  it("does not query the v2 store in a v1 world or unsupported country", async () => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({
      metricsSystemVersion: "v1",
      currentTurn: 1,
    });
    expect(await readResetMetricBoard(db as unknown as Db, "US", undefined, ready)).toEqual({
      status: "not_enabled",
    });
    db.collection("gameState").findOne.mockResolvedValue({
      metricsSystemVersion: "v2",
      currentTurn: 1,
      resetWorldId: "world-test",
      resetVersionSeeds: { metrics: seed },
    });
    expect(await readResetMetricBoard(db as unknown as Db, "DE", undefined, ready)).toEqual({
      status: "not_enabled",
    });
    expect(db.collectionMocks.resetMetricSnapshots).toBeUndefined();
  });

  it("serves only a complete board for the same world and current turn", async () => {
    const db = createMockDb();
    const board = buildOpeningMetricSnapshots1991("world-test", 1)[0]!;
    db.collection("gameState").findOne.mockResolvedValue({
      metricsSystemVersion: "v2",
      currentTurn: 1,
      resetWorldId: "world-test",
      resetVersionSeeds: { metrics: seed },
    });
    db.collection("resetMetricSnapshots").findOne.mockResolvedValue(board);
    expect(await readResetMetricBoard(db as unknown as Db, "US", undefined, ready)).toEqual({
      status: "ready",
      board,
    });
    expect(db.collectionMocks.resetMetricSnapshots!.findOne.mock.calls[0]![0]).toEqual({
      _id: "US:national",
      worldId: "world-test",
    });
    db.collection("gameState").findOne.mockResolvedValue({
      metricsSystemVersion: "v2",
      currentTurn: 2,
      resetWorldId: "world-test",
      resetVersionSeeds: { metrics: seed },
    });
    expect(await readResetMetricBoard(db as unknown as Db, "US", undefined, ready)).toEqual({
      status: "stale",
    });
    db.collection("resetMetricSnapshots").findOne.mockResolvedValue({
      ...board,
      observations: {},
    });
    expect(await readResetMetricBoard(db as unknown as Db, "US", undefined, ready)).toEqual({
      status: "invalid",
    });
  });

  it("does not serve a region board under the wrong country or world", async () => {
    const db = createMockDb();
    const board = buildOpeningMetricSnapshots1991("world-test", 1).find(
      (row) => row.scope === "regional" && row.countryId === "US"
    )!;
    db.collection("gameState").findOne.mockResolvedValue({
      metricsSystemVersion: "v2",
      currentTurn: 1,
      resetWorldId: "world-test",
      resetVersionSeeds: { metrics: seed },
    });
    db.collection("resetMetricSnapshots").findOne.mockResolvedValue({
      ...board,
      countryId: "UK",
    });
    expect(await readResetMetricBoard(db as unknown as Db, "US", board.regionId, ready)).toEqual({
      status: "invalid",
    });
    db.collection("resetMetricSnapshots").findOne.mockResolvedValue(null);
    expect(await readResetMetricBoard(db as unknown as Db, "US", board.regionId, ready)).toEqual({
      status: "missing",
    });
  });
});
