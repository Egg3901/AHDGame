import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/db/collections", () => ({
  getGameStateCollection: vi.fn(),
}));

describe("requireCorporationActions / requireGameActive", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("gameState");
    const { getGameStateCollection } = await import("@/lib/db/collections");
    vi.mocked(getGameStateCollection).mockResolvedValue(db.collection("gameState") as never);
  });

  it("requireGameActive rejects when isActive is false", async () => {
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      isActive: false,
    });
    const { requireGameActive } = await import("./requireCorporationActions");
    const res = await requireGameActive(db as unknown as Db);
    expect(res?.status).toBe(409);
    expect(await res?.json()).toEqual({ error: "The game is currently paused." });
  });

  it("requireGameActive allows when isActive is true", async () => {
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      isActive: true,
    });
    const { requireGameActive } = await import("./requireCorporationActions");
    expect(await requireGameActive(db as unknown as Db)).toBeNull();
  });

  it("requireCorporationActionsEnabled allows turns-paused worlds (ticket #1009 settling)", async () => {
    // Registration / launch settle pauses turns (`isActive: false`) on purpose so
    // players can found corps and place plants. Corp routes must not mirror the
    // political-action pause gate here.
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      isActive: false,
      corporationActionsPaused: false,
    });
    const { requireCorporationActionsEnabled } = await import("./requireCorporationActions");
    expect(await requireCorporationActionsEnabled(db as unknown as Db)).toBeNull();
  });

  it("requireCorporationActionsEnabled rejects corp-actions pause", async () => {
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      isActive: true,
      corporationActionsPaused: true,
    });
    const { requireCorporationActionsEnabled } = await import("./requireCorporationActions");
    const res = await requireCorporationActionsEnabled(db as unknown as Db);
    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({
      error: "Corporation actions are currently paused by an admin",
    });
  });

  it("requireCorporationActionsEnabled allows when corp-actions flag is clear", async () => {
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      isActive: true,
      corporationActionsPaused: false,
    });
    const { requireCorporationActionsEnabled } = await import("./requireCorporationActions");
    expect(await requireCorporationActionsEnabled(db as unknown as Db)).toBeNull();
  });
});
