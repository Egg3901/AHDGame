import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/time/gameTime", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getGameTime: vi.fn().mockResolvedValue({ currentTurn: 13 }),
}));

let db: MockDb;

const mockUserId = new ObjectId();
const mockCharacterId = new ObjectId();
const mockCampaignId = new ObjectId();
const mockElectionId = new ObjectId();
const mockTargetId = new ObjectId();

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
      actions: 100,
      funds: 1_000_000,
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
    oppositionResearchLevel: 1,
    groundGameLevel: 0,
    mediaSpendingLevel: 0,
    oppositionTargetId: null,
    oppositionTargetName: null,
    oppositionResearchCooldownUntil: null,
    totalFundsSpent: 0,
    totalActionsSpent: 0,
    activityHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRequest(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/campaigns/${mockCampaignId.toString()}/retarget`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function setupRoute(campaignOverrides: Record<string, unknown> = {}) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({ ok: true, user: makeMockUser() } as any);

  db.collection("campaigns");
  db.collection("characters");
  db.collection("npps");
  db.collection("elections");
  db.collection("electionCandidates");

  db.collectionMocks["campaigns"]!.findOne.mockResolvedValue(makeMockCampaign(campaignOverrides));
  db.collectionMocks["campaigns"]!.updateOne.mockResolvedValue({ modifiedCount: 1 });
  db.collectionMocks["elections"]!.findOne.mockResolvedValue({
    countryId: "US",
    status: "active",
    startTurn: 1,
    primaryEndTurn: 40,
    endTurn: 89,
  });
  // The target has to be standing against the buyer in this race, which is the
  // rule the route now enforces rather than merely sharing a country.
  db.collectionMocks["electionCandidates"]!.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([
      { characterId: mockCharacterId, characterName: "Me", party: "1", status: "active" },
      {
        characterId: mockTargetId,
        characterName: "Rival Politician",
        party: "1",
        status: "active",
      },
    ]),
  } as never);
  db.collectionMocks["characters"]!.findOne.mockResolvedValue({
    _id: mockTargetId,
    name: "Rival Politician",
  });
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  db = createMockDb();
});

describe("POST /api/campaigns/[id]/retarget — success", () => {
  it("updates oppositionTargetId, oppositionTargetName, and sets cooldown", async () => {
    await setupRoute();

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const before = Date.now();
    const res = await POST(makeRequest({ targetId: mockTargetId.toString() }), { params });
    const after = Date.now();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.oppositionTargetId).toBe(mockTargetId.toString());
    expect(body.oppositionTargetName).toBe("Rival Politician");

    const cooldown = new Date(body.oppositionResearchCooldownUntil).getTime();
    const expectedMin = before + 6 * 60 * 60 * 1000;
    const expectedMax = after + 6 * 60 * 60 * 1000;
    expect(cooldown).toBeGreaterThanOrEqual(expectedMin);
    expect(cooldown).toBeLessThanOrEqual(expectedMax);

    const updateCall = db.collectionMocks["campaigns"]!.updateOne.mock.calls[0];
    const setOp = (updateCall[1] as Record<string, Record<string, unknown>>)["$set"];
    expect(setOp["oppositionTargetId"]).toEqual(mockTargetId);
    expect(setOp["oppositionTargetName"]).toBe("Rival Politician");
    expect(setOp["oppositionResearchCooldownUntil"]).toBeDefined();
  });
});

describe("POST /api/campaigns/[id]/retarget — no opposition research", () => {
  it("returns 400 when oppositionResearchLevel is 0", async () => {
    await setupRoute({ oppositionResearchLevel: 0 });

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ targetId: mockTargetId.toString() }), { params });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/opposition research must be purchased/i);
  });
});

describe("POST /api/campaigns/[id]/retarget — cooldown active", () => {
  it("returns 400 when oppositionResearchCooldownUntil is in the future", async () => {
    const future = new Date(Date.now() + 3 * 60 * 60 * 1000);
    await setupRoute({ oppositionResearchCooldownUntil: future });

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ targetId: mockTargetId.toString() }), { params });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/cooldown/i);
  });
});

describe("POST /api/campaigns/[id]/retarget — unauthorized", () => {
  it("returns 403 when user is neither owner nor manager", async () => {
    const otherCharacterId = new ObjectId();
    await setupRoute({ candidateId: otherCharacterId });

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ targetId: mockTargetId.toString() }), { params });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/not authorized/i);
  });
});

describe("POST /api/campaigns/[id]/retarget — target not found", () => {
  it("returns 404 when target is not in characters or npps", async () => {
    await setupRoute();

    db.collectionMocks["characters"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["npps"]!.findOne.mockResolvedValue(null);

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ targetId: mockTargetId.toString() }), { params });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/target not found/i);
  });

  it("falls back to npps when character not found", async () => {
    await setupRoute();

    db.collectionMocks["characters"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["npps"]!.findOne.mockResolvedValue({
      _id: mockTargetId,
      name: "NPC Rival",
    });

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ targetId: mockTargetId.toString() }), { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.oppositionTargetName).toBe("NPC Rival");
  });
});

describe("POST /api/campaigns/[id]/retarget — who is fair game", () => {
  it("refuses somebody who is not standing in this race", async () => {
    // Sharing a country was the whole check before, so research could be
    // bought against a private citizen or a senator who was not running: real
    // money and actions spent draining somebody the buyer is not up against.
    await setupRoute();
    const stranger = new ObjectId();
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: stranger,
      name: "Uninvolved Senator",
    });
    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ targetId: stranger.toString() }), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/standing against you/i);
    expect(db.collectionMocks["campaigns"]!.updateOne).not.toHaveBeenCalled();
  });

  it("refuses a rival in the other party's field during a primary", async () => {
    // Both parties file in one presidential election, but a candidate in the
    // other primary is not competing with the buyer for a delegate.
    await setupRoute();
    const otherParty = new ObjectId();
    db.collectionMocks["electionCandidates"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { characterId: mockCharacterId, characterName: "Me", party: "1", status: "active" },
        {
          characterId: otherParty,
          characterName: "Across The Aisle",
          party: "2",
          status: "active",
        },
      ]),
    } as never);
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: otherParty,
      name: "Across The Aisle",
    });
    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ targetId: otherParty.toString() }), { params });
    expect(res.status).toBe(400);
    expect(db.collectionMocks["campaigns"]!.updateOne).not.toHaveBeenCalled();
  });
});
