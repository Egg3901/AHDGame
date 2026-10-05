import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  RESET_SYSTEMS,
  RESET_V2_SEED_REVISION,
  type ResetSystem,
  type ResetSystemSeedReceipt,
} from "@/lib/resetVersions/rules";
import {
  assessFreshResetV2Candidate,
  promoteFreshResetToV2,
  type CandidateState,
  type PromotionDependencies,
  type PromotionInspection,
} from "./2026-10-04-promote-fresh-reset-to-v2";

const WORLD_ID = "reset-world-1991";
const COMPLETED_AT = "2026-10-04T12:00:00.000Z";

function receipt(system: ResetSystem): ResetSystemSeedReceipt {
  return {
    worldId: WORLD_ID,
    revision: RESET_V2_SEED_REVISION[system],
    sourceTurn: 1,
    completedAt: COMPLETED_AT,
    verificationHash: `${system}-hash`,
  };
}

function freshCandidate(overrides: Partial<CandidateState> = {}): CandidateState {
  return {
    _id: "current",
    resetWorldId: WORLD_ID,
    currentTurn: 1,
    startingYear: 1991,
    resetStartDate: { year: 1991, week: 1 },
    preset: "1991-default",
    isActive: false,
    isProcessing: false,
    manuallyEnabledSeats: ["secretary_of_education"],
    metricsSystemVersion: "v1",
    legislationSystemVersion: "v1",
    cabinetSystemVersion: "v1",
    ...overrides,
  };
}

function readyInspection(): PromotionInspection {
  return {
    status: "ready",
    worldId: WORLD_ID,
    currentTurn: 1,
    reasons: [],
    expectedRows: {
      metricBoards: 3,
      lawBoards: 3,
      regionalFiscalBoards: 3,
      departmentBoards: 3,
    },
  };
}

function dependencies(
  inspection: PromotionInspection = readyInspection()
): PromotionDependencies & { order: string[] } {
  const order: string[] = [];
  return {
    order,
    inspect: vi.fn().mockResolvedValue(inspection),
    seedMetrics: vi.fn().mockImplementation(async () => {
      order.push("metrics");
      return receipt("metrics");
    }),
    seedLegislation: vi.fn().mockImplementation(async () => {
      order.push("legislation");
      return receipt("legislation");
    }),
    seedCabinet: vi.fn().mockImplementation(async () => {
      order.push("cabinet");
      return receipt("cabinet");
    }),
    now: () => new Date(COMPLETED_AT),
  };
}

describe("assessFreshResetV2Candidate", () => {
  it("blocks a missing game state", () => {
    expect(assessFreshResetV2Candidate(null)).toEqual({
      status: "blocked",
      reasons: ["gameState/current does not exist"],
    });
  });

  it("accepts only the exact stopped turn-one 1991 reset", () => {
    expect(assessFreshResetV2Candidate(freshCandidate())).toMatchObject({
      status: "ready",
      worldId: WORLD_ID,
      currentTurn: 1,
      reasons: [],
    });
  });

  it.each([
    ["active world", { isActive: true }, "isActive=false"],
    ["processing world", { isProcessing: true }, "currently processing"],
    ["advanced world", { currentTurn: 2 }, "currentTurn must still be 1"],
    ["wrong preset", { preset: "1979-default" }, "preset must be 1991-default"],
    ["wrong opening date", { resetStartDate: { year: 1991, week: 2 } }, "1991, week 1"],
    ["missing education seat", { manuallyEnabledSeats: [] }, "secretary_of_education"],
  ])("blocks a %s", (_name, overrides, expectedReason) => {
    const result = assessFreshResetV2Candidate(
      freshCandidate(overrides as Partial<CandidateState>)
    );
    expect(result.status).toBe("blocked");
    expect(result.reasons.join("; ")).toContain(expectedReason);
  });

  it("recognizes a fully promoted world from valid receipts", () => {
    const resetVersionSeeds = Object.fromEntries(
      RESET_SYSTEMS.map((system) => [system, receipt(system)])
    ) as Record<ResetSystem, ResetSystemSeedReceipt>;
    const result = assessFreshResetV2Candidate(
      freshCandidate({
        currentTurn: 4,
        metricsSystemVersion: "v2",
        legislationSystemVersion: "v2",
        cabinetSystemVersion: "v2",
        resetVersionSeeds,
      })
    );
    expect(result).toMatchObject({ status: "already-promoted", worldId: WORLD_ID });
  });

  it("blocks a partial v2 activation instead of overwriting it", () => {
    const result = assessFreshResetV2Candidate(
      freshCandidate({
        metricsSystemVersion: "v2",
        resetVersionSeeds: { metrics: receipt("metrics") },
      })
    );
    expect(result.status).toBe("blocked");
    expect(result.reasons.join("; ")).toContain("partial or inconsistent v2 activation");
  });
});

describe("promoteFreshResetToV2", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("keeps the default dry-run read-only", async () => {
    const deps = dependencies();
    const result = await promoteFreshResetToV2(db as unknown as Db, { apply: false }, deps);

    expect(result.mode).toBe("dry-run");
    expect(deps.seedMetrics).not.toHaveBeenCalled();
    expect(deps.seedLegislation).not.toHaveBeenCalled();
    expect(deps.seedCabinet).not.toHaveBeenCalled();
    expect(db.collection).not.toHaveBeenCalled();
  });

  it("requires the exact reset world confirmation before seeding", async () => {
    const deps = dependencies();
    await expect(
      promoteFreshResetToV2(db as unknown as Db, { apply: true, confirmWorld: "wrong-world" }, deps)
    ).rejects.toThrow(`--confirm-world=${WORLD_ID}`);
    expect(deps.order).toEqual([]);
    expect(db.collection).not.toHaveBeenCalled();
  });

  it("seeds in dependency order and atomically activates the verified receipts", async () => {
    const deps = dependencies();
    const result = await promoteFreshResetToV2(
      db as unknown as Db,
      { apply: true, confirmWorld: WORLD_ID, actor: "release-operator" },
      deps
    );

    expect(result.mode).toBe("applied");
    expect(deps.order).toEqual(["metrics", "legislation", "cabinet"]);

    const gameStateUpdate = db.collectionMocks.gameState.updateOne.mock.calls[0];
    expect(gameStateUpdate[0]).toEqual({
      _id: "current",
      resetWorldId: WORLD_ID,
      currentTurn: 1,
      preset: "1991-default",
      isActive: false,
      isProcessing: { $ne: true },
    });
    expect(gameStateUpdate[1].$set).toMatchObject({
      metricsSystemVersion: "v2",
      legislationSystemVersion: "v2",
      cabinetSystemVersion: "v2",
      metricsSystemVersionBy: "release-operator",
      resetVersionSeeds: {
        metrics: receipt("metrics"),
        legislation: receipt("legislation"),
        cabinet: receipt("cabinet"),
      },
    });

    expect(db.collectionMocks.migrationsRun.updateOne).toHaveBeenCalledWith(
      { _id: `2026-10-04-promote-fresh-reset-to-v2:${WORLD_ID}` },
      expect.objectContaining({
        $set: expect.objectContaining({
          worldId: WORLD_ID,
          sourceTurn: 1,
          actor: "release-operator",
        }),
      }),
      { upsert: true }
    );
  });

  it("does not write the completion marker if the world changes before activation", async () => {
    db.collection("gameState");
    db.collectionMocks.gameState.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    const deps = dependencies();

    await expect(
      promoteFreshResetToV2(db as unknown as Db, { apply: true, confirmWorld: WORLD_ID }, deps)
    ).rejects.toThrow("world changed before activation");

    expect(deps.order).toEqual(["metrics", "legislation", "cabinet"]);
    expect(db.collectionMocks.migrationsRun).toBeUndefined();
  });

  it("returns a no-op for an already promoted world", async () => {
    const deps = dependencies({
      status: "already-promoted",
      worldId: WORLD_ID,
      currentTurn: 3,
      reasons: [],
    });
    const result = await promoteFreshResetToV2(
      db as unknown as Db,
      { apply: true, confirmWorld: WORLD_ID },
      deps
    );
    expect(result.mode).toBe("no-op");
    expect(deps.order).toEqual([]);
  });
});
