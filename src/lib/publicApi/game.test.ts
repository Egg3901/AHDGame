import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn(),
}));

describe("queryGameState", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("returns null when game state not initialised", async () => {
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue(null);

    const { queryGameState } = await import("./game");
    const result = await queryGameState(db as unknown as Db);
    expect(result).toBeNull();
  });

  it("returns currentTurn and nextTurnAt from game state", async () => {
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({
      _id: "global",
      currentTurn: 42,
      currentYear: 2025,
      isActive: true,
      nextScheduledTurn: new Date("2025-06-01T12:00:00Z"),
      lastTurnProcessed: new Date("2025-06-01T11:00:00Z"),
      fastMode: false,
      corporationActionsPaused: false,
      playerTransfersPaused: false,
      pausedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { queryGameState } = await import("./game");
    const result = await queryGameState(db as unknown as Db);

    expect(result).not.toBeNull();
    expect(result!.currentTurn).toBe(42);
    expect(result!.nextTurnAt).toBe("2025-06-01T12:00:00.000Z");
    expect(result!.turnDurationMs).toBe(3_600_000);
  });
});
