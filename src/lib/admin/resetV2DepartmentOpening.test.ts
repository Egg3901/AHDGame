import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/admin/resetGameWorld", () => ({ resetGameWorld: vi.fn() }));
vi.mock("@/lib/admin/bootstrapGameWorld", () => ({ bootstrapGameWorld: vi.fn() }));
vi.mock("@/lib/admin/finalizeResetGameWorld", () => ({ finalizeResetGameWorld: vi.fn() }));
vi.mock("@/lib/maintenanceStatus", () => ({ enableMaintenanceMode: vi.fn() }));
vi.mock("@/lib/resetVersions/availability", () => ({
  RESET_V2_READY: { metrics: true, legislation: false, cabinet: true },
}));
vi.mock("@/lib/resetMetrics/seedOpening1991", () => ({ seedOpeningMetrics1991: vi.fn() }));
vi.mock("@/lib/resetFinance/seedOpeningDepartments1991", () => ({
  seedOpeningDepartmentBoards1991: vi.fn(),
}));

const metricsReceipt = {
  worldId: "new-world",
  revision: 1,
  sourceTurn: 1,
  completedAt: "2026-09-29T00:00:00.000Z",
  verificationHash: "metric-hash",
};
const departmentReceipt = {
  ...metricsReceipt,
  revision: 7,
  verificationHash: "department-hash",
};

describe("reset v2 Cabinet opening integration", () => {
  let db: MockDb;
  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { resetGameWorld } = await import("./resetGameWorld");
    const { bootstrapGameWorld } = await import("./bootstrapGameWorld");
    const { finalizeResetGameWorld } = await import("./finalizeResetGameWorld");
    const { seedOpeningMetrics1991 } = await import("@/lib/resetMetrics/seedOpening1991");
    const { seedOpeningDepartmentBoards1991 } =
      await import("@/lib/resetFinance/seedOpeningDepartments1991");
    vi.mocked(resetGameWorld).mockResolvedValue({ message: "reset", details: {} } as never);
    vi.mocked(bootstrapGameWorld).mockResolvedValue({} as never);
    vi.mocked(finalizeResetGameWorld).mockResolvedValue({
      demographicsReset: 0,
      customPartiesDeleted: 0,
      partyOrgRecordsDeleted: 0,
      budgetSeedLog: [],
    } as never);
    vi.mocked(seedOpeningMetrics1991).mockResolvedValue(metricsReceipt);
    vi.mocked(seedOpeningDepartmentBoards1991).mockResolvedValue(departmentReceipt);
    db.collection("gameState")
      .findOne.mockResolvedValueOnce({
        _id: "current",
        resetSystemSelections: { metrics: "v2", cabinet: "v2" },
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
        cabinetSystemVersion: "v2",
        resetVersionSeeds: { metrics: metricsReceipt },
      });
  });

  it("seeds metrics first and stamps Cabinet only after exact department readback", async () => {
    const { resetAndBootstrapGameWorld } = await import("./resetAndBootstrapGameWorld");
    const { seedOpeningDepartmentBoards1991 } =
      await import("@/lib/resetFinance/seedOpeningDepartments1991");
    await resetAndBootstrapGameWorld({
      db: db as unknown as Db,
      preset: "1991-default",
      skipDiagnostic: true,
      recordRunLog: false,
    });
    expect(seedOpeningDepartmentBoards1991).toHaveBeenCalledWith(db, "new-world", 1);
    expect(db.collectionMocks.gameState!.updateOne).toHaveBeenCalledWith(
      {
        _id: "current",
        resetWorldId: "new-world",
        currentTurn: 1,
        cabinetSystemVersion: "v2",
      },
      { $set: { "resetVersionSeeds.cabinet": departmentReceipt } }
    );
  });

  it("does not certify a failed Cabinet readback", async () => {
    const { enableMaintenanceMode } = await import("@/lib/maintenanceStatus");
    const { seedOpeningDepartmentBoards1991 } =
      await import("@/lib/resetFinance/seedOpeningDepartments1991");
    vi.mocked(seedOpeningDepartmentBoards1991).mockRejectedValue(
      new Error("department readback failed")
    );
    const { resetAndBootstrapGameWorld } = await import("./resetAndBootstrapGameWorld");
    await expect(
      resetAndBootstrapGameWorld({
        db: db as unknown as Db,
        preset: "1991-default",
        skipDiagnostic: true,
        recordRunLog: false,
      })
    ).rejects.toThrow("department readback failed");
    expect(
      db.collectionMocks.gameState!.updateOne.mock.calls.some(([, update]) =>
        Object.hasOwn(update?.$set ?? {}, "resetVersionSeeds.cabinet")
      )
    ).toBe(false);
    expect(enableMaintenanceMode).toHaveBeenCalled();
    expect(vi.mocked(enableMaintenanceMode).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(seedOpeningDepartmentBoards1991).mock.invocationCallOrder[0]
    );
  });

  it("refuses to stamp a receipt if the reset world changes during readback", async () => {
    db.collectionMocks.gameState!.updateOne.mockImplementation(async (_filter, update) => ({
      matchedCount: Object.hasOwn(update?.$set ?? {}, "resetVersionSeeds.cabinet") ? 0 : 1,
    }));
    const { resetAndBootstrapGameWorld } = await import("./resetAndBootstrapGameWorld");
    await expect(
      resetAndBootstrapGameWorld({
        db: db as unknown as Db,
        preset: "1991-default",
        skipDiagnostic: true,
        recordRunLog: false,
      })
    ).rejects.toThrow("Cabinet v2 world changed");
  });
});
