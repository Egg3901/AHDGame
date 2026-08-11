import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));

let db: MockDb;

const mockUserId = new ObjectId();
const mockCharacterId = new ObjectId();
const mockCampaignId = new ObjectId();
const mockElectionId = new ObjectId();

function makeMockUser(overrides: Record<string, unknown> = {}) {
  return {
    userId: mockUserId.toString(),
    username: "testuser",
    email: "test@example.com",
    role: "user",
    isAdmin: false,
    hasCharacter: true,
    character: {
      _id: mockCharacterId,
      name: "Test Character",
      countryId: "US",
    },
    ...overrides,
  };
}

function makeMockCampaign(overrides: Record<string, unknown> = {}) {
  return {
    _id: mockCampaignId,
    electionId: mockElectionId,
    candidateId: mockCharacterId,
    candidateIsNPP: false,
    managerId: null,
    funds: 5_000_000,
    actions: 100,
    fundraisingLevel: 0,
    oppositionResearchLevel: 3,
    groundGameLevel: 0,
    mediaSpendingLevel: 0,
    oppositionTargetId: new ObjectId(),
    oppositionTargetName: "Rival Politician",
    oppositionResearchCooldownUntil: null,
    publicFogOfWar: { oppositionResearchLevel: 2 },
    partyFogOfWar: { oppositionResearchLevel: 3 },
    activityHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRequest() {
  return new Request(
    `http://localhost/api/campaigns/${mockCampaignId.toString()}/opposition-research/reset`,
    { method: "POST" }
  );
}

async function setupRoute(
  opts: {
    campaignOverrides?: Record<string, unknown>;
    userOverrides?: Record<string, unknown>;
    ownedCandidate?: { _id: ObjectId } | null;
  } = {}
) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: makeMockUser(opts.userOverrides),
  } as any);

  db.collection("campaigns");
  db.collection("characters");
  db.collection("gameState");
  db.collection("elections");

  db.collectionMocks["campaigns"]!.findOne.mockResolvedValue(
    makeMockCampaign(opts.campaignOverrides)
  );
  db.collectionMocks["campaigns"]!.updateOne.mockResolvedValue({ modifiedCount: 1 });
  db.collectionMocks["characters"]!.findOne.mockResolvedValue(
    opts.ownedCandidate === undefined ? { _id: mockCharacterId } : opts.ownedCandidate
  );
  db.collectionMocks["gameState"]!.findOne.mockResolvedValue({ _id: "current", currentTurn: 42 });
  db.collectionMocks["elections"]!.findOne.mockResolvedValue({ countryId: "US" });
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  db = createMockDb();
});

describe("POST /api/campaigns/[id]/opposition-research/reset — success", () => {
  it("zeroes level, fog levels, target, cooldown and pushes a reset activity entry", async () => {
    await setupRoute();

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const updateCall = db.collectionMocks["campaigns"]!.updateOne.mock.calls[0];
    const update = updateCall[1] as Record<string, Record<string, unknown>>;

    expect(update["$set"]["oppositionResearchLevel"]).toBe(0);
    expect(update["$set"]["publicFogOfWar.oppositionResearchLevel"]).toBe(0);
    expect(update["$set"]["partyFogOfWar.oppositionResearchLevel"]).toBe(0);
    expect(update["$set"]["oppositionTargetId"]).toBeNull();
    expect(update["$set"]["oppositionTargetName"]).toBeNull();
    expect(update["$set"]["oppositionResearchCooldownUntil"]).toBeNull();

    const push = update["$push"]["activityHistory"] as { $each: any[]; $slice: number };
    expect(push.$slice).toBe(-10);
    expect(push.$each).toHaveLength(1);
    expect(push.$each[0]).toMatchObject({
      type: "downgrade",
      category: "oppositionResearch",
      newLevel: 0,
      costFunds: 0,
      costActions: 0,
      reason: "reset",
      turnNumber: 42,
    });
  });

  it("allows the campaign manager (not the candidate) to reset", async () => {
    const managerId = new ObjectId(mockUserId.toString());
    await setupRoute({
      campaignOverrides: { managerId, candidateId: new ObjectId() },
      ownedCandidate: null,
    });

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(200);
  });

  it("allows an admin (no character ownership) to reset", async () => {
    await setupRoute({
      userOverrides: {
        isAdmin: true,
        hasCharacter: false,
        character: undefined,
      },
      campaignOverrides: { candidateId: new ObjectId(), managerId: null },
      ownedCandidate: null,
    });

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(200);
  });

  it("allows a multi-profile owner whose active character is NOT the candidate", async () => {
    // User's active character is a different ObjectId, but they own the
    // candidate via another profile (characters.findOne returns a match).
    const otherActive = new ObjectId();
    await setupRoute({
      userOverrides: { character: { _id: otherActive, name: "Other Profile" } },
      campaignOverrides: { managerId: null },
      ownedCandidate: { _id: mockCharacterId },
    });

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(200);
  });
});

describe("POST /api/campaigns/[id]/opposition-research/reset — failures", () => {
  it("returns 400 for invalid campaign id", async () => {
    await setupRoute();
    const { POST } = await import("./route");
    const params = Promise.resolve({ id: "not-an-objectid" });
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(400);
  });

  it("returns 404 when campaign is not found", async () => {
    await setupRoute();
    db.collectionMocks["campaigns"]!.findOne.mockResolvedValue(null);

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 when user is neither admin, manager, nor candidate owner", async () => {
    await setupRoute({
      campaignOverrides: { candidateId: new ObjectId(), managerId: null },
      ownedCandidate: null,
    });

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(403);
  });

  it("returns 400 when opposition research is already cleared", async () => {
    await setupRoute({
      campaignOverrides: {
        oppositionResearchLevel: 0,
        oppositionTargetId: null,
        oppositionTargetName: null,
        oppositionResearchCooldownUntil: null,
      },
    });

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already cleared/i);
  });
});
