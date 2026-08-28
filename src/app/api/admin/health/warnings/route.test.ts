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

  // Phase-budget pressure. runPhase kills a phase at PHASE_TIMEOUT_MS (240s),
  // failing the phase and aborting the turn — so a phase creeping toward that
  // ceiling is an outage with a lead time. A slow phase that still SUCCEEDS
  // raises no warning, skip or error anywhere else, so nothing surfaced it.
  describe("phaseBudget warnings", () => {
    function seedTurnLog(phaseStatuses: Record<string, unknown>) {
      db.collection("turnLogs");
      db.collectionMocks.turnLogs.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([
          {
            turn: 460,
            realTime: new Date("2026-04-29T05:00:00.000Z"),
            phaseStatuses,
          },
        ]),
      });
    }

    /** A phase that ran for `ms`, expressed as the telemetry the turn writes. */
    const ranFor = (ms: number) => ({
      status: "completed",
      startedAt: new Date("2026-04-29T05:00:00.000Z"),
      completedAt: new Date(new Date("2026-04-29T05:00:00.000Z").getTime() + ms),
    });

    it("flags a phase past 75% of the timeout as an error", async () => {
      seedTurnLog({ corporationTurn: ranFor(200_000) }); // 83% of 240s

      const { GET } = await import("./route");
      const res = await GET(
        new Request("http://localhost/api/admin/health/warnings?source=phaseBudget")
      );
      const json = await res.json();

      expect(json.warnings).toHaveLength(1);
      expect(json.warnings[0]).toMatchObject({
        turn: 460,
        phase: "corporationTurn",
        severity: "error",
        source: "phaseBudget",
      });
      expect(json.warnings[0].message).toContain("83%");
    });

    it("flags a phase between 50% and 75% as a warning", async () => {
      seedTurnLog({ corporationTurn: ranFor(132_000) }); // 55% of 240s

      const { GET } = await import("./route");
      const res = await GET(
        new Request("http://localhost/api/admin/health/warnings?source=phaseBudget")
      );
      const json = await res.json();

      expect(json.warnings).toHaveLength(1);
      expect(json.warnings[0]).toMatchObject({ severity: "warning", source: "phaseBudget" });
    });

    it("stays quiet for a phase comfortably inside budget", async () => {
      // 26s — the observed healthy corporationTurn median. Must not cry wolf.
      seedTurnLog({ corporationTurn: ranFor(26_000) });

      const { GET } = await import("./route");
      const res = await GET(
        new Request("http://localhost/api/admin/health/warnings?source=phaseBudget")
      );
      const json = await res.json();

      expect(json.warnings).toHaveLength(0);
    });

    it("reports only the worst phase per turn, not every slow one", async () => {
      seedTurnLog({
        corporationTurn: ranFor(200_000),
        indexFunds: ranFor(130_000),
        bondTurn: ranFor(125_000),
      });

      const { GET } = await import("./route");
      const res = await GET(
        new Request("http://localhost/api/admin/health/warnings?source=phaseBudget")
      );
      const json = await res.json();

      expect(json.warnings).toHaveLength(1);
      expect(json.warnings[0].phase).toBe("corporationTurn");
    });

    it("ignores telemetry with no completedAt (phase still running)", async () => {
      seedTurnLog({
        corporationTurn: {
          status: "running",
          startedAt: new Date("2026-04-29T05:00:00.000Z"),
          completedAt: null,
        },
      });

      const { GET } = await import("./route");
      const res = await GET(
        new Request("http://localhost/api/admin/health/warnings?source=phaseBudget")
      );
      const json = await res.json();

      expect(json.warnings).toHaveLength(0);
    });
  });
});
