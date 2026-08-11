import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

describe("GET /api/admin/health/warnings", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T08:00:00.000Z"));

    db = createMockDb();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, admin: { username: "admin" } } as never);

    db.collection("gameHealthSnapshots");
    db.collection("gameState");

    db.collectionMocks.gameHealthSnapshots.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          turn: 438,
          timestamp: new Date("2026-04-29T04:20:13.361Z"),
          turnProcessing: {
            warningCount: 1,
            errorCount: 0,
            warnings: [
              {
                phase: "fundGeneration",
                message: "Minor warning",
                turn: 438,
                timestamp: new Date("2026-04-29T04:20:10.000Z"),
              },
            ],
            errors: [],
            phaseStatuses: {
              fiscalYear: {
                status: "skipped",
                startedAt: null,
                completedAt: new Date("2026-04-29T04:20:11.000Z"),
                updatedAt: new Date("2026-04-29T04:20:11.000Z"),
                reason: "conditional",
                message: "Skipped because this turn is not a fiscal year boundary.",
              },
            },
          },
          dataIntegrity: {
            issues: [
              {
                category: "orphanedOfficial",
                severity: "error",
                message: "916 officials reference non-existent seats",
              },
            ],
          },
        },
      ]),
    });
  });

  it("includes a live turn-lock error when the processing heartbeat is stale", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 438,
      isProcessing: true,
      processingKind: "turn",
      processingPhase: "suspiciousDetection",
      processingStartedAt: new Date("2026-04-29T07:50:00.000Z"),
      processingHeartbeatAt: new Date("2026-04-29T07:54:00.000Z"),
      updatedAt: new Date("2026-04-29T07:54:00.000Z"),
    });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/admin/health/warnings"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          turn: 439,
          phase: "suspiciousDetection",
          severity: "error",
          source: "turnLock",
        }),
        expect.objectContaining({
          turn: 438,
          phase: "fiscalYear",
          severity: "warning",
          source: "turnPhase",
        }),
      ])
    );
  });

  it("filters warnings by source", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 438,
      isProcessing: true,
      processingKind: "turn",
      processingPhase: "suspiciousDetection",
      processingStartedAt: new Date("2026-04-29T07:50:00.000Z"),
      processingHeartbeatAt: new Date("2026-04-29T07:54:00.000Z"),
      updatedAt: new Date("2026-04-29T07:54:00.000Z"),
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/admin/health/warnings?source=turnLock")
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.warnings).toHaveLength(1);
    expect(json.warnings[0]).toEqual(
      expect.objectContaining({
        source: "turnLock",
        phase: "suspiciousDetection",
      })
    );
  });

  it("does not synthesize a turn-lock warning for non-turn processing locks", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 438,
      isProcessing: true,
      processingKind: "forexMigration",
      processingPhase: "forexMigration",
      processingStartedAt: new Date("2026-04-29T07:56:00.000Z"),
      processingHeartbeatAt: new Date("2026-04-29T07:57:00.000Z"),
      updatedAt: new Date("2026-04-29T07:57:00.000Z"),
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/admin/health/warnings?source=turnLock")
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.warnings).toHaveLength(0);
  });

  it("returns individually modeled skipped phases when filtered to turnPhase", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 438,
      isProcessing: false,
      updatedAt: new Date("2026-04-29T07:57:00.000Z"),
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/admin/health/warnings?source=turnPhase")
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.warnings).toEqual([
      expect.objectContaining({
        turn: 438,
        phase: "fiscalYear",
        severity: "warning",
        source: "turnPhase",
        message: "Skipped because this turn is not a fiscal year boundary.",
      }),
    ]);
  });
});
