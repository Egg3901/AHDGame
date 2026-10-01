import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/admin/resetGameWorld", () => ({ resetGameWorld: vi.fn() }));
vi.mock("@/lib/admin/bootstrapGameWorld", () => ({ bootstrapGameWorld: vi.fn() }));
vi.mock("@/lib/admin/finalizeResetGameWorld", () => ({ finalizeResetGameWorld: vi.fn() }));
vi.mock("@/lib/maintenanceStatus", () => ({ enableMaintenanceMode: vi.fn() }));
vi.mock("@/lib/resetVersions/availability", () => ({
  RESET_V2_READY: { metrics: true, legislation: true, cabinet: false },
}));
vi.mock("@/lib/resetMetrics/seedOpening1991", () => ({ seedOpeningMetrics1991: vi.fn() }));
vi.mock("@/lib/resetLegislation/seedOpening1991", () => ({ seedOpeningLawBoards1991: vi.fn() }));

const metricsReceipt = {
  worldId: "new-world",
  revision: 1,
  sourceTurn: 1,
  completedAt: "2026-09-29T00:00:00.000Z",
  verificationHash: "metric-hash",
};
const lawReceipt = { ...metricsReceipt, revision: 6, verificationHash: "law-hash" };

describe("reset v2 current-law opening integration", () => {
  let db: MockDb;
  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { resetGameWorld } = await import("./resetGameWorld");
    const { bootstrapGameWorld } = await import("./bootstrapGameWorld");
    const { finalizeResetGameWorld } = await import("./finalizeResetGameWorld");
    const { seedOpeningMetrics1991 } = await import("@/lib/resetMetrics/seedOpening1991");
    const { seedOpeningLawBoards1991 } = await import("@/lib/resetLegislation/seedOpening1991");
    vi.mocked(resetGameWorld).mockResolvedValue({ message: "reset", details: {} } as never);
    vi.mocked(bootstrapGameWorld).mockResolvedValue({} as never);
    vi.mocked(finalizeResetGameWorld).mockResolvedValue({
      demographicsReset: 0,
      customPartiesDeleted: 0,
      partyOrgRecordsDeleted: 0,
      finalizeLog: [],
    } as never);
    vi.mocked(seedOpeningMetrics1991).mockResolvedValue(metricsReceipt);
    vi.mocked(seedOpeningLawBoards1991).mockResolvedValue(lawReceipt);
    db.collection("gameState")
      .findOne.mockResolvedValueOnce({
        _id: "current",
        resetSystemSelections: { metrics: "v2", legislation: "v2" },
      })
      .mockResolvedValueOnce({
        _id: "current",
        resetWorldId: "new-world",
        currentTurn: 1,
        metricsSystemVersion: "v2",
      })
      .mockResolvedValueOnce({
        _id: "current",
        resetWorldId: "new-world",
        currentTurn: 1,
        metricsSystemVersion: "v2",
        legislationSystemVersion: "v2",
        resetVersionSeeds: { metrics: metricsReceipt },
      });
  });

  it("verifies metrics first, then current law, before stamping each receipt", async () => {
    const { resetAndBootstrapGameWorld } = await import("./resetAndBootstrapGameWorld");
    const { seedOpeningMetrics1991 } = await import("@/lib/resetMetrics/seedOpening1991");
    const { seedOpeningLawBoards1991 } = await import("@/lib/resetLegislation/seedOpening1991");
    await resetAndBootstrapGameWorld({
      db: db as unknown as Db,
      preset: "1991-default",
      skipDiagnostic: true,
      recordRunLog: false,
    });
    expect(seedOpeningMetrics1991).toHaveBeenCalledWith(db, "new-world", 1);
    expect(seedOpeningLawBoards1991).toHaveBeenCalledWith(db, "new-world", 1);
    expect(db.collectionMocks.gameState!.updateOne).toHaveBeenCalledWith(
      {
        _id: "current",
        resetWorldId: "new-world",
        currentTurn: 1,
        legislationSystemVersion: "v2",
      },
      { $set: { "resetVersionSeeds.legislation": lawReceipt } }
    );
  });

  it("does not stamp law activation if its persisted readback fails", async () => {
    const { seedOpeningLawBoards1991 } = await import("@/lib/resetLegislation/seedOpening1991");
    vi.mocked(seedOpeningLawBoards1991).mockRejectedValue(new Error("law readback failed"));
    const { resetAndBootstrapGameWorld } = await import("./resetAndBootstrapGameWorld");
    await expect(
      resetAndBootstrapGameWorld({
        db: db as unknown as Db,
        preset: "1991-default",
        skipDiagnostic: true,
        recordRunLog: false,
      })
    ).rejects.toThrow("law readback failed");
    expect(
      db.collectionMocks.gameState!.updateOne.mock.calls.some(([, update]) =>
        Object.hasOwn(update?.$set ?? {}, "resetVersionSeeds.legislation")
      )
    ).toBe(false);
  });
});
