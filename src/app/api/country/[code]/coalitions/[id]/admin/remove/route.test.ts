import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/uk/coalitions/2/admin/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/country/[code]/coalitions/[id]/admin/remove — coalitionId reconciliation", () => {
  let db: MockDb;
  const chairPartyId = new ObjectId();
  const targetPartyId = new ObjectId();
  const removingCoalitionId = new ObjectId();
  const otherCoalitionId = new ObjectId();
  const targetPartySeq = 16;
  const countryId = "UK";

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    db = createMockDb();
    db.collection("politicalParties");
    db.collection("coalitions");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), username: "admin", isAdmin: true },
    } as never);

    db.collectionMocks["coalitions"]!.findOne.mockResolvedValue({
      _id: removingCoalitionId,
      sequentialId: 2,
      countryId,
      name: "The Workers Alliance",
      chairPartyId,
      chairCharacterId: new ObjectId(),
      members: [
        { partyId: chairPartyId, partySequentialId: 1, joinedAt: new Date("2026-04-01") },
        {
          partyId: targetPartyId,
          partySequentialId: targetPartySeq,
          joinedAt: new Date("2026-04-02"),
        },
      ],
    });
  });

  it("does NOT clear party.coalitionId when it points to a different coalition", async () => {
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue({
      _id: targetPartyId,
      sequentialId: targetPartySeq,
      countryId,
      name: "Co-Op",
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

  it("clears party.coalitionId when it matches the coalition the party is removed from", async () => {
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue({
      _id: targetPartyId,
      sequentialId: targetPartySeq,
      countryId,
      name: "Co-Op",
      coalitionId: removingCoalitionId,
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
