import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn() }));
vi.mock("@/lib/utils/electionCandidacy", () => ({
  withdrawFromMismatchedPrimaries: vi.fn(),
  cleanupPartyPositionsOnSwitch: vi.fn(),
}));
vi.mock("@/lib/caucus/cleanupCaucusParticipationForCharacters", () => ({
  cleanupCaucusParticipationForCharacters: vi.fn().mockResolvedValue({
    candidaciesWithdrawn: 0,
    votesDeleted: 0,
    membershipsClosed: 0,
    factionIdsCleared: 0,
    chairSeatsCleared: 0,
    viceChairSeatsCleared: 0,
  }),
}));
vi.mock("@/lib/turn/partyOrg/presence", () => ({ updatePartyPresence: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));

function makeRequest(characterId: ObjectId) {
  return new Request("http://localhost/api/country/us/parties/1/purge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ characterId: characterId.toString() }),
  });
}

describe("POST /api/country/[code]/parties/[id]/purge", () => {
  let db: MockDb;
  const chairId = new ObjectId();
  const targetId = new ObjectId();
  const partyObjectId = new ObjectId();

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("characters");
    db.collection("politicalParties");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "chair",
        isAdmin: false,
        character: {
          _id: chairId,
          name: "Party Chair",
          countryId: "US",
        },
      },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: partyObjectId,
      sequentialId: 1,
      countryId: "US",
      name: "Test Party",
      chairId,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [targetId],
    } as never);

    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: targetId,
      userId: new ObjectId(),
      name: "Committee Member",
      party: "1",
      countryId: "US",
      homeState: "CA",
      partyInfluence: 20,
    });
  });

  it("rejects purges while the mechanic is disabled", async () => {
    // Default flag state: PARTY_PURGE_ENABLED === false
    const { POST } = await import("./route");
    const response = await POST(makeRequest(targetId), {
      params: Promise.resolve({ code: "us", id: "1" }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toMatch(/disabled/i);
    expect(db.collectionMocks["characters"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["politicalParties"]!.updateOne).not.toHaveBeenCalled();
  });

  it("blocks purging a seated national committee member when enabled", async () => {
    vi.doMock("@/lib/constants/partyActions", async (importActual) => ({
      ...(await importActual<typeof import("@/lib/constants/partyActions")>()),
      PARTY_PURGE_ENABLED: true,
    }));

    const { POST } = await import("./route");
    const response = await POST(makeRequest(targetId), {
      params: Promise.resolve({ code: "us", id: "1" }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/committee members cannot be purged/i);
    expect(db.collectionMocks["characters"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["politicalParties"]!.updateOne).not.toHaveBeenCalled();

    const { getCurrentTurn } = await import("@/lib/turn/currentTurn");
    expect(getCurrentTurn).not.toHaveBeenCalled();
  });
});
