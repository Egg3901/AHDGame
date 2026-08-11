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
      name: "Test Character",
      actions: 100,
      funds: 1_000_000,
    },
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
    oppositionResearchLevel: 0,
    groundGameLevel: 0,
    mediaSpendingLevel: 0,
    totalFundsSpent: 0,
    totalActionsSpent: 0,
    activityHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRequest(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/campaigns/${mockCampaignId.toString()}/upgrade`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function setupRoute() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({ ok: true, user: makeMockUser() } as any);

  // Pre-initialize collections so collectionMocks entries exist
  db.collection("gameState");
  db.collection("campaigns");
  db.collection("elections");
  db.collection("characters");

  db.collectionMocks["gameState"]!.findOne.mockResolvedValue({ _id: "current", currentTurn: 10 });
  // Default: updated campaign after upgrade (first call = fetch, second = fetch updated)
  db.collectionMocks["campaigns"]!.findOne.mockResolvedValueOnce(
    makeMockCampaign()
  ).mockResolvedValueOnce(makeMockCampaign({ fundraisingLevel: 1, funds: 4_950_000, actions: 90 }));
  db.collectionMocks["campaigns"]!.updateOne.mockResolvedValue({ modifiedCount: 1 });
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  db = createMockDb();
});

describe("POST /api/campaigns/[id]/upgrade — primary phase (no multiplier)", () => {
  it("deducts base cost when election is in primary phase", async () => {
    await setupRoute();

    // Primary phase: primary closes in the future (turn-first; currentTurn=10)
    const now = new Date();
    const primaryEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 1 day from now
    const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
    db.collectionMocks["elections"]!.findOne.mockResolvedValue({
      _id: mockElectionId,
      primaryEndTime: primaryEnd,
      endTime: end,
      primaryEndTurn: 20,
      endTurn: 40,
    });

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ category: "fundraising" }), { params });

    expect(res.status).toBe(200);

    // fundraising level 0→1 costs: funds=50_000, actions=10
    // multiplier=1.0, so adjustedFunds=50_000, adjustedActions=10
    const updateCall = db.collectionMocks["campaigns"]!.updateOne.mock.calls[0];
    const incOp = (updateCall[1] as Record<string, Record<string, number>>)["$inc"];
    expect(incOp["funds"]).toBe(-50_000);
    expect(incOp["actions"]).toBe(-10);
    expect(incOp["totalFundsSpent"]).toBe(50_000);
    expect(incOp["totalActionsSpent"]).toBe(10);
  });
});

describe("POST /api/campaigns/[id]/upgrade — general phase (1.5x multiplier)", () => {
  it("applies 1.5x multiplier when election is in general phase", async () => {
    await setupRoute();

    // General phase: primary closed, general still open (turn-first; currentTurn=10)
    const now = new Date();
    const primaryEnd = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 day ago
    const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
    db.collectionMocks["elections"]!.findOne.mockResolvedValue({
      _id: mockElectionId,
      primaryEndTime: primaryEnd,
      endTime: end,
      primaryEndTurn: 5,
      endTurn: 40,
    });

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ category: "fundraising" }), { params });

    expect(res.status).toBe(200);

    // fundraising level 0→1 costs: funds=50_000, actions=10
    // multiplier=1.5 → Math.ceil(50_000*1.5)=75_000, Math.ceil(10*1.5)=15
    const updateCall = db.collectionMocks["campaigns"]!.updateOne.mock.calls[0];
    const incOp = (updateCall[1] as Record<string, Record<string, number>>)["$inc"];
    expect(incOp["funds"]).toBe(-75_000);
    expect(incOp["actions"]).toBe(-15);
    expect(incOp["totalFundsSpent"]).toBe(75_000);
    expect(incOp["totalActionsSpent"]).toBe(15);
  });

  it("rounds up fractional costs with Math.ceil", async () => {
    await setupRoute();

    // Override campaign mock to have fresh calls for oppositionResearch
    db.collectionMocks["campaigns"]!.findOne.mockReset()
      .mockResolvedValueOnce(makeMockCampaign({ oppositionResearchLevel: 0 }))
      .mockResolvedValueOnce(makeMockCampaign({ oppositionResearchLevel: 1 }));

    const now = new Date();
    const primaryEnd = new Date(now.getTime() - 1000);
    const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    db.collectionMocks["elections"]!.findOne.mockResolvedValue({
      _id: mockElectionId,
      primaryEndTime: primaryEnd,
      endTime: end,
      primaryEndTurn: 5,
      endTurn: 40,
    });

    // Mock a target character for opposition research
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      name: "Target Politician",
    });

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const targetId = new ObjectId().toString();
    const res = await POST(makeRequest({ category: "oppositionResearch", targetId }), { params });

    expect(res.status).toBe(200);

    // oppositionResearch level 0→1 costs: funds=40_000, actions=8
    // multiplier=1.5 → Math.ceil(40_000*1.5)=60_000, Math.ceil(8*1.5)=12
    const updateCall = db.collectionMocks["campaigns"]!.updateOne.mock.calls[0];
    const incOp = (updateCall[1] as Record<string, Record<string, number>>)["$inc"];
    expect(incOp["funds"]).toBe(-60_000);
    expect(incOp["actions"]).toBe(-12);
  });
});

describe("POST /api/campaigns/[id]/upgrade — no election found", () => {
  it("treats missing election as no multiplier (1x)", async () => {
    await setupRoute();

    db.collectionMocks["elections"]!.findOne.mockResolvedValue(null);

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ category: "fundraising" }), { params });

    expect(res.status).toBe(200);

    // No multiplier: funds=50_000, actions=10
    const updateCall = db.collectionMocks["campaigns"]!.updateOne.mock.calls[0];
    const incOp = (updateCall[1] as Record<string, Record<string, number>>)["$inc"];
    expect(incOp["funds"]).toBe(-50_000);
    expect(incOp["actions"]).toBe(-10);
    expect(incOp["totalFundsSpent"]).toBe(50_000);
    expect(incOp["totalActionsSpent"]).toBe(10);
  });
});
