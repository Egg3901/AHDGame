import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { TurnLog } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

describe("GET /api/admin/logs/hourly", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T10:00:00.000Z"));

    db = createMockDb();
    db.collection("turnLogs");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, admin: { username: "admin" } } as never);
  });

  it("returns phaseStatuses for new logs and null for older logs", async () => {
    const emptyPhases = {} as TurnLog["phases"];
    const logs = [
      {
        _id: new ObjectId("6810b8c00000000000000001"),
        turn: 440,
        year: 2029,
        gameTime: new Date("2026-04-29T09:00:00.000Z"),
        realTime: new Date("2026-04-29T09:00:17.000Z"),
        durationMs: 33690,
        success: true,
        warnings: [],
        phaseStatuses: {
          actionRefresh: {
            status: "completed",
            startedAt: new Date("2026-04-29T09:00:00.000Z"),
            completedAt: new Date("2026-04-29T09:00:01.000Z"),
            updatedAt: new Date("2026-04-29T09:00:01.000Z"),
            reason: null,
            message: null,
          },
          fiscalYear: {
            status: "skipped",
            startedAt: null,
            completedAt: new Date("2026-04-29T09:00:15.000Z"),
            updatedAt: new Date("2026-04-29T09:00:15.000Z"),
            reason: "conditional",
            message: "Skipped because this turn is not a fiscal year boundary.",
          },
        },
        phases: emptyPhases,
        createdAt: new Date("2026-04-29T09:00:17.000Z"),
      },
      {
        _id: new ObjectId("6810b8c00000000000000002"),
        turn: 439,
        year: 2029,
        gameTime: new Date("2026-04-29T08:00:00.000Z"),
        realTime: new Date("2026-04-29T08:00:32.000Z"),
        durationMs: 32000,
        success: true,
        warnings: [],
        phases: emptyPhases,
        createdAt: new Date("2026-04-29T08:00:32.000Z"),
      },
    ] as TurnLog[];

    const toArray = vi.fn().mockResolvedValue(logs);
    const limit = vi.fn().mockReturnValue({ toArray });
    const sort = vi.fn().mockReturnValue({ limit, toArray });
    db.collectionMocks.turnLogs.createIndex.mockResolvedValue("createdAt_1");
    db.collectionMocks.turnLogs.find.mockReturnValue({ sort, limit, toArray });

    const { GET } = await import("./route");
    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.count).toBe(2);
    expect(json.logs[0].phaseStatuses).toEqual(
      expect.objectContaining({
        actionRefresh: expect.objectContaining({ status: "completed" }),
        fiscalYear: expect.objectContaining({ status: "skipped" }),
      })
    );
    expect(json.logs[1].phaseStatuses).toBeNull();
  });
});
