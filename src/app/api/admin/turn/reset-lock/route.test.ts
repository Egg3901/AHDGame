import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockDb,
  type MockDb,
  assertCalledWithFilter,
  assertSetFields,
} from "@/lib/test-utils/mockDb";
import { POST } from "./route";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/api/requireAdmin", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/adminLog", () => ({
  createAdminLog: vi.fn(),
}));

vi.mock("@/lib/gameState", () => ({
  invalidateGameStateCache: vi.fn(),
}));

describe("POST /api/admin/turn/reset-lock", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T08:23:00.000Z"));
    db = createMockDb();

    const { getDb } = await import("@/lib/mongodb");
    const { requireAdmin } = await import("@/lib/api/requireAdmin");

    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "admin-user" },
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears a stale active lock and records an admin log", async () => {
    const staleHeartbeat = new Date(Date.now() - 21 * 60 * 1000);
    db.collectionMocks.gameState = {
      ...db.collection("gameState"),
      findOne: vi.fn().mockResolvedValue({
        _id: "current",
        isProcessing: true,
        processingPhase: "voteAccumulation",
        processingTargetTurn: 88,
        processingHeartbeatAt: staleHeartbeat,
        processingStartedAt: staleHeartbeat,
        updatedAt: staleHeartbeat,
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };

    const { createAdminLog } = await import("@/lib/adminLog");
    const { invalidateGameStateCache } = await import("@/lib/gameState");

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      modified: true,
      message: "Processing lock cleared. Next cron tick will run normally.",
    });
    assertCalledWithFilter(db.collectionMocks.gameState.updateOne, {
      _id: "current",
      isProcessing: true,
    });
    assertSetFields(db.collectionMocks.gameState.updateOne, {
      isProcessing: false,
      processingKind: null,
      processingStartedAt: null,
      processingTargetTurn: null,
      processingHeartbeatAt: null,
      processingPhase: null,
      processingPhaseStatuses: null,
    });
    expect(invalidateGameStateCache).toHaveBeenCalledTimes(1);
    expect(createAdminLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "turn_lock_reset",
        username: "admin-user",
        adminUsername: "admin-user",
      })
    );
  });

  it("refuses to clear a fresh active lock", async () => {
    const freshHeartbeat = new Date(Date.now() - 60 * 1000);
    db.collectionMocks.gameState = {
      ...db.collection("gameState"),
      findOne: vi.fn().mockResolvedValue({
        _id: "current",
        isProcessing: true,
        processingPhase: "campaignTurn",
        processingTargetTurn: 89,
        processingHeartbeatAt: freshHeartbeat,
        processingStartedAt: freshHeartbeat,
        updatedAt: freshHeartbeat,
      }),
      updateOne: vi.fn(),
    };

    const { createAdminLog } = await import("@/lib/adminLog");

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      error: "Processing lock is still active and cannot be reset yet. Try again in about 19m.",
      processingPhase: "campaignTurn",
      processingTargetTurn: 89,
      lastHeartbeatAt: freshHeartbeat.toISOString(),
      retryAfterSeconds: 1140,
      staleAfterAt: new Date(freshHeartbeat.getTime() + 20 * 60 * 1000).toISOString(),
    });
    expect(db.collectionMocks.gameState.updateOne).not.toHaveBeenCalled();
    expect(createAdminLog).not.toHaveBeenCalled();
  });

  it("returns a no-op response when no active lock exists", async () => {
    db.collectionMocks.gameState = {
      ...db.collection("gameState"),
      findOne: vi.fn().mockResolvedValue({
        _id: "current",
        isProcessing: false,
        processingPhase: "voteAccumulation",
        processingTargetTurn: 90,
        processingHeartbeatAt: new Date("2026-05-01T00:00:00.000Z"),
        processingStartedAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      }),
      updateOne: vi.fn(),
    };

    const { createAdminLog } = await import("@/lib/adminLog");
    const { invalidateGameStateCache } = await import("@/lib/gameState");

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      modified: false,
      message: "No change - there is no active processing lock to clear.",
      processingPhase: "voteAccumulation",
      processingTargetTurn: 90,
    });
    expect(db.collectionMocks.gameState.updateOne).not.toHaveBeenCalled();
    expect(createAdminLog).not.toHaveBeenCalled();
    expect(invalidateGameStateCache).not.toHaveBeenCalled();
  });

  it("returns 404 when the game state is missing", async () => {
    db.collectionMocks.gameState = {
      ...db.collection("gameState"),
      findOne: vi.fn().mockResolvedValue(null),
      updateOne: vi.fn(),
    };

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({
      error: "Game state not initialized",
      code: "NOT_FOUND",
    });
    expect(db.collectionMocks.gameState.updateOne).not.toHaveBeenCalled();
  });
});
