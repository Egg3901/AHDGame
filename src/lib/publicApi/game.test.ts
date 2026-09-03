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
      startingYear: 1953,
      preset: "1953-default",
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
    expect(result!.currentYear).toBe(1953);
    expect(result!.startingYear).toBe(1953);
    expect(result!.gameDate).toBe("1953-11-08");
    expect(result!.gameDateLabel).toBe("November, Week 2, 1953");
    expect(result!.status).toBe("active");
    expect(result!.preset).toBe("1953-default");
    expect(result!.nextTurnAt).toBe("2025-06-01T12:00:00.000Z");
    expect(result!.turnDurationMs).toBe(3_600_000);
  });

  it("pins the public calendar during a founding phase", async () => {
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({
      _id: "current",
      currentTurn: 20,
      currentYear: 1953,
      startingYear: 1953,
      preIteration: { active: true, startedTurn: 1 },
      isActive: false,
      corporationActionsPaused: false,
      playerTransfersPaused: false,
      nextScheduledTurn: null,
      lastTurnProcessed: new Date("2026-01-01T00:00:00Z"),
      pausedAt: new Date("2026-01-01T00:00:00Z"),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { queryGameState } = await import("./game");
    const result = await queryGameState(db as unknown as Db);

    expect(result!.displayTurn).toBe(1);
    expect(result!.gameDate).toBe("1953-01-01");
    expect(result!.status).toBe("paused");
  });
});
