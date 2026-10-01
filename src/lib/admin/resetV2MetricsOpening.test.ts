import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/admin/resetGameWorld", () => ({ resetGameWorld: vi.fn() }));
vi.mock("@/lib/admin/bootstrapGameWorld", () => ({ bootstrapGameWorld: vi.fn() }));
vi.mock("@/lib/admin/finalizeResetGameWorld", () => ({ finalizeResetGameWorld: vi.fn() }));
vi.mock("@/lib/maintenanceStatus", () => ({ enableMaintenanceMode: vi.fn() }));
vi.mock("@/lib/resetVersions/availability", () => ({
  RESET_V2_READY: { metrics: true, legislation: false, cabinet: false },
}));
vi.mock("@/lib/resetMetrics/seedOpening1991", () => ({ seedOpeningMetrics1991: vi.fn() }));

const teardown = {
  message: "reset done",
  details: { demographicsReset: 0, customPartiesDeleted: 0, partyOrgRecordsDeleted: 0 },
};
const finalized = {
  demographicsReset: 0,
  customPartiesDeleted: 0,
  partyOrgRecordsDeleted: 0,
  finalizeLog: [],
  adminDetails: "reset done",
};
const receipt = {
  worldId: "new-world",
  revision: 1,
  sourceTurn: 1,
  completedAt: "2026-09-29T00:00:00.000Z",
  verificationHash: "verified",
};

describe("reset v2 metric opening integration", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { resetGameWorld } = await import("./resetGameWorld");
    const { bootstrapGameWorld } = await import("./bootstrapGameWorld");
    const { finalizeResetGameWorld } = await import("./finalizeResetGameWorld");
    const { seedOpeningMetrics1991 } = await import("@/lib/resetMetrics/seedOpening1991");
    vi.mocked(resetGameWorld).mockResolvedValue(teardown as never);
    vi.mocked(bootstrapGameWorld).mockResolvedValue({} as never);
    vi.mocked(finalizeResetGameWorld).mockResolvedValue(finalized as never);
    vi.mocked(seedOpeningMetrics1991).mockResolvedValue(receipt);
  });

  it("leaves a v1 reset free of any v2 metric writes", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      resetSystemSelections: { metrics: "v1" },
    });
    const { resetAndBootstrapGameWorld } = await import("./resetAndBootstrapGameWorld");
    const { seedOpeningMetrics1991 } = await import("@/lib/resetMetrics/seedOpening1991");
    await resetAndBootstrapGameWorld({
      db: db as unknown as Db,
      preset: "1991-default",
      skipDiagnostic: true,
      recordRunLog: false,
    });
    expect(seedOpeningMetrics1991).not.toHaveBeenCalled();
    expect(
      db.collectionMocks.gameState!.updateOne.mock.calls.some(([, update]) =>
        Object.hasOwn(update?.$set ?? {}, "resetVersionSeeds.metrics")
      )
    ).toBe(false);
  });

  it("stamps a receipt only after v2 seed readback succeeds", async () => {
    db.collection("gameState")
      .findOne.mockResolvedValueOnce({
        _id: "current",
        resetSystemSelections: { metrics: "v2" },
      })
      .mockResolvedValueOnce({
        _id: "current",
        metricsSystemVersion: "v2",
        resetWorldId: "new-world",
        currentTurn: 1,
      });
    const { resetAndBootstrapGameWorld } = await import("./resetAndBootstrapGameWorld");
    const { seedOpeningMetrics1991 } = await import("@/lib/resetMetrics/seedOpening1991");
    await resetAndBootstrapGameWorld({
      db: db as unknown as Db,
      preset: "1991-default",
      skipDiagnostic: true,
      recordRunLog: false,
    });
    expect(seedOpeningMetrics1991).toHaveBeenCalledWith(db, "new-world", 1);
    expect(db.collectionMocks.gameState!.updateOne).toHaveBeenCalledWith(
      {
        _id: "current",
        resetWorldId: "new-world",
        currentTurn: 1,
        metricsSystemVersion: "v2",
      },
      { $set: { "resetVersionSeeds.metrics": receipt } }
    );
  });

  it("leaves the world sealed and unstamped when v2 readback fails", async () => {
    db.collection("gameState")
      .findOne.mockResolvedValueOnce({
        _id: "current",
        resetSystemSelections: { metrics: "v2" },
      })
      .mockResolvedValueOnce({
        _id: "current",
        metricsSystemVersion: "v2",
        resetWorldId: "new-world",
        currentTurn: 1,
      });
    const { seedOpeningMetrics1991 } = await import("@/lib/resetMetrics/seedOpening1991");
    vi.mocked(seedOpeningMetrics1991).mockRejectedValue(new Error("readback failed"));
    const { resetAndBootstrapGameWorld } = await import("./resetAndBootstrapGameWorld");
    await expect(
      resetAndBootstrapGameWorld({
        db: db as unknown as Db,
        preset: "1991-default",
        skipDiagnostic: true,
        recordRunLog: false,
      })
    ).rejects.toThrow("readback failed");
    expect(
      db.collectionMocks.gameState!.updateOne.mock.calls.some(([, update]) =>
        Object.hasOwn(update?.$set ?? {}, "resetVersionSeeds.metrics")
      )
    ).toBe(false);
  });
});
