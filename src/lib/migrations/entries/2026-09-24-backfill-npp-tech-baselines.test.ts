import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { autoGrantedNodeIds } from "@/lib/constants/techTree";
import { createAsyncIterableCursor, createMockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-09-24-backfill-npp-tech-baselines";

describe("2026-09-24-backfill-npp-tech-baselines", () => {
  it("adds only missing baseline nodes to true NPP-owned corporations", async () => {
    const db = createMockDb();
    const nppCorpId = new ObjectId();
    const caretakerCorpId = new ObjectId();
    const baseline = autoGrantedNodeIds("manufacturing", 2020);
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 2020,
      currentTurn: 1,
      startingYear: 2019,
    });
    db.collection("corporations").find.mockReturnValue(
      createAsyncIterableCursor([
        {
          _id: nppCorpId,
          type: "manufacturing",
          ceoType: "npp",
          unlockedTechNodeIds: [baseline[0]],
        },
        {
          _id: caretakerCorpId,
          type: "manufacturing",
          ceoType: "npp",
          caretakerCeo: { underlyingUserId: new ObjectId() },
          unlockedTechNodeIds: [],
        },
      ])
    );
    db.collection("corporations").bulkWrite.mockResolvedValue({ modifiedCount: 1 });

    const result = await migration.execute(db as never, { dryRun: false });

    expect(db.collectionMocks.corporations.bulkWrite).toHaveBeenCalledOnce();
    const operations = db.collectionMocks.corporations.bulkWrite.mock.calls[0][0];
    expect(operations).toHaveLength(1);
    expect(operations[0].updateOne.filter).toEqual({ _id: nppCorpId });
    expect(operations[0].updateOne.update.$addToSet.unlockedTechNodeIds.$each).toEqual(
      baseline.slice(1)
    );
    expect(result).toMatchObject({ documentsScanned: 1, documentsUpdated: 1 });
  });

  it("reports needed updates without writing during a dry run", async () => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 2020,
    });
    db.collection("corporations").find.mockReturnValue(
      createAsyncIterableCursor([
        {
          _id: new ObjectId(),
          type: "energy",
          ceoType: "npp",
          unlockedTechNodeIds: [],
        },
      ])
    );

    const result = await migration.execute(db as never, { dryRun: true });

    expect(db.collectionMocks.corporations.bulkWrite).not.toHaveBeenCalled();
    expect(result).toMatchObject({ documentsScanned: 1, documentsUpdated: 0 });
    expect(result.notes?.[0]).toContain("1 NPP corporation(s)");
  });

  it("does not write when all baseline prerequisites are already present", async () => {
    const db = createMockDb();
    const baseline = autoGrantedNodeIds("energy", 2020);
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 2020,
    });
    db.collection("corporations").find.mockReturnValue(
      createAsyncIterableCursor([
        {
          _id: new ObjectId(),
          type: "energy",
          ceoType: "npp",
          unlockedTechNodeIds: baseline,
        },
      ])
    );

    const result = await migration.execute(db as never, { dryRun: false });

    expect(db.collectionMocks.corporations.bulkWrite).not.toHaveBeenCalled();
    expect(result).toMatchObject({ documentsScanned: 1, documentsUpdated: 0 });
  });
});
