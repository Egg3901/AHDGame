import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const NOW = new Date("2026-06-01T12:00:00Z");

describe("ensureCampaignForCandidate", () => {
  let db: MockDb;
  let electionId: ObjectId;
  let candidateId: ObjectId;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("campaigns"); // pre-create the lazy collection mock
    electionId = new ObjectId();
    candidateId = new ObjectId();
  });

  it("creates a fresh active campaign when none exists", async () => {
    db.collectionMocks.campaigns!.findOne.mockResolvedValue(null);

    const { ensureCampaignForCandidate } = await import("./createInitialCampaign");
    const id = await ensureCampaignForCandidate({
      db: db as unknown as Db,
      electionId,
      candidateId,
      candidateIsNPP: false,
      party: "1",
      now: NOW,
    });

    expect(db.collectionMocks.campaigns!.insertOne).toHaveBeenCalledTimes(1);
    const inserted = db.collectionMocks.campaigns!.insertOne.mock.calls[0][0];
    expect(inserted.status).toBe("active");
    expect(inserted.electionId).toBe(electionId);
    expect(inserted.candidateId).toBe(candidateId);
    expect(id).toEqual(inserted._id);
  });

  it("reactivates an archived campaign for a re-active candidate", async () => {
    const existingId = new ObjectId();
    db.collectionMocks.campaigns!.findOne.mockResolvedValue({
      _id: existingId,
      status: "archived",
      archivedAt: new Date("2026-05-31T00:00:00Z"),
      archivedReason: "primary_loss",
    });

    const { ensureCampaignForCandidate } = await import("./createInitialCampaign");
    const id = await ensureCampaignForCandidate({
      db: db as unknown as Db,
      electionId,
      candidateId,
      candidateIsNPP: false,
      party: "1",
      now: NOW,
    });

    expect(db.collectionMocks.campaigns!.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.campaigns!.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = db.collectionMocks.campaigns!.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: existingId });
    expect(update.$set.status).toBe("active");
    expect(update.$set.archivedAt).toBeNull();
    expect(id).toEqual(existingId);
  });

  it("is a no-op when an active campaign already exists", async () => {
    const existingId = new ObjectId();
    db.collectionMocks.campaigns!.findOne.mockResolvedValue({
      _id: existingId,
      status: "active",
    });

    const { ensureCampaignForCandidate } = await import("./createInitialCampaign");
    const id = await ensureCampaignForCandidate({
      db: db as unknown as Db,
      electionId,
      candidateId,
      candidateIsNPP: false,
      party: "1",
      now: NOW,
    });

    expect(db.collectionMocks.campaigns!.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.campaigns!.updateOne).not.toHaveBeenCalled();
    expect(id).toEqual(existingId);
  });

  it("treats a legacy campaign with no status field as active (no-op)", async () => {
    const existingId = new ObjectId();
    db.collectionMocks.campaigns!.findOne.mockResolvedValue({ _id: existingId });

    const { ensureCampaignForCandidate } = await import("./createInitialCampaign");
    const id = await ensureCampaignForCandidate({
      db: db as unknown as Db,
      electionId,
      candidateId,
      candidateIsNPP: false,
      party: "1",
      now: NOW,
    });

    expect(db.collectionMocks.campaigns!.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.campaigns!.updateOne).not.toHaveBeenCalled();
    expect(id).toEqual(existingId);
  });
});

describe("createInitialCampaign", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("campaigns"); // pre-create the lazy collection mock
  });

  it("stamps new campaigns with status active", async () => {
    db.collectionMocks.campaigns!.findOne.mockResolvedValue(null);

    const { createInitialCampaign } = await import("./createInitialCampaign");
    await createInitialCampaign({
      db: db as unknown as Db,
      electionId: new ObjectId(),
      candidateId: new ObjectId(),
      candidateIsNPP: false,
      party: "2",
      now: NOW,
    });

    const inserted = db.collectionMocks.campaigns!.insertOne.mock.calls[0][0];
    expect(inserted.status).toBe("active");
  });
});
