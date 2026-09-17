import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { CAMPAIGN_ACTIVITY_HISTORY_CAP } from "@/lib/campaigns/constants/activityHistory";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireHumanSessionWithCharacter: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({ currentTurn: 200 }),
}));
vi.mock("@/lib/campaigns/access", () => ({
  isCampaignNomineeUser: vi.fn().mockResolvedValue(true),
}));

let db: MockDb;

const mockUserId = new ObjectId();
const mockCharacterId = new ObjectId();
const mockCampaignId = new ObjectId();
const mockElectionId = new ObjectId();
const ownCandidateId = new ObjectId();
const endorsedCandidateId = new ObjectId();

function makeMockUser() {
  return {
    userId: mockUserId.toString(),
    username: "testuser",
    email: "test@example.com",
    role: "user",
    isAdmin: false,
    hasCharacter: true,
    character: {
      _id: mockCharacterId,
      name: "Test Nominee",
      countryId: "US",
      actions: 10,
      funds: 100_000,
    },
  };
}

function makeRequest(candidateId: string) {
  return new Request(
    `http://localhost/api/campaigns/${mockCampaignId.toString()}/suspend-endorse`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId }),
    }
  );
}

/**
 * Wire up an active presidential nominee whose campaign can be suspended, with
 * a valid endorsement target. Shared so each test asserts on one write rather
 * than restating the whole fixture.
 */
async function setUpSuspendableCampaign() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireHumanSessionWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireHumanSessionWithCharacter).mockResolvedValue({
    ok: true,
    user: makeMockUser(),
  } as never);

  db.collection("gameState");
  db.collection("campaigns");
  db.collection("elections");
  db.collection("electionCandidates");
  db.collection("playerEndorsements");

  db.collectionMocks.gameState!.findOne.mockResolvedValue({ _id: "current", currentTurn: 42 });

  db.collectionMocks.campaigns!.findOne.mockResolvedValue({
    _id: mockCampaignId,
    electionId: mockElectionId,
    candidateId: mockCharacterId,
    candidateIsNPP: false,
    status: "active",
  });
  db.collectionMocks.elections!.findOne.mockResolvedValue({
    _id: mockElectionId,
    electionType: "president",
    status: "active",
    countryId: "US",
    primaryEndTurn: 100,
    endTurn: 300,
  });
  db.collectionMocks
    .electionCandidates!.findOne.mockResolvedValueOnce({
      _id: ownCandidateId,
      electionId: mockElectionId,
      characterId: mockCharacterId,
      status: "active",
      campaignSuspended: false,
    })
    .mockResolvedValueOnce({
      _id: endorsedCandidateId,
      electionId: mockElectionId,
      characterId: new ObjectId(),
      characterName: "Endorsed Nominee",
      status: "active",
    });
  db.collectionMocks.electionCandidates!.updateOne.mockResolvedValue({ modifiedCount: 1 });
  db.collectionMocks.campaigns!.updateOne.mockResolvedValue({ modifiedCount: 1 });
}

describe("POST /api/campaigns/[id]/suspend-endorse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("suspends the nominee campaign and records the endorsement target", async () => {
    await setUpSuspendableCampaign();

    const { POST } = await import("./route");
    const res = await POST(makeRequest(endorsedCandidateId.toString()), {
      params: Promise.resolve({ id: mockCampaignId.toString() }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.endorsedCandidateName).toBe("Endorsed Nominee");
    expect(db.collectionMocks.electionCandidates!.updateOne).toHaveBeenCalledWith(
      { _id: ownCandidateId },
      expect.objectContaining({
        $set: expect.objectContaining({
          campaignSuspended: true,
          endorsedElectionCandidateId: endorsedCandidateId,
          rallyTourActive: false,
        }),
      })
    );
    // Ticket #948: the suspend-endorse also registers a counted player endorsement
    // so it feeds the endorsee's tally + per-turn campaign-action grant.
    expect(db.collectionMocks.playerEndorsements!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: mockCharacterId,
        electionId: mockElectionId,
        candidateId: endorsedCandidateId,
        isActive: true,
      })
    );
  });

  it("caps the activity entry it pushes at the shared history cap", async () => {
    await setUpSuspendableCampaign();

    const { POST } = await import("./route");
    await POST(makeRequest(endorsedCandidateId.toString()), {
      params: Promise.resolve({ id: mockCampaignId.toString() }),
    });

    const update = db.collectionMocks.campaigns!.updateOne.mock.calls[0][1] as {
      $push: { activityHistory: { $each: unknown[]; $slice: number } };
    };
    // This writer pushed uncapped, so a player toggling suspend-endorse grew
    // the array without bound. It now slices to the same cap as the upgrade,
    // reset and insolvency-downgrade writers.
    expect(update.$push.activityHistory.$slice).toBe(-CAMPAIGN_ACTIVITY_HISTORY_CAP);
    expect(update.$push.activityHistory.$each).toHaveLength(1);
  });
});
