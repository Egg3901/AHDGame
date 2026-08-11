import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/sequentialId", () => ({ getNextSequentialId: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true, retryAfter: 0 })),
  rateLimitResponse: vi.fn(),
}));

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/us/coalitions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/country/[code]/coalitions", () => {
  let db: MockDb;
  const chairId = new ObjectId();
  const partyId = new ObjectId();
  const countryId = "US";
  const sequentialPartyId = 1;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    db = createMockDb();
    db.collection("politicalParties");
    db.collection("coalitions");
    db.collection("characters");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "chair",
        character: {
          _id: chairId,
          party: String(sequentialPartyId),
          actions: 50,
        },
      },
    } as never);

    const { getNextSequentialId } = await import("@/lib/db/sequentialId");
    vi.mocked(getNextSequentialId).mockResolvedValue(3);

    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue({
      _id: partyId,
      sequentialId: sequentialPartyId,
      countryId,
      name: "Example Party",
      chairId,
      coalitionId: null,
    });
    db.collectionMocks["coalitions"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["politicalParties"]!.findOneAndUpdate.mockResolvedValue({
      _id: partyId,
      sequentialId: sequentialPartyId,
    });
    db.collectionMocks["characters"]!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
  });

  it("rejects duplicate submit attempts once the founding party is already reserved", async () => {
    db.collectionMocks["politicalParties"]!.findOneAndUpdate.mockResolvedValue(null);

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ name: "Next Friday", abbreviation: "NFC", color: "#22C55E" }),
      { params: Promise.resolve({ code: "us" }) }
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/already a member of a coalition/i);
    expect(db.collectionMocks["coalitions"]!.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["characters"]!.updateOne).not.toHaveBeenCalled();
  });

  it("rolls back the party reservation when the action debit fails", async () => {
    db.collectionMocks["characters"]!.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ name: "Next Friday", abbreviation: "NFC", color: "#22C55E" }),
      { params: Promise.resolve({ code: "us" }) }
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/need 25 actions/i);
    expect(db.collectionMocks["coalitions"]!.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["politicalParties"]!.updateOne).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks["politicalParties"]!.updateOne).toHaveBeenCalledWith(
      { _id: partyId, coalitionId: expect.any(ObjectId) },
      { $set: { coalitionId: null, updatedAt: expect.any(Date) } }
    );
  });
});

describe("GET /api/country/[code]/coalitions", () => {
  let db: MockDb;
  const chairCharId = new ObjectId();
  const partyAId = new ObjectId();
  const partyBId = new ObjectId();
  const coalitionObjectId = new ObjectId();
  const countryId = "UK";

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    db = createMockDb();
    db.collection("politicalParties");
    db.collection("coalitions");
    db.collection("characters");
    db.collection("npps");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const coalitionsCursor = {
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: coalitionObjectId,
          sequentialId: 2,
          countryId,
          name: "The Workers Alliance",
          abbreviation: "TWA",
          color: "#ff0000",
          chairCharacterId: chairCharId,
          chairPartyId: partyAId,
          members: [
            { partyId: partyAId, partySequentialId: 1, joinedAt: new Date("2026-04-01") },
            { partyId: partyBId, partySequentialId: 16, joinedAt: new Date("2026-04-02") },
          ],
          pendingInvites: [],
          joinRequests: [],
          createdAt: new Date("2026-04-01"),
        },
      ]),
    };
    db.collectionMocks["coalitions"]!.find.mockReturnValue(coalitionsCursor as never);

    db.collectionMocks["politicalParties"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: partyAId, sequentialId: 1, name: "Labour", abbreviation: "LAB", color: "#aa0000" },
        { _id: partyBId, sequentialId: 16, name: "Co-Op", abbreviation: "COOP", color: "#bb0000" },
      ]),
    } as never);

    db.collectionMocks["characters"]!.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ _id: chairCharId, name: "Chair Name" }]),
    } as never);

    const aggCursor = { toArray: vi.fn().mockResolvedValue([]) };
    db.collectionMocks["characters"]!.aggregate.mockReturnValue(aggCursor as never);
    db.collectionMocks["npps"]!.aggregate.mockReturnValue(aggCursor as never);
  });

  it("returns memberParties[].partyId as the party sequentialId (number), matching CoalitionListItem", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/country/uk/coalitions"), {
      params: Promise.resolve({ code: "uk" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    const coalition = body.coalitions[0];
    expect(coalition.memberParties).toHaveLength(2);
    for (const mp of coalition.memberParties) {
      expect(typeof mp.partyId).toBe("number");
    }
    expect(coalition.memberParties.map((mp: { partyId: number }) => mp.partyId).sort()).toEqual([
      1, 16,
    ]);
  });
});
