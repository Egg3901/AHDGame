import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const NOW = new Date("2026-06-01T12:00:00Z");

function makeCursor<T>(data: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(data),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("selfHealMissingCampaigns", () => {
  let db: MockDb;
  const presElectionId = new ObjectId();
  const ukElectionId = new ObjectId();
  const haveCampaignChar = new ObjectId();
  const missingCampaignChar = new ObjectId();
  const ukChar = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();

    db.collection("electionCandidates");
    db.collection("elections");
    db.collection("campaigns");

    // Two active candidates in an eligible US president election; one in an
    // ineligible UK commons race.
    db.collectionMocks.electionCandidates!.find.mockReturnValue(
      makeCursor([
        {
          electionId: presElectionId,
          characterId: haveCampaignChar,
          isNPP: false,
          party: "1",
          status: "active",
        },
        {
          electionId: presElectionId,
          characterId: missingCampaignChar,
          isNPP: false,
          party: "2",
          status: "active",
        },
        {
          electionId: ukElectionId,
          characterId: ukChar,
          isNPP: false,
          party: "3",
          status: "active",
        },
      ])
    );

    db.collectionMocks.elections!.find.mockReturnValue(
      makeCursor([
        { _id: presElectionId, countryId: "US", electionType: "president" },
        { _id: ukElectionId, countryId: "UK", electionType: "commons" },
      ])
    );

    // Only haveCampaignChar already has a campaign.
    db.collectionMocks.campaigns!.findOne.mockImplementation((query?: unknown) => {
      const candidateId = (query as { candidateId?: ObjectId })?.candidateId;
      if (candidateId && candidateId.toString() === haveCampaignChar.toString()) {
        return Promise.resolve({ _id: new ObjectId(), status: "active" });
      }
      return Promise.resolve(null);
    });
  });

  it("creates campaigns only for active candidates in eligible elections that lack one", async () => {
    const { selfHealMissingCampaigns } = await import("./selfHealCampaigns");
    const healed = await selfHealMissingCampaigns(db as unknown as Db, NOW);

    // One created (missingCampaignChar). haveCampaignChar = no-op. UK = ineligible, skipped.
    expect(db.collectionMocks.campaigns!.insertOne).toHaveBeenCalledTimes(1);
    const inserted = db.collectionMocks.campaigns!.insertOne.mock.calls[0][0];
    expect(inserted.candidateId).toEqual(missingCampaignChar);
    expect(inserted.electionId).toEqual(presElectionId);
    expect(inserted.status).toBe("active");
    expect(healed).toBe(1);
  });

  it("does nothing when there are no active candidates", async () => {
    db.collectionMocks.electionCandidates!.find.mockReturnValue(makeCursor([]));
    const { selfHealMissingCampaigns } = await import("./selfHealCampaigns");
    const healed = await selfHealMissingCampaigns(db as unknown as Db, NOW);
    expect(db.collectionMocks.campaigns!.insertOne).not.toHaveBeenCalled();
    expect(healed).toBe(0);
  });
});
