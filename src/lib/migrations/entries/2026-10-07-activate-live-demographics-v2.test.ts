import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyDemographicsV2Opening } from "@/lib/demographics/v2/verifyOpening";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-10-07-activate-live-demographics-v2";

vi.mock("@/lib/demographics/v2/verifyOpening", () => ({
  verifyDemographicsV2Opening: vi.fn(),
}));

const receipt = {
  worldId: "world-live",
  revision: 1,
  sourceTurn: 77,
  completedAt: "2026-10-07T12:00:00.000Z",
  verificationHash: "verified",
  countries: ["US", "UK", "JP"],
};

function state(overrides: Record<string, unknown> = {}) {
  return {
    _id: "current",
    currentTurn: 77,
    isActive: true,
    resetWorldId: "world-live",
    demographicsSystemVersion: "v1",
    resetSystemSelections: { demographics: "v1" },
    ...overrides,
  };
}

describe(migration.id, () => {
  beforeEach(() => {
    vi.mocked(verifyDemographicsV2Opening).mockReset().mockResolvedValue(receipt);
  });

  it("verifies the active substrate without writing during a dry run", async () => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue(state());

    const result = await migration.execute(db as unknown as Db, { dryRun: true });

    expect(verifyDemographicsV2Opening).toHaveBeenCalledWith(db, "world-live", 77);
    expect(db.collectionMocks.gameState.updateOne).not.toHaveBeenCalled();
    expect(result).toMatchObject({ documentsScanned: 1, documentsUpdated: 0 });
    expect(result.notes?.[0]).toContain("DRY RUN");
  });

  it("atomically installs the receipt and both current and next-reset selections", async () => {
    const db = createMockDb();
    db.collection("gameState")
      .findOne.mockResolvedValueOnce(state())
      .mockResolvedValueOnce(
        state({
          demographicsSystemVersion: "v2",
          resetVersionSeeds: { demographics: receipt },
          resetSystemSelections: { metrics: "v1", demographics: "v2" },
        })
      );
    db.collection("gameState").updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    expect(db.collectionMocks.gameState.updateOne).toHaveBeenCalledOnce();
    const [filter, update] = db.collectionMocks.gameState.updateOne.mock.calls[0];
    expect(filter).toEqual({
      _id: "current",
      isActive: true,
      currentTurn: 77,
      resetWorldId: "world-live",
    });
    expect(update.$set).toMatchObject({
      demographicsSystemVersion: "v2",
      "resetVersionSeeds.demographics": receipt,
      "resetSystemSelections.demographics": "v2",
    });
    expect(update.$set.demographicsSystemVersionBy).toContain(migration.id);
    expect(result).toMatchObject({ documentsScanned: 1, documentsUpdated: 1 });
  });

  it("is a no-op when the current world and next reset already resolve to v2", async () => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue(
      state({
        demographicsSystemVersion: "v2",
        resetVersionSeeds: { demographics: receipt },
        resetSystemSelections: { demographics: "v2" },
      })
    );

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    expect(verifyDemographicsV2Opening).not.toHaveBeenCalled();
    expect(db.collectionMocks.gameState.updateOne).not.toHaveBeenCalled();
    expect(result.documentsUpdated).toBe(0);
  });

  it("refuses to promote an inactive world", async () => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue(state({ isActive: false }));

    await expect(migration.execute(db as unknown as Db, { dryRun: false })).rejects.toThrow(
      "requires the current world to be active"
    );
    expect(verifyDemographicsV2Opening).not.toHaveBeenCalled();
  });

  it("refuses to invent a reset identity for a legacy world", async () => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue(state({ resetWorldId: undefined }));

    await expect(migration.execute(db as unknown as Db, { dryRun: false })).rejects.toThrow(
      "requires an existing reset world identity"
    );
    expect(verifyDemographicsV2Opening).not.toHaveBeenCalled();
  });

  it("fails closed when the world advances during verification", async () => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue(state());
    db.collection("gameState").updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

    await expect(migration.execute(db as unknown as Db, { dryRun: false })).rejects.toThrow(
      "changed during Demographics v2 verification"
    );
  });
});
