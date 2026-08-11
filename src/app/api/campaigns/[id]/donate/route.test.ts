import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
  getMongoClient: vi.fn(async () => ({
    startSession: () => ({
      withTransaction: vi.fn(async () => {
        const err = new Error("transactions not supported on standalone") as Error & {
          code?: number;
        };
        err.code = 20;
        throw err;
      }),
      endSession: vi.fn(async () => {}),
    }),
  })),
}));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));

let db: MockDb;

const mockUserId = new ObjectId();
const mockCharacterId = new ObjectId();
const mockCampaignId = new ObjectId();
const mockPartyOid = new ObjectId();
const mockPartyId = "1";

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
      countryId: "US",
      actions: 100,
      funds: 100_000,
    },
  };
}

function makeMockCampaign(overrides: Record<string, unknown> = {}) {
  return {
    _id: mockCampaignId,
    electionId: new ObjectId(),
    candidateId: mockCharacterId,
    candidateIsNPP: false,
    party: mockPartyId,
    managerId: null,
    funds: 5_000_000,
    actions: 100,
    totalFundsGenerated: 0,
    totalFundsSpent: 0,
    donationLog: [],
    activityHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeMockCharacter(overrides: Record<string, unknown> = {}) {
  return {
    _id: mockCharacterId,
    name: "Test Character",
    funds: 100_000,
    ...overrides,
  };
}

function makeMockParty(overrides: Record<string, unknown> = {}) {
  return {
    _id: mockPartyOid,
    sequentialId: Number(mockPartyId),
    countryId: "US",
    name: "Test Party",
    treasury: 500_000,
    chairId: mockCharacterId,
    ...overrides,
  };
}

function makeRequest(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/campaigns/${mockCampaignId.toString()}/donate`, {
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
  db.collection("campaigns");
  db.collection("characters");
  db.collection("politicalParties");
  db.collection("gameState");
  db.collection("elections");

  db.collectionMocks["gameState"]!.findOne.mockResolvedValue({ _id: "current", currentTurn: 42 });
  db.collectionMocks["campaigns"]!.findOne.mockResolvedValue(makeMockCampaign());
  db.collectionMocks["campaigns"]!.updateOne.mockResolvedValue({
    matchedCount: 1,
    modifiedCount: 1,
  });
  db.collectionMocks["characters"]!.findOne.mockResolvedValue(makeMockCharacter());
  db.collectionMocks["characters"]!.find.mockReturnValue({
    toArray: async () => [{ _id: mockCharacterId, name: "Test Character", countryId: "US" }],
  } as never);
  db.collectionMocks["characters"]!.updateOne.mockResolvedValue({ modifiedCount: 1 });
  db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue(makeMockParty());
  db.collectionMocks["politicalParties"]!.updateOne.mockResolvedValue({
    matchedCount: 1,
    modifiedCount: 1,
  });
  db.collectionMocks["elections"]!.findOne.mockResolvedValue({ countryId: "US" });
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  db = createMockDb();
});

describe("POST /api/campaigns/[id]/donate — character donation", () => {
  it("deducts funds from character and adds to campaign with donation log entry", async () => {
    await setupRoute();

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ amount: 1000 }), { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Character funds deducted (forex enabled → currencyBalances.campaign)
    const charUpdate = db.collectionMocks["characters"]!.updateOne.mock.calls[0];
    const charInc = (charUpdate[1] as Record<string, Record<string, number>>)["$inc"];
    expect(charInc["currencyBalances.campaign"]).toBe(-1000);

    // Campaign funds incremented
    const campaignUpdate = db.collectionMocks["campaigns"]!.updateOne.mock.calls[0];
    const campaignInc = (campaignUpdate[1] as Record<string, Record<string, number>>)["$inc"];
    expect(campaignInc["funds"]).toBe(1000);
    expect(campaignInc["totalFundsGenerated"]).toBe(1000);

    // Donation log entry pushed
    const campaignPush = (campaignUpdate[1] as Record<string, Record<string, unknown>>)["$push"];
    const pushed = (campaignPush["donationLog"] as { $each: unknown[] })["$each"][0] as Record<
      string,
      unknown
    >;
    expect(pushed["donorId"]).toBe(mockCharacterId.toString());
    expect(pushed["donorName"]).toBe("Test Character");
    expect(pushed["donorType"]).toBe("character");
    expect(pushed["amount"]).toBe(1000);
    expect(pushed["turnNumber"]).toBe(42);
  });
});

describe("POST /api/campaigns/[id]/donate — party donation", () => {
  it("deducts from party treasury and adds to campaign with party donation log entry", async () => {
    await setupRoute();

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ amount: 5000, partyId: mockPartyId }), { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Party treasury deducted on politicalParties
    const partyUpdate = db.collectionMocks["politicalParties"]!.updateOne.mock.calls[0];
    const partyInc = (partyUpdate[1] as Record<string, Record<string, number>>)["$inc"];
    expect(partyInc["treasury"]).toBe(-5000);

    // Campaign funds incremented
    const campaignUpdate = db.collectionMocks["campaigns"]!.updateOne.mock.calls[0];
    const campaignInc = (campaignUpdate[1] as Record<string, Record<string, number>>)["$inc"];
    expect(campaignInc["funds"]).toBe(5000);
    expect(campaignInc["totalFundsGenerated"]).toBe(5000);

    // Donation log entry pushed with party details
    const campaignPush = (campaignUpdate[1] as Record<string, Record<string, unknown>>)["$push"];
    const pushed = (campaignPush["donationLog"] as { $each: unknown[] })["$each"][0] as Record<
      string,
      unknown
    >;
    expect(pushed["donorId"]).toBe(mockPartyOid.toString());
    expect(pushed["donorName"]).toBe("Test Party (Chair)");
    expect(pushed["donorType"]).toBe("party");
    expect(pushed["amount"]).toBe(5000);
    expect(pushed["turnNumber"]).toBe(42);
  });
});

describe("POST /api/campaigns/[id]/donate — party donation unauthorized", () => {
  it("returns 403 when character is not the party chair", async () => {
    await setupRoute();

    // Override politicalParties to have a different chair
    const differentChairId = new ObjectId();
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue(
      makeMockParty({ chairId: differentChairId })
    );

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ amount: 1000, partyId: mockPartyId }), { params });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/chair/i);
  });
});

describe("POST /api/campaigns/[id]/donate — vice chair authorized", () => {
  it("allows vice chair to donate from party treasury", async () => {
    await setupRoute();
    const otherChairId = new ObjectId();
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue(
      makeMockParty({ chairId: otherChairId, viceChairId: mockCharacterId })
    );

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ amount: 5000, partyId: mockPartyId }), { params });

    expect(res.status).toBe(200);
    const partyUpdate = db.collectionMocks["politicalParties"]!.updateOne.mock.calls[0];
    const partyInc = (partyUpdate[1] as Record<string, Record<string, number>>)["$inc"];
    expect(partyInc["treasury"]).toBe(-5000);
  });
});

describe("POST /api/campaigns/[id]/donate — treasurer authorized", () => {
  it("allows treasurer to donate from party treasury", async () => {
    await setupRoute();
    const otherChairId = new ObjectId();
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue(
      makeMockParty({ chairId: otherChairId, treasurerId: mockCharacterId })
    );

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ amount: 5000, partyId: mockPartyId }), { params });

    expect(res.status).toBe(200);
    const partyUpdate = db.collectionMocks["politicalParties"]!.updateOne.mock.calls[0];
    const partyInc = (partyUpdate[1] as Record<string, Record<string, number>>)["$inc"];
    expect(partyInc["treasury"]).toBe(-5000);
  });
});

describe("POST /api/campaigns/[id]/donate — inactive officer profile authorized", () => {
  it("allows party treasury donations when a different owned character holds the officer role", async () => {
    await setupRoute();

    const inactiveOfficerId = new ObjectId();
    db.collectionMocks["characters"]!.find.mockReturnValue({
      toArray: async () => [
        { _id: mockCharacterId, name: "Active Profile", countryId: "US" },
        { _id: inactiveOfficerId, name: "Inactive Treasurer", countryId: "US" },
      ],
    } as never);
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue(
      makeMockParty({ chairId: new ObjectId(), treasurerId: inactiveOfficerId })
    );

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ amount: 5000, partyId: mockPartyId }), { params });

    expect(res.status).toBe(200);
    const partyUpdate = db.collectionMocks["politicalParties"]!.updateOne.mock.calls[0];
    const partyInc = (partyUpdate[1] as Record<string, Record<string, number>>)["$inc"];
    expect(partyInc["treasury"]).toBe(-5000);
  });
});

describe("POST /api/campaigns/[id]/donate — non-officer rejected", () => {
  it("returns 403 when character is not chair, vice chair, or treasurer", async () => {
    await setupRoute();
    const a = new ObjectId();
    const b = new ObjectId();
    const c = new ObjectId();
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue(
      makeMockParty({ chairId: a, viceChairId: b, treasurerId: c })
    );

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ amount: 1000, partyId: mockPartyId }), { params });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/chair|vice|treasurer/i);
  });
});

describe("POST /api/campaigns/[id]/donate — wrong-party officer rejected", () => {
  it("returns 403 when officer's party does not match the campaign's party", async () => {
    await setupRoute();

    // Campaign belongs to party "1"; officer is chair of party "2"
    db.collectionMocks["campaigns"]!.findOne.mockResolvedValue(makeMockCampaign({ party: "1" }));
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue(
      makeMockParty({ sequentialId: 2, chairId: mockCharacterId })
    );

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ amount: 1000, partyId: "2" }), { params });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/different party|outside this party/i);
  });
});

describe("POST /api/campaigns/[id]/donate — insufficient funds (character)", () => {
  it("returns 400 when character has insufficient funds", async () => {
    await setupRoute();

    // Override character to have less funds than the donation amount
    db.collectionMocks["characters"]!.findOne.mockResolvedValue(makeMockCharacter({ funds: 500 }));

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ amount: 1000 }), { params });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/insufficient/i);
  });
});

describe("POST /api/campaigns/[id]/donate — insufficient party treasury", () => {
  it("returns 400 when party treasury has insufficient funds", async () => {
    await setupRoute();

    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue(
      makeMockParty({ treasury: 1000 })
    );

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ amount: 1_000_000, partyId: mockPartyId }), { params });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/insufficient/i);
  });
});

describe("POST /api/campaigns/[id]/donate — campaign not found", () => {
  it("returns 404 when campaign does not exist", async () => {
    await setupRoute();

    db.collectionMocks["campaigns"]!.findOne.mockResolvedValue(null);

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ amount: 1000 }), { params });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });
});
describe("POST /api/campaigns/[id]/donate - fallback insufficient funds", () => {
  it("does not touch the campaign when the party debit loses a race in fallback mode", async () => {
    await setupRoute();

    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue(
      makeMockParty({ treasury: 5_000 })
    );
    db.collectionMocks["politicalParties"]!.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ amount: 5_000, partyId: mockPartyId }), { params });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/insufficient/i);

    expect(db.collectionMocks["campaigns"]!.updateOne).not.toHaveBeenCalled();
  });
});

describe("POST /api/campaigns/[id]/donate - fallback missing campaign", () => {
  it("refunds the treasury and returns 404 when the campaign disappears after debit", async () => {
    await setupRoute();

    db.collectionMocks["campaigns"]!.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ amount: 5_000, partyId: mockPartyId }), { params });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/campaign not found/i);

    expect(db.collectionMocks["politicalParties"]!.updateOne).toHaveBeenCalledTimes(2);

    const debitCall = db.collectionMocks["politicalParties"]!.updateOne.mock.calls[0];
    expect((debitCall[1] as Record<string, Record<string, number>>)["$inc"]).toMatchObject({
      treasury: -5_000,
    });

    const refundCall = db.collectionMocks["politicalParties"]!.updateOne.mock.calls[1];
    expect((refundCall[1] as Record<string, Record<string, number>>)["$inc"]).toMatchObject({
      treasury: 5_000,
    });
  });
});

describe("POST /api/campaigns/[id]/donate - character fallback insufficient funds", () => {
  it("does not touch the campaign when the character debit loses a race", async () => {
    await setupRoute();

    db.collectionMocks["characters"]!.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ amount: 5_000 }), { params });

    expect(res.status).toBe(400);
    expect(db.collectionMocks["campaigns"]!.updateOne).not.toHaveBeenCalled();
  });
});

describe("POST /api/campaigns/[id]/donate - character fallback missing campaign", () => {
  it("refunds the character when the campaign disappears after debit", async () => {
    await setupRoute();

    db.collectionMocks["campaigns"]!.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const { POST } = await import("./route");
    const params = Promise.resolve({ id: mockCampaignId.toString() });
    const res = await POST(makeRequest({ amount: 5_000 }), { params });

    expect(res.status).toBe(404);
    expect(db.collectionMocks["characters"]!.updateOne).toHaveBeenCalledTimes(2);

    const refundCall = db.collectionMocks["characters"]!.updateOne.mock.calls[1];
    expect((refundCall[1] as Record<string, Record<string, number>>)["$inc"]).toMatchObject({
      "currencyBalances.campaign": 5_000,
    });
  });
});
