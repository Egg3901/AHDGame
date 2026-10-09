import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("./bootstrapGameWorld", () => ({ bootstrapGameWorld: vi.fn(async () => ({})) }));
vi.mock("./finalizeResetGameWorld", () => ({
  finalizeResetGameWorld: vi.fn(async () => ({ adminDetails: "Recovered bootstrap" })),
}));
vi.mock("./seedDiagnostic", () => ({
  runSeedDiagnostic: vi.fn(async () => ({ summary: { critical: 0, warn: 0, ok: 1 }, checks: [] })),
  captureSeedBaseline: vi.fn(async () => {}),
  formatDiagnosticSummary: vi.fn(() => "healthy"),
}));
vi.mock("@/lib/npp/seedPartylessFoundingCandidates", () => ({
  seedPartylessFoundingCandidates: vi.fn(async () => ({ nppsCreated: 1, byCountry: { US: 1 } })),
}));

const { preview1991BootstrapRecovery, recover1991Bootstrap } =
  await import("./recover1991Bootstrap");
const { bootstrapGameWorld } = await import("./bootstrapGameWorld");
const { captureSeedBaseline } = await import("./seedDiagnostic");
const runId = "507f1f77bcf86cd799439011";
let db: MockDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("gameState").findOne.mockResolvedValue({
    _id: "current",
    preset: "1991-default",
    currentTurn: 1,
    currentYear: 1991,
    startingPartiesMode: "none",
    isActive: false,
    isProcessing: false,
    nextScheduledTurn: null,
  });
  db.collection("gameConfig").findOne.mockResolvedValue({
    _id: "default",
    maintenanceMode: "full",
    lastReset: { runId, status: "failed", phaseReached: "build" },
  });
  db.collection("adminLogs").findOne.mockResolvedValue({
    resetRun: {
      runId,
      preset: "1991-default",
      mode: "historical",
      status: "failed",
      phaseReached: "build",
      logTail: [
        'Reset ABORTED in build: Fresh vehicle-model seed preflight requires empty economic collections: {"unownedSectors":2791}',
      ],
    },
  });
  db.collection("unownedSectors").countDocuments.mockResolvedValue(2791);
});

describe("1991 bootstrap recovery", () => {
  it("previews the failed build without changing archives or world data", async () => {
    const plan = await preview1991BootstrapRecovery(db as unknown as Db, runId);
    expect(plan).toMatchObject({ ready: true, runId, unownedSectors: 2791 });
    expect(bootstrapGameWorld).not.toHaveBeenCalled();
    for (const collection of Object.values(db.collectionMocks)) {
      expect(collection.updateOne).not.toHaveBeenCalled();
      expect(collection.deleteMany).not.toHaveBeenCalled();
    }
  });

  it.each([
    "characters",
    "elections",
    "npps",
    "electedOfficials",
    "corporations",
    "corporateSectors",
    "unions",
    "indexFunds",
    "indexFundPositions",
  ])("refuses to overwrite newly created %s", async (collection) => {
    db.collection(collection).countDocuments.mockResolvedValue(1);
    await expect(
      recover1991Bootstrap(db as unknown as Db, { runId, adminUsername: "operator" })
    ).rejects.toThrow("not empty");
    expect(bootstrapGameWorld).not.toHaveBeenCalled();
    expect(db.collectionMocks.unownedSectors.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses a stale run id or a running world", async () => {
    await expect(preview1991BootstrapRecovery(db as unknown as Db, "other-run")).rejects.toThrow();
    db.collection("gameState").findOne.mockResolvedValue({
      preset: "1991-default",
      currentTurn: 2,
      isActive: true,
    });
    await expect(preview1991BootstrapRecovery(db as unknown as Db, runId)).rejects.toThrow();
  });

  it("claims the exact failed run and completes build, finalize and audit without teardown", async () => {
    const result = await recover1991Bootstrap(db as unknown as Db, {
      runId,
      adminUsername: "operator",
    });
    expect(result.status).toBe("succeeded");
    expect(bootstrapGameWorld).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: "1991-default",
        startingParties: "none",
        resetReference: true,
        preIteration: true,
      })
    );
    expect(db.collectionMocks.gameConfig.updateOne.mock.calls[0]?.[0]).toMatchObject({
      "lastReset.runId": runId,
      "lastReset.status": "failed",
      "lastReset.phaseReached": "build",
    });
    expect(db.collectionMocks.unownedSectors.deleteMany).toHaveBeenCalledOnce();
    expect(captureSeedBaseline).toHaveBeenCalledOnce();
    expect(db.collectionMocks.characters.deleteMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.elections.deleteMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.retiredCharacters).toBeUndefined();
  });

  it("refuses a competing recovery before cleanup", async () => {
    db.collection("gameConfig").updateOne.mockResolvedValue({ matchedCount: 0 });
    await expect(
      recover1991Bootstrap(db as unknown as Db, { runId, adminUsername: "operator" })
    ).rejects.toThrow("claimed");
    expect(db.collectionMocks.unownedSectors.deleteMany).not.toHaveBeenCalled();
  });
  it.each([
    { isActive: true },
    { isProcessing: true },
    { currentTurn: 2 },
    { nextScheduledTurn: new Date() },
    { startingPartiesMode: "default" },
  ])("refuses changed world guards %o", async (changed) => {
    const state = await db.collection("gameState").findOne();
    db.collection("gameState").findOne.mockResolvedValue({ ...state, ...changed });
    await expect(
      recover1991Bootstrap(db as unknown as Db, { runId, adminUsername: "operator" })
    ).rejects.toThrow("sealed inactive");
    expect(bootstrapGameWorld).not.toHaveBeenCalled();
    expect(db.collectionMocks.unownedSectors.deleteMany).not.toHaveBeenCalled();
  });

  it("releases the recovery claim if its audit insert fails before cleanup", async () => {
    db.collection("adminLogs").insertOne.mockRejectedValue(new Error("audit unavailable"));
    await expect(
      recover1991Bootstrap(db as unknown as Db, { runId, adminUsername: "operator" })
    ).rejects.toThrow("audit unavailable");
    expect(db.collectionMocks.unownedSectors.deleteMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.gameConfig.updateOne.mock.calls.at(-1)?.[1]).toMatchObject({
      $set: { "lastReset.status": "failed" },
    });
  });

  it("refuses a later partial bootstrap failure outside the known preflight", async () => {
    db.collection("adminLogs").findOne.mockResolvedValue({
      resetRun: {
        runId,
        preset: "1991-default",
        mode: "historical",
        status: "failed",
        phaseReached: "build",
        logTail: ["Reset ABORTED in build: later seed failed"],
      },
    });
    await expect(
      recover1991Bootstrap(db as unknown as Db, { runId, adminUsername: "operator" })
    ).rejects.toThrow("vehicle-preflight");
    expect(bootstrapGameWorld).not.toHaveBeenCalled();
    expect(db.collectionMocks.unownedSectors.deleteMany).not.toHaveBeenCalled();
  });
});
