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
  return new Request("http://localhost/api/country/uk/coalitions/2/invite/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

describe("POST /api/country/[code]/coalitions/[id]/invite/accept", () => {
  let db: MockDb;
  const chairCharacterId = new ObjectId();
  const partyId = new ObjectId();
  const otherCoalitionId = new ObjectId();
  const targetCoalitionId = new ObjectId();
  const targetCoalitionSeq = 2;
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

  it("rejects when the inviting party is already in another coalition", async () => {
    // Coalition that has invited the party
    db.collectionMocks["coalitions"]!.findOne.mockResolvedValue({
      _id: targetCoalitionId,
      sequentialId: targetCoalitionSeq,
      countryId,
      name: "The Workers Alliance",
      chairCharacterId: new ObjectId(),
      members: [],
      pendingInvites: [{ partyId, invitedBy: new ObjectId(), invitedAt: new Date("2026-05-01") }],
      joinRequests: [],
    });

    // Party already belongs to a *different* coalition
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue({
      _id: partyId,
      sequentialId: partySeqId,
      countryId,
      name: "Co-Operative Party",
      chairId: chairCharacterId,
      coalitionId: otherCoalitionId,
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "uk", id: String(targetCoalitionSeq) }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/already a member of (another )?coalition/i);
    expect(db.collectionMocks["coalitions"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["politicalParties"]!.updateOne).not.toHaveBeenCalled();
  });
});
