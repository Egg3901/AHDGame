import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));

let db: MockDb;

const mockUserId = new ObjectId();
const mockActiveCharacterId = new ObjectId();
const mockCandidateId = new ObjectId();
const mockCampaignId = new ObjectId();

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    userId: mockUserId.toString(),
    username: "tester",
    email: "tester@example.com",
    role: "user",
    isAdmin: false,
    hasCharacter: true,
    character: {
      _id: mockActiveCharacterId,
      userId: mockUserId,
      name: "Active Profile",
      countryId: "US",
      party: "1",
    },
    ...overrides,
  };
}

function makeCampaign(overrides: Record<string, unknown> = {}) {
  return {
    _id: mockCampaignId,
    electionId: new ObjectId(),
    candidateId: mockCandidateId,
    candidateIsNPP: false,
    party: "1",
    managerId: null,
    managerCharacterId: null,
    funds: 0,
    actions: 0,
    fundraisingLevel: 0,
    oppositionResearchLevel: 0,
    groundGameLevel: 0,
    mediaSpendingLevel: 0,
    oppositionTargetId: null,
    oppositionTargetName: null,
    oppositionResearchCooldownUntil: null,
    donationLog: [],
    publicFogOfWar: {
      fundraisingLevel: 0,
      oppositionResearchLevel: 0,
      groundGameLevel: 0,
      mediaSpendingLevel: 0,
      lastUpdated: new Date(),
    },
    partyFogOfWar: {
      fundraisingLevel: 0,
      oppositionResearchLevel: 0,
      groundGameLevel: 0,
      mediaSpendingLevel: 0,
      lastUpdated: new Date(),
    },
    activityHistory: [],
    totalFundsGenerated: 0,
    totalFundsSpent: 0,
    totalActionsGenerated: 0,
    totalActionsSpent: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRequest(color: string | null) {
  return new Request(`http://localhost/api/campaigns/${mockCampaignId.toString()}/color`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ color }),
  });
}

async function setup() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({ ok: true, user: makeUser() } as any);

  db.collection("campaigns");
  db.collection("characters");
  db.collection("elections");

  db.collectionMocks["campaigns"]!.findOne.mockResolvedValue(makeCampaign());
  db.collectionMocks["campaigns"]!.updateOne.mockResolvedValue({
    matchedCount: 1,
    modifiedCount: 1,
  });
  db.collectionMocks["elections"]!.findOne.mockResolvedValue({ countryId: "US" });
  db.collectionMocks["characters"]!.findOne.mockImplementation(async (query) => {
    const record = query as Record<string, unknown>;
    if (
      record._id instanceof ObjectId &&
      record._id.equals(mockCandidateId) &&
      record.userId instanceof ObjectId &&
      record.userId.equals(mockUserId)
    ) {
      return { _id: mockCandidateId };
    }
    return null;
  });
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  db = createMockDb();
});

describe("POST /api/campaigns/[id]/color", () => {
  it("allows a multi-profile nominee to set the campaign color", async () => {
    await setup();

    const { POST } = await import("./route");
    const res = await POST(makeRequest("#3366FF"), {
      params: Promise.resolve({ id: mockCampaignId.toString() }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.color).toBe("#3366FF");
  });

  it("rejects a user who is not the candidate owner, manager, or admin", async () => {
    await setup();
    db.collectionMocks["characters"]!.findOne.mockResolvedValue(null);

    const { POST } = await import("./route");
    const res = await POST(makeRequest("#3366FF"), {
      params: Promise.resolve({ id: mockCampaignId.toString() }),
    });

    expect(res.status).toBe(403);
  });

  it("allows an admin without an active character", async () => {
    await setup();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: mockUserId.toString(),
        username: "admin",
        email: "admin@example.com",
        role: "admin",
        isAdmin: true,
        hasCharacter: false,
      },
    } as any);

    const { POST } = await import("./route");
    const res = await POST(makeRequest("#3366FF"), {
      params: Promise.resolve({ id: mockCampaignId.toString() }),
    });

    expect(res.status).toBe(200);
  });
});
