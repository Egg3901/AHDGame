import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

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

describe("POST /api/campaigns/[id]/suspend-endorse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("suspends the nominee campaign and records the endorsement target", async () => {
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
});
