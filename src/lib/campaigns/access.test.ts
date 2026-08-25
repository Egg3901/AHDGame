import { beforeEach, describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { isCampaignRunningMateUser } from "./access";
import type { Campaign } from "@/lib/db/types";

function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    _id: new ObjectId(),
    electionId: new ObjectId(),
    candidateId: new ObjectId(),
    candidateIsNPP: false,
    party: "1",
    ...overrides,
  } as Campaign;
}

describe("isCampaignRunningMateUser", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("returns false for NPP tickets without touching the DB", async () => {
    const campaign = makeCampaign({ candidateIsNPP: true });
    const result = await isCampaignRunningMateUser(
      db as unknown as Db,
      campaign,
      new ObjectId().toString()
    );
    expect(result).toBe(false);
    expect(db.collectionMocks.electionCandidates).toBeUndefined();
  });

  it("returns false when the ticket has no running mate", async () => {
    const campaign = makeCampaign();
    db.collection("electionCandidates").findOne.mockResolvedValue({ runningMateId: undefined });
    const result = await isCampaignRunningMateUser(
      db as unknown as Db,
      campaign,
      new ObjectId().toString()
    );
    expect(result).toBe(false);
  });

  it("returns true via the active-character fast path when the active char is the mate", async () => {
    const campaign = makeCampaign();
    const mateId = new ObjectId();
    db.collection("electionCandidates").findOne.mockResolvedValue({ runningMateId: mateId });
    const result = await isCampaignRunningMateUser(
      db as unknown as Db,
      campaign,
      new ObjectId().toString(),
      mateId
    );
    expect(result).toBe(true);
    // Fast path avoids the character-ownership lookup entirely; the characters
    // collection is never even accessed.
    expect(db.collectionMocks.characters).toBeUndefined();
  });

  it("returns true when the user owns the running mate character", async () => {
    const campaign = makeCampaign();
    const mateId = new ObjectId();
    const userId = new ObjectId();
    db.collection("electionCandidates").findOne.mockResolvedValue({ runningMateId: mateId });
    db.collection("characters").findOne.mockResolvedValue({ _id: mateId });
    const result = await isCampaignRunningMateUser(
      db as unknown as Db,
      campaign,
      userId.toString()
    );
    expect(result).toBe(true);
  });

  it("returns false when a different user does not own the running mate", async () => {
    const campaign = makeCampaign();
    const mateId = new ObjectId();
    db.collection("electionCandidates").findOne.mockResolvedValue({ runningMateId: mateId });
    db.collection("characters").findOne.mockResolvedValue(null);
    const result = await isCampaignRunningMateUser(
      db as unknown as Db,
      campaign,
      new ObjectId().toString()
    );
    expect(result).toBe(false);
  });
});
