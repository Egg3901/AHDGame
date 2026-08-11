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

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/uk/coalitions/2/kick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/country/[code]/coalitions/[id]/kick — coalitionId reconciliation", () => {
  let db: MockDb;
  const callerChairId = new ObjectId();
  const callerPartyId = new ObjectId();
  const targetPartyId = new ObjectId();
  const kickingCoalitionId = new ObjectId();
  const otherCoalitionId = new ObjectId();
  const targetPartySeq = 16;
  const countryId = "UK";

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
        username: "coalition-chair",
        character: { _id: callerChairId, party: "1", countryId },
      },
    } as never);

    // Coalition that the caller chairs
    db.collectionMocks["coalitions"]!.findOne.mockResolvedValue({
      _id: kickingCoalitionId,
      sequentialId: 2,
      countryId,
      name: "The Workers Alliance",
      chairCharacterId: callerChairId,
      chairPartyId: callerPartyId,
      members: [
        { partyId: callerPartyId, partySequentialId: 1, joinedAt: new Date("2026-04-01") },
        {
          partyId: targetPartyId,
          partySequentialId: targetPartySeq,
          joinedAt: new Date("2026-04-02"),
        },
      ],
    });
  });

  it("does NOT clear party.coalitionId when the kicked party's coalitionId points to a different coalition", async () => {
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue({
      _id: targetPartyId,
      sequentialId: targetPartySeq,
      countryId,
      name: "Co-Op",
      chairId: new ObjectId(),
      coalitionId: otherCoalitionId,
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ partySequentialId: targetPartySeq }), {
      params: Promise.resolve({ code: "uk", id: "2" }),
    });

    expect(response.status).toBe(200);

    const partyUpdates = db.collectionMocks["politicalParties"]!.updateOne.mock.calls;
    const coalitionIdClearCalls = partyUpdates.filter((c) =>
      JSON.stringify(c[1]).includes('"coalitionId":null')
    );
    expect(coalitionIdClearCalls).toHaveLength(0);
  });

  it("denies with 403 (not a 500 crash) when the chair seat is vacant (#3234)", async () => {
    // Vacant chair — chairCharacterId is null (leader banned / stepped down).
    db.collectionMocks["coalitions"]!.findOne.mockResolvedValue({
      _id: kickingCoalitionId,
      sequentialId: 2,
      countryId,
      name: "The Workers Alliance",
      chairCharacterId: null,
      chairPartyId: callerPartyId,
      members: [
        { partyId: callerPartyId, partySequentialId: 1, joinedAt: new Date("2026-04-01") },
        {
          partyId: targetPartyId,
          partySequentialId: targetPartySeq,
          joinedAt: new Date("2026-04-02"),
        },
      ],
    });
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue({
      _id: targetPartyId,
      sequentialId: targetPartySeq,
      countryId,
      name: "Co-Op",
      chairId: new ObjectId(),
      coalitionId: kickingCoalitionId,
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ partySequentialId: targetPartySeq }), {
      params: Promise.resolve({ code: "uk", id: "2" }),
    });

    // Vacant chair → clean permission denial, never `.equals()` on null.
    expect(response.status).toBe(403);
    // No membership mutation should have occurred.
    expect(db.collectionMocks["politicalParties"]!.updateOne).not.toHaveBeenCalled();
  });

  it("clears party.coalitionId when the kicked party's coalitionId matches the coalition kicking them", async () => {
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue({
      _id: targetPartyId,
      sequentialId: targetPartySeq,
      countryId,
      name: "Co-Op",
      chairId: new ObjectId(),
      coalitionId: kickingCoalitionId,
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ partySequentialId: targetPartySeq }), {
      params: Promise.resolve({ code: "uk", id: "2" }),
    });

    expect(response.status).toBe(200);

    const partyUpdates = db.collectionMocks["politicalParties"]!.updateOne.mock.calls;
    const coalitionIdClearCalls = partyUpdates.filter((c) =>
      JSON.stringify(c[1]).includes('"coalitionId":null')
    );
    expect(coalitionIdClearCalls.length).toBeGreaterThan(0);
  });
});
