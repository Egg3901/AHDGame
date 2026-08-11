/**
 * Integration tests for cron turn API route.
 * Tests auth (CRON_SECRET), response shape, and processTurn integration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const CRON_SECRET = "test-cron-secret-123";

vi.mock("@/lib/turnSystem", () => ({
  processTurn: vi.fn(),
}));

vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ isActive: true, currentTurn: 41, fastMode: true }),
}));

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/api/requestLog", () => ({
  logRequest: vi.fn(),
}));

describe("GET /api/cron/turn", () => {
  const originalEnv = process.env;
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, CRON_SECRET };
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));

    const { processTurn } = await import("@/lib/turnSystem");
    const { getGameState } = await import("@/lib/gameState");
    const { getDb } = await import("@/lib/mongodb");

    db = createMockDb();
    db.collection("turnLogs");
    db.collectionMocks.turnLogs.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    vi.mocked(getDb).mockResolvedValue(db as never);

    vi.mocked(processTurn).mockResolvedValue({
      success: true,
      turn: 42,
      message: "Turn 42 processed successfully.",
      warnings: [],
    });
    vi.mocked(getGameState).mockResolvedValue({
      isActive: true,
      currentTurn: 41,
      fastMode: true,
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 401 when Authorization header is missing", async () => {
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/turn");
    const res = await GET(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 401 when Authorization header has wrong secret", async () => {
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/turn", {
      headers: { Authorization: "Bearer wrong-secret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 401 when Authorization format is invalid", async () => {
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/turn", {
      headers: { Authorization: CRON_SECRET },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 200 with processTurn result when secret is correct", async () => {
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/turn", {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.turn).toBe(42);
    expect(json.message).toContain("Turn 42");
  });

  it("returns 500 when processTurn fails", async () => {
    const { processTurn } = await import("@/lib/turnSystem");
    vi.mocked(processTurn).mockResolvedValue({
      success: false,
      turn: 0,
      message: "Failed to process turn: Game state not initialized",
      warnings: [],
    });

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/turn", {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const res = await GET(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.turn).toBe(0);
    expect(json.message).toBeDefined();
  });

  it("skips the backup fire when the primary already ran this hour", async () => {
    const { getGameState } = await import("@/lib/gameState");
    const { processTurn } = await import("@/lib/turnSystem");

    vi.setSystemTime(new Date("2025-01-01T00:30:00.000Z"));
    vi.mocked(getGameState).mockResolvedValue({
      isActive: true,
      fastMode: false,
      currentTurn: 41,
      iteration: null,
    } as never);
    db.collectionMocks.turnLogs.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ realTime: new Date("2025-01-01T00:05:00.000Z") }]),
    } as never);

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/turn?source=backup", {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      skipped: true,
      message: "Skipped: a turn already ran in the current clock hour.",
    });
    expect(processTurn).not.toHaveBeenCalled();
    expect(db.collectionMocks.turnLogs.find).toHaveBeenCalledWith(
      {
        turn: { $lte: 41 },
        $or: [{ iteration: { $exists: false } }, { iteration: null }],
      },
      { projection: { realTime: 1, createdAt: 1 } }
    );
  });

  it("skips the backup fire even when the primary turn had warnings", async () => {
    const { getGameState } = await import("@/lib/gameState");
    const { processTurn } = await import("@/lib/turnSystem");

    vi.setSystemTime(new Date("2025-01-01T00:30:00.000Z"));
    vi.mocked(getGameState).mockResolvedValue({
      isActive: true,
      fastMode: false,
      currentTurn: 41,
      iteration: null,
    } as never);
    db.collectionMocks.turnLogs.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          turn: 41,
          success: false,
          warnings: ["financialSuspectScan: The field 'suspectFlags' must be an array"],
          realTime: new Date("2025-01-01T00:05:00.000Z"),
        },
      ]),
    } as never);

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/turn?source=backup", {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      skipped: true,
      message: "Skipped: a turn already ran in the current clock hour.",
    });
    expect(processTurn).not.toHaveBeenCalled();
    expect(db.collectionMocks.turnLogs.find).toHaveBeenCalledWith(
      {
        turn: { $lte: 41 },
        $or: [{ iteration: { $exists: false } }, { iteration: null }],
      },
      { projection: { realTime: 1, createdAt: 1 } }
    );
  });

  it("allows the backup fire when the primary missed this hour entirely", async () => {
    const { getGameState } = await import("@/lib/gameState");
    const { processTurn } = await import("@/lib/turnSystem");

    vi.setSystemTime(new Date("2025-01-01T00:30:00.000Z"));
    vi.mocked(getGameState).mockResolvedValue({
      isActive: true,
      fastMode: false,
      currentTurn: 41,
      iteration: null,
    } as never);
    db.collectionMocks.turnLogs.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/turn?source=backup", {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(processTurn).toHaveBeenCalledTimes(1);
  });

  it("primary fire always runs, even 30 min after a backup-recovery turn", async () => {
    // Regression: prior 45-min guard skipped the :00 primary when the previous turn
    // had landed on :30, permanently pinning the schedule to :30. Primary must
    // unconditionally proceed so the schedule self-corrects.
    const { getGameState } = await import("@/lib/gameState");
    const { processTurn } = await import("@/lib/turnSystem");

    vi.setSystemTime(new Date("2025-01-01T01:00:00.000Z"));
    vi.mocked(getGameState).mockResolvedValue({
      isActive: true,
      fastMode: false,
      currentTurn: 41,
      iteration: null,
    } as never);
    db.collectionMocks.turnLogs.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ realTime: new Date("2025-01-01T00:30:00.000Z") }]),
    } as never);

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/turn?source=primary", {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(processTurn).toHaveBeenCalledTimes(1);
  });

  it("backup fire runs unconditionally in fast mode", async () => {
    const { getGameState } = await import("@/lib/gameState");
    const { processTurn } = await import("@/lib/turnSystem");

    vi.setSystemTime(new Date("2025-01-01T00:30:00.000Z"));
    vi.mocked(getGameState).mockResolvedValue({
      isActive: true,
      fastMode: true,
      currentTurn: 41,
      iteration: null,
    } as never);
    db.collectionMocks.turnLogs.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ realTime: new Date("2025-01-01T00:05:00.000Z") }]),
    } as never);

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/turn?source=backup", {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(processTurn).toHaveBeenCalledTimes(1);
  });
});
