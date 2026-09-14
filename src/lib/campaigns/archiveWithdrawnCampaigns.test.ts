import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const NOW = new Date("2026-09-14T12:00:00Z");

describe("archiveCampaignsForCandidates", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("campaigns"); // pre-create the lazy collection mock
  });

  it("archives active campaigns for the withdrawn candidates", async () => {
    db.collectionMocks.campaigns!.updateMany.mockResolvedValue({ modifiedCount: 2 });

    const { archiveCampaignsForCandidates } = await import("./archiveWithdrawnCampaigns");
    const electionId = new ObjectId();
    const archived = await archiveCampaignsForCandidates({
      db: db as unknown as Db,
      candidates: [
        { electionId, characterId: new ObjectId() },
        { electionId, characterId: new ObjectId(), isNPP: true, nppId: new ObjectId() },
      ],
      reason: "withdrawn",
      now: NOW,
    });

    expect(archived).toBe(2);
    expect(db.collectionMocks.campaigns!.updateMany).toHaveBeenCalledTimes(1);
    const [filter, update] = db.collectionMocks.campaigns!.updateMany.mock.calls[0];
    expect(filter.electionId).toBe(electionId);
    // NPP rows match by character id AND npp id (campaigns key either).
    expect(filter.candidateId.$in).toHaveLength(3);
    expect(filter.status).toEqual({ $ne: "archived" });
    expect(update.$set.status).toBe("archived");
    expect(update.$set.archivedReason).toBe("withdrawn");
    expect(update.$set.archivedAt).toBe(NOW);
  });

  it("fans out one update per election and no-ops on an empty batch", async () => {
    db.collectionMocks.campaigns!.updateMany.mockResolvedValue({ modifiedCount: 1 });

    const { archiveCampaignsForCandidates } = await import("./archiveWithdrawnCampaigns");
    const archived = await archiveCampaignsForCandidates({
      db: db as unknown as Db,
      candidates: [
        { electionId: new ObjectId(), characterId: new ObjectId() },
        { electionId: new ObjectId(), characterId: new ObjectId() },
      ],
      reason: "withdrawn",
      now: NOW,
    });

    expect(archived).toBe(2);
    expect(db.collectionMocks.campaigns!.updateMany).toHaveBeenCalledTimes(2);

    const empty = await archiveCampaignsForCandidates({
      db: db as unknown as Db,
      candidates: [],
      reason: "withdrawn",
      now: NOW,
    });
    expect(empty).toBe(0);
    expect(db.collectionMocks.campaigns!.updateMany).toHaveBeenCalledTimes(2);
  });
});
