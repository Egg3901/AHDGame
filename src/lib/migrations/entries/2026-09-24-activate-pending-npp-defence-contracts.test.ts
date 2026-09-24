import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { createAsyncIterableCursor, createMockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-09-24-activate-pending-npp-defence-contracts";

describe("2026-09-24-activate-pending-npp-defence-contracts", () => {
  it("activates pending contracts only for true NPP-owned corporations", async () => {
    const db = createMockDb();
    const nppCorpId = new ObjectId();
    const caretakerCorpId = new ObjectId();
    db.collection("corporations").find.mockReturnValue(
      createAsyncIterableCursor([
        { _id: nppCorpId, ceoType: "npp" },
        {
          _id: caretakerCorpId,
          ceoType: "npp",
          caretakerCeo: { underlyingUserId: new ObjectId() },
        },
      ])
    );
    db.collection("defenceContracts").updateMany.mockResolvedValue({
      matchedCount: 2,
      modifiedCount: 2,
    });

    const result = await migration.execute(db as never, { dryRun: false });

    expect(db.collectionMocks.corporations.find).toHaveBeenCalledWith({ ceoType: "npp" });
    expect(db.collectionMocks.defenceContracts.updateMany).toHaveBeenCalledWith(
      { status: "pending", corporationId: { $in: [nppCorpId] } },
      { $set: { status: "active", updatedAt: expect.any(Date) } }
    );
    expect(result).toMatchObject({ documentsScanned: 2, documentsUpdated: 2 });
  });

  it("reports legacy pending contracts without writing during a dry run", async () => {
    const db = createMockDb();
    const nppCorpId = new ObjectId();
    db.collection("corporations").find.mockReturnValue(
      createAsyncIterableCursor([{ _id: nppCorpId, ceoType: "npp" }])
    );
    db.collection("defenceContracts").countDocuments.mockResolvedValue(3);

    const result = await migration.execute(db as never, { dryRun: true });

    expect(db.collectionMocks.defenceContracts.countDocuments).toHaveBeenCalledWith({
      status: "pending",
      corporationId: { $in: [nppCorpId] },
    });
    expect(db.collectionMocks.defenceContracts.updateMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ documentsScanned: 3, documentsUpdated: 0 });
  });

  it("does not inspect or update contracts when every NPP manager is a caretaker", async () => {
    const db = createMockDb();
    db.collection("corporations").find.mockReturnValue(
      createAsyncIterableCursor([
        {
          _id: new ObjectId(),
          ceoType: "npp",
          caretakerCeo: { underlyingUserId: new ObjectId() },
        },
      ])
    );

    const result = await migration.execute(db as never, { dryRun: false });

    expect(db.collectionMocks.defenceContracts).toBeUndefined();
    expect(result).toMatchObject({ documentsScanned: 0, documentsUpdated: 0 });
  });
});
