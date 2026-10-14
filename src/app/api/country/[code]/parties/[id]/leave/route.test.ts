import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/utils/electionCandidacy", () => ({
  withdrawFromMismatchedPrimaries: vi.fn().mockResolvedValue({ withdrawnCount: 0 }),
  cleanupPartyPositionsOnSwitch: vi.fn().mockResolvedValue({
    clearedNationalLeadership: [],
    clearedStateLeadership: [],
    withdrawnStateElections: 0,
    withdrawnNationalElections: 0,
    removedFromCommittee: false,
    withdrawnCommitteeElections: 0,
  }),
}));
vi.mock("@/lib/turn/partyOrg/presence", () => ({ updatePartyPresence: vi.fn() }));
vi.mock("@/lib/caucus/cleanupCaucusParticipationForCharacters", () => ({
  cleanupCaucusParticipationForCharacters: vi.fn().mockResolvedValue({
    membershipsClosed: 0,
    chairSeatsCleared: 0,
    viceChairSeatsCleared: 0,
  }),
}));
vi.mock("@/lib/parties/membershipEvents", () => ({
  emitPartyMembershipEvent: vi.fn(),
  buildPartyEventSnapshots: vi.fn().mockReturnValue({}),
}));

function makeRequest() {
  return new Request("http://localhost/api/country/us/parties/1/leave", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

describe("POST /api/country/[code]/parties/[id]/leave", () => {
  let db: MockDb;
  const characterId = new ObjectId();
  const partyObjectId = new ObjectId();

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("characters");
    db.collection("electedOfficials");
    db.collection("politicalParties");
    db.collection("coalitions");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "member",
        isAdmin: false,
        character: {
          _id: characterId,
          name: "Leaver",
          countryId: "US",
          homeState: "CA",
          party: "1",
        },
      },
    } as never);
    db.collection("characters").findOne.mockImplementation(async () => {
      const current = await requireAuthWithCharacter();
      return current.ok ? current.user.character : null;
    });
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: partyObjectId,
      sequentialId: 1,
      countryId: "US",
      name: "Old Party",
      isDefault: true,
      chairId: new ObjectId(),
      viceChairId: null,
      treasurerId: null,
    } as never);
  });

  it("does not arm the party-switch cooldown when leaving to become independent", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: "1" }),
    });

    expect(response.status).toBe(200);

    const charUpdate = db.collectionMocks["characters"]!.updateOne.mock.calls[0]!;
    const update = charUpdate[1] as {
      $set?: Record<string, unknown>;
      $unset?: Record<string, unknown>;
    };

    // Becoming independent is not a party switch — it must NOT (re)arm the
    // 24-hour join cooldown anchored by lastPartySwitchAt.
    expect(update.$set).not.toHaveProperty("lastPartySwitchAt");
    expect(update.$unset ?? {}).not.toHaveProperty("lastPartySwitchAt");

    // It still flips the character to independent and clears the tenure anchors.
    expect(update.$set).toMatchObject({ party: "independent" });
    expect(update.$unset).toMatchObject({
      partyJoinedAt: "",
      partyJoinedTurn: "",
      // A founder who walks out loses the leadership tenure exemption too,
      // otherwise rejoining later would revive it (leadershipTenure.ts).
      foundedPartyId: "",
    });
  });

  it.each([false, true])(
    "recomputes reconnect-only growth after leaving; another bridge resident remains: %s",
    async (anotherResident) => {
      const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
      const auth = await requireAuthWithCharacter();
      if (!auth.ok) throw new Error("Expected fixture authentication");
      vi.mocked(requireAuthWithCharacter).mockResolvedValue({
        ...auth,
        user: { ...auth.user, character: { ...auth.user.character, homeState: "OR" } },
      });
      let memberLeft = false;
      let officeLeft = false;
      const states = ["WA", "OR", "CA", "AZ"];
      db.collection("states").find.mockReturnValue({
        toArray: async () => states.map((_id) => ({ _id })),
      });
      db.collection("characters").distinct.mockImplementation(async () =>
        memberLeft && !anotherResident ? ["WA", "CA"] : ["WA", "OR", "CA"]
      );
      db.collection("electedOfficials").distinct.mockImplementation(async () =>
        officeLeft ? [] : ["OR"]
      );
      db.collection("characters").updateOne.mockImplementation(async () => {
        memberLeft = true;
        return { matchedCount: 1, modifiedCount: 1, acknowledged: true };
      });
      db.collection("electedOfficials").updateMany.mockImplementation(async () => {
        officeLeft = true;
        return { matchedCount: 1, modifiedCount: 1, acknowledged: true };
      });

      const { getPartyFrontier } = await import("@/lib/parties/partyFrontier");
      const before = await getPartyFrontier(db as unknown as Db, "US", "1");
      expect(before.frontier.has("AZ")).toBe(true);
      const { POST } = await import("./route");
      const response = await POST(makeRequest(), {
        params: Promise.resolve({ code: "us", id: "1" }),
      });
      // Leaving is allowed even when it removes the last connecting foothold.
      expect(response.status).toBe(200);
      const after = await getPartyFrontier(db as unknown as Db, "US", "1");
      expect(after.frontier.has("OR")).toBe(true);
      expect(after.frontier.has("AZ")).toBe(anotherResident);
      expect(after.presence.has("OR")).toBe(anotherResident);
    }
  );

  it("clears state-party leadership seats the leaver held, not just national ones (ticket #0860)", async () => {
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: partyObjectId,
      sequentialId: 1,
      countryId: "US",
      name: "Old Party",
      isDefault: true,
      chairId: characterId,
      viceChairId: null,
      treasurerId: null,
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: "1" }),
    });

    expect(response.status).toBe(200);

    const statePartyOrgUpdateMany = db.collection("statePartyOrg").updateMany;
    expect(statePartyOrgUpdateMany).toHaveBeenCalledWith(
      { chairId: characterId },
      { $set: { chairId: null, updatedAt: expect.any(Date) } }
    );
    expect(statePartyOrgUpdateMany).toHaveBeenCalledWith(
      { viceChairId: characterId },
      { $set: { viceChairId: null, updatedAt: expect.any(Date) } }
    );
    expect(statePartyOrgUpdateMany).toHaveBeenCalledWith(
      { treasurerId: characterId },
      { $set: { treasurerId: null, updatedAt: expect.any(Date) } }
    );
    expect(statePartyOrgUpdateMany).toHaveBeenCalledWith(
      { campaignerId: characterId },
      { $set: { campaignerId: null, updatedAt: expect.any(Date) } }
    );
  });
});
