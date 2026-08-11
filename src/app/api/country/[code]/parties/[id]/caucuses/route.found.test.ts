import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuth: vi.fn(),
  requireAuthWithCharacter: vi.fn(),
}));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/db/caucusLookup", () => ({
  listCaucusesForParty: vi.fn(),
  countCaucusMembers: vi.fn(),
  normaliseCaucusSlug: vi.fn((name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
  ),
  reclaimSlug: vi.fn(),
}));
vi.mock("@/lib/caucus/caucusHealth", () => ({
  buildPartyCaucusHealthSnapshot: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/caucus/cleanupCaucusParticipationForCharacters", () => ({
  cleanupCaucusParticipationForCharacters: vi.fn().mockResolvedValue({
    candidaciesWithdrawn: 0,
    votesDeleted: 0,
    membershipsClosed: 1,
    factionIdsCleared: 1,
    chairSeatsCleared: 0,
    viceChairSeatsCleared: 0,
  }),
}));

function makeFoundRequest(name = "Progress Caucus") {
  return new Request("http://localhost/api/country/us/parties/9/caucuses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      description: "A new caucus for the current party.",
      color: "#336699",
    }),
  });
}

describe("POST /api/country/[code]/parties/[id]/caucuses — stale faction heal (ticket #1030)", () => {
  let db: MockDb;
  const characterId = new ObjectId();
  const staleFactionId = new ObjectId();
  const partyObjectId = new ObjectId();

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("caucuses");
    db.collection("caucusMemberships");
    db.collection("characters");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "founder",
        isAdmin: false,
        character: {
          _id: characterId,
          name: "Howard Hughes",
          countryId: "US",
          party: "9",
          factionId: staleFactionId,
        },
      },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: partyObjectId,
      sequentialId: 9,
      countryId: "US",
      name: "New Party",
    } as never);

    // No chair seat already held in this party.
    db.collectionMocks["caucuses"]!.findOne.mockResolvedValueOnce(null) // existingChair check
      .mockResolvedValueOnce({
        // pointedCaucus — belongs to Democrats (party 1), not current party 9
        _id: staleFactionId,
        countryId: "US",
        partyId: "1",
        name: "Old Dem Caucus",
        disbandedAt: null,
      })
      .mockResolvedValueOnce(null); // slug collision

    db.collectionMocks["caucuses"]!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    db.collectionMocks["caucusMemberships"]!.insertOne.mockResolvedValue({
      insertedId: new ObjectId(),
    });
    db.collectionMocks["characters"]!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
  });

  it("heals a stale Democratic caucus factionId and allows founding in the new party", async () => {
    const { cleanupCaucusParticipationForCharacters } =
      await import("@/lib/caucus/cleanupCaucusParticipationForCharacters");

    const { POST } = await import("./route");
    const response = await POST(makeFoundRequest(), {
      params: Promise.resolve({ code: "us", id: "9" }),
    });

    expect(response.status).toBe(200);
    expect(cleanupCaucusParticipationForCharacters).toHaveBeenCalledWith(
      db,
      [characterId],
      expect.objectContaining({
        removeMembership: true,
        membershipStatus: "left",
      })
    );
    expect(db.collectionMocks["characters"]!.updateOne).toHaveBeenCalledWith(
      { _id: characterId, factionId: staleFactionId },
      expect.objectContaining({
        $set: expect.objectContaining({ factionId: null }),
      })
    );
  });

  it("still blocks founding when factionId points at an active caucus in this party", async () => {
    db.collectionMocks["caucuses"]!.findOne.mockReset()
      .mockResolvedValueOnce(null) // existingChair
      .mockResolvedValueOnce({
        _id: staleFactionId,
        countryId: "US",
        partyId: "9",
        name: "Current Party Caucus",
        disbandedAt: null,
      });

    const { POST } = await import("./route");
    const response = await POST(makeFoundRequest(), {
      params: Promise.resolve({ code: "us", id: "9" }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/Leave your current caucus/i);
  });
});
