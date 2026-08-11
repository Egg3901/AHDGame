import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock dependencies before importing the system under test.
interface MockGameState {
  _id: string;
  currentTurn: number;
  currentYear: number;
  isActive: boolean;
  lastTurnProcessed: Date;
  nextScheduledTurn: Date | null;
  pausedAt: Date | null;
  pauseReason: string | null;
  pauseKind: "manual" | "auto-drift" | null;
  lastResumedAt: Date | null;
  corporationActionsPaused: boolean;
  playerTransfersPaused: boolean;
  fastMode: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const mockGameStateDoc: MockGameState = {
  _id: "current",
  currentTurn: 100,
  currentYear: 2022,
  isActive: true,
  lastTurnProcessed: new Date("2026-05-20T00:00:00Z"),
  nextScheduledTurn: null,
  pausedAt: null,
  pauseReason: null,
  pauseKind: null,
  lastResumedAt: null,
  corporationActionsPaused: false,
  playerTransfersPaused: false,
  fastMode: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-05-20T00:00:00Z"),
};

const dbState: {
  gameState: typeof mockGameStateDoc;
  lastUpdate: Record<string, unknown> | null;
  latestTurnRealTime: Date | null;
  /** gameConfig.simSandbox — undefined in prod, true only on headless sandbox worlds. */
  simSandbox: boolean | undefined;
} = {
  gameState: { ...mockGameStateDoc },
  lastUpdate: null,
  latestTurnRealTime: null,
  simSandbox: undefined,
};

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(async () => ({
    collection: (name: string): Record<string, (...args: unknown[]) => Promise<unknown>> => {
      if (name === "gameState") {
        return {
          findOne: async () => dbState.gameState as unknown,
          findOneAndUpdate: async () => null as unknown,
          updateOne: async (..._args: unknown[]) => {
            const update = _args[1] as { $set: Record<string, unknown> };
            dbState.lastUpdate = update.$set;
            Object.assign(dbState.gameState, update.$set);
            return { acknowledged: true } as unknown;
          },
        };
      }
      if (name === "gameConfig") {
        return {
          findOne: async () =>
            (dbState.simSandbox === undefined ? {} : { simSandbox: dbState.simSandbox }) as unknown,
          updateOne: async () => ({ acknowledged: true }) as unknown,
        };
      }
      if (name === "unownedSectors") {
        return { countDocuments: async () => 100 as unknown };
      }
      return {
        findOne: async () => null as unknown,
        findOneAndUpdate: async () => null as unknown,
        updateOne: async () => ({ acknowledged: true }) as unknown,
        countDocuments: async () => 0 as unknown,
      };
    },
  })),
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn(),
  invalidateGameStateCache: vi.fn(),
}));

vi.mock("@/lib/time/gameTime", () => ({
  invalidateGameTimeCache: vi.fn(),
  reconcileGameStateClock: vi.fn(),
}));

vi.mock("@/lib/turn/turnLogQueries", () => ({
  getLatestCompletedTurnRealTime: vi.fn(),
}));

import { getLatestCompletedTurnRealTime } from "@/lib/turn/turnLogQueries";
import { processTurn } from "./turnSystem";

describe("processTurn auto-pause drift guard", () => {
  const realNow = new Date("2026-05-20T13:00:00Z"); // 13h after lastTurnProcessed → > 4h

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(realNow);
    dbState.gameState = { ...mockGameStateDoc };
    dbState.lastUpdate = null;
    dbState.latestTurnRealTime = null;
    dbState.simSandbox = undefined;
    vi.mocked(getLatestCompletedTurnRealTime).mockResolvedValue(dbState.latestTurnRealTime);
  });

  it("auto-pauses when drift exceeds 4h", async () => {
    const result = await processTurn();
    expect(result.success).toBe(false);
    expect(result.turn).toBe(0);
    expect(result.message).toContain("Auto-paused");
    expect(dbState.lastUpdate?.isActive).toBe(false);
    expect(dbState.lastUpdate?.pauseKind).toBe("auto-drift");
    expect((dbState.lastUpdate?.pauseReason as string).includes("no turn completed")).toBe(true);
  });

  it("skips when currentTurn <= 1 (bootstrap)", async () => {
    dbState.gameState.currentTurn = 1;
    const result = await processTurn();
    expect(dbState.lastUpdate?.pauseKind).not.toBe("auto-drift");
    expect(result.message).not.toContain("Auto-paused");
  });

  it("skips when lastTurnProcessed year < 2020 (epoch-ish)", async () => {
    dbState.gameState.lastTurnProcessed = new Date("1970-01-01T00:00:00Z");
    const result = await processTurn();
    expect(dbState.lastUpdate?.pauseKind).not.toBe("auto-drift");
    expect(result.message).not.toContain("Auto-paused");
  });

  it("skips when already paused (pausedAt set)", async () => {
    dbState.gameState.pausedAt = new Date("2026-05-20T10:00:00Z");
    const result = await processTurn();
    expect(dbState.lastUpdate?.pauseKind).not.toBe("auto-drift");
    expect(result.message).not.toContain("Auto-paused");
  });

  it("skips when drift < 4h", async () => {
    vi.setSystemTime(new Date("2026-05-20T03:00:00Z")); // 3h drift, < 4h
    const result = await processTurn();
    expect(dbState.lastUpdate?.pauseKind).not.toBe("auto-drift");
    expect(result.message).not.toContain("Auto-paused");
  });

  it("skips when game clock lags but cron fired recently (staging false-positive case)", async () => {
    // Game clock 13h behind wall clock, but the last completed turn was 1h ago.
    dbState.latestTurnRealTime = new Date("2026-05-20T12:00:00Z");
    vi.mocked(getLatestCompletedTurnRealTime).mockResolvedValue(dbState.latestTurnRealTime);
    const result = await processTurn();
    expect(dbState.lastUpdate?.pauseKind).not.toBe("auto-drift");
    expect(result.message).not.toContain("Auto-paused");
  });

  it("skips when a healthy turn is in-flight (recent heartbeat)", async () => {
    // Drift is 13h (> 4h), but isProcessing is true with a recent heartbeat
    // so we trust the in-flight turn to make progress.
    (
      dbState.gameState as MockGameState & {
        isProcessing?: boolean;
        processingHeartbeatAt?: Date;
      }
    ).isProcessing = true;
    (
      dbState.gameState as MockGameState & {
        processingHeartbeatAt?: Date;
      }
    ).processingHeartbeatAt = new Date(realNow.getTime() - 60_000); // 1 min ago
    const result = await processTurn();
    expect(dbState.lastUpdate?.pauseKind).not.toBe("auto-drift");
    expect(result.message).not.toContain("Auto-paused");
  });

  it("skips when recently resumed (lastResumedAt floors stale cronAnchor)", async () => {
    // Simulates resume after long manual pause: cronAnchor is 13h ago, but
    // admin just clicked Start (lastResumedAt = 30 min ago). Drift from the
    // resume floor is 30 min, well under 4h, so the guard must not fire.
    dbState.gameState.lastResumedAt = new Date(realNow.getTime() - 30 * 60_000);
    const result = await processTurn();
    expect(dbState.lastUpdate?.pauseKind).not.toBe("auto-drift");
    expect(result.message).not.toContain("Auto-paused");
  });

  it("auto-pauses when lastResumedAt itself is > 4h ago with no completed turn", async () => {
    // Admin resumed 5h ago but no turn ever fired (cron service is dead).
    // The floor doesn't suppress drift forever — once enough time elapses
    // since resume, the guard must still trip.
    dbState.gameState.lastResumedAt = new Date(realNow.getTime() - 5 * 3_600_000);
    const result = await processTurn();
    expect(result.success).toBe(false);
    expect(dbState.lastUpdate?.pauseKind).toBe("auto-drift");
    expect(result.message).toContain("Auto-paused");
  });

  it("skips on a headless sandbox world (gameConfig.simSandbox)", async () => {
    // A sandbox world has no cron, so "no completed turn in 13h" means only
    // that nobody ran this seed since yesterday — the normal state of a
    // resumed sim, and on a laptop the normal state of every sim. Drift here
    // is identical to the first test's, which DOES auto-pause; the sandbox
    // marker is the only difference.
    dbState.simSandbox = true;
    const result = await processTurn();
    expect(dbState.lastUpdate?.pauseKind).not.toBe("auto-drift");
    expect(result.message).not.toContain("Auto-paused");
  });

  it("still auto-pauses when simSandbox is explicitly false (not just falsy-by-absence)", async () => {
    // Guards the comparison itself: the check is `=== true`, so a world that
    // once carried the marker and had it cleared must go back to being
    // protected rather than staying exempt.
    dbState.simSandbox = false;
    const result = await processTurn();
    expect(result.success).toBe(false);
    expect(dbState.lastUpdate?.pauseKind).toBe("auto-drift");
    expect(result.message).toContain("Auto-paused");
  });

  it("does not floor when latestCronFire is newer than lastResumedAt", async () => {
    // Stale resume marker from days ago, but cron has been firing normally.
    // The floor must not regress a fresh cronAnchor backwards.
    dbState.gameState.lastResumedAt = new Date(realNow.getTime() - 72 * 3_600_000);
    dbState.latestTurnRealTime = new Date(realNow.getTime() - 30 * 60_000); // 30 min ago
    vi.mocked(getLatestCompletedTurnRealTime).mockResolvedValue(dbState.latestTurnRealTime);
    const result = await processTurn();
    expect(dbState.lastUpdate?.pauseKind).not.toBe("auto-drift");
    expect(result.message).not.toContain("Auto-paused");
  });
});
