import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true, retryAfter: 0 })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));

function makeRequest() {
  return new Request("http://localhost/api/country/uk/coalitions/7/leave", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

describe("POST /api/country/[code]/coalitions/[id]/leave — coalitionId reconciliation", () => {
  let db: MockDb;
  const chairCharacterId = new ObjectId();
  const partyId = new ObjectId();
  const leavingCoalitionId = new ObjectId();
  const otherCoalitionId = new ObjectId();
  const leavingCoalitionSeq = 7;
  const countryId = "UK";
  const partySeqId = 16;

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
          _id: chairCharacterId,
          party: String(partySeqId),
          countryId,
        },
      },
    } as never);
  });

  it("does NOT clear party.coalitionId when it points to a different coalition than the one being left", async () => {
    // Party listed in BOTH coalitions (data corruption case), coalitionId points to the OTHER one
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue({
      _id: partyId,
      sequentialId: partySeqId,
      countryId,
      name: "Co-Operative Party",
      chairId: chairCharacterId,
      coalitionId: otherCoalitionId,
    });

    // Coalition being left: party is a member, NOT the chair, 4 members
    db.collectionMocks["coalitions"]!.findOne.mockResolvedValue({
      _id: leavingCoalitionId,
      sequentialId: leavingCoalitionSeq,
      countryId,
      name: "The Left",
      chairPartyId: new ObjectId(),
      members: [
        { partyId, partySequentialId: partySeqId, joinedAt: new Date("2026-04-01") },
        { partyId: new ObjectId(), partySequentialId: 99, joinedAt: new Date("2026-04-02") },
      ],
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "uk", id: String(leavingCoalitionSeq) }),
    });

    expect(response.status).toBe(200);

    // The party should be removed from the leaving coalition's members ($pull),
    // but coalitionId must NOT be cleared because it points to a different coalition.
    const partyUpdates = db.collectionMocks["politicalParties"]!.updateOne.mock.calls;
    const coalitionIdClearCalls = partyUpdates.filter((c) =>
      JSON.stringify(c[1]).includes('"coalitionId":null')
    );
    expect(coalitionIdClearCalls).toHaveLength(0);
  });

  it("clears party.coalitionId when it matches the coalition being left", async () => {
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue({
      _id: partyId,
      sequentialId: partySeqId,
      countryId,
      name: "Co-Operative Party",
      chairId: chairCharacterId,
      coalitionId: leavingCoalitionId,
    });

    db.collectionMocks["coalitions"]!.findOne.mockResolvedValue({
      _id: leavingCoalitionId,
      sequentialId: leavingCoalitionSeq,
      countryId,
      name: "The Left",
      chairPartyId: new ObjectId(),
      members: [
        { partyId, partySequentialId: partySeqId, joinedAt: new Date("2026-04-01") },
        { partyId: new ObjectId(), partySequentialId: 99, joinedAt: new Date("2026-04-02") },
      ],
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "uk", id: String(leavingCoalitionSeq) }),
    });

    expect(response.status).toBe(200);

    const partyUpdates = db.collectionMocks["politicalParties"]!.updateOne.mock.calls;
    const coalitionIdClearCalls = partyUpdates.filter((c) =>
      JSON.stringify(c[1]).includes('"coalitionId":null')
    );
    expect(coalitionIdClearCalls.length).toBeGreaterThan(0);
  });
});
