import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/turn/parliamentaryGovernment", () => ({
  checkAppointmentEligibility: vi.fn(),
}));
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({
    currentTurn: 449,
    lastTurnProcessed: new Date("2026-04-29T21:00:00.000Z"),
    isActive: true,
    pausedAt: null,
    effectiveNow: new Date("2026-04-29T21:00:00.000Z"),
  }),
}));

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/UK/pm/appoint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/country/[code]/pm/appoint", () => {
  let db: MockDb;
  const actorId = new ObjectId();
  const nomineeId = new ObjectId();

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();

    db.collection("governmentFormations").findOne.mockResolvedValue({
      _id: "UK",
      countryId: "UK",
      cycle: 1,
      status: "pending",
      formationType: null,
      lostMajority: false,
      pmCharacterId: null,
      pmName: null,
      governingPartyId: null,
      coalitionId: null,
      coalitionPartyIds: null,
      totalSeatsSupporting: 330,
      majorityThreshold: 326,
      seatsByParty: { "1": 330 },
      totalSeats: 650,
      activeVoteId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    db.collection("characters").findOne.mockResolvedValue({
      _id: nomineeId,
      name: "Nominee",
      party: "1",
      userId: new ObjectId(),
    });
    db.collection("electedOfficials").findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId: nomineeId,
      countryId: "UK",
      officeType: "mp",
      party: "1",
    });

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "chair",
        isAdmin: false,
        isBanned: false,
        character: {
          _id: actorId,
          name: "Chair",
        },
      },
    } as never);

    const { checkAppointmentEligibility } = await import("@/lib/turn/parliamentaryGovernment");
    vi.mocked(checkAppointmentEligibility).mockResolvedValue({
      eligible: true,
      formationType: "majority",
      coalitionId: null,
      coalitionPartyIds: null,
      qualifyingPartyIds: [1],
    } as never);
  });

  it("rejects concurrent nominations when the route lock cannot be claimed", async () => {
    db.collectionMocks.governmentFormations.findOneAndUpdate.mockResolvedValueOnce(null);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ nomineeCharacterId: nomineeId.toString() }), {
      params: Promise.resolve({ code: "UK" }),
    });

    expect(res.status).toBe(409);
    expect(db.collectionMocks.pmAppointmentVotes?.insertOne).toBeUndefined();
  });

  it("releases the nomination lock after creating the vote", async () => {
    db.collectionMocks.governmentFormations.findOneAndUpdate.mockResolvedValueOnce({
      _id: "UK",
      pmAppointmentNominationLockId: new ObjectId(),
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ nomineeCharacterId: nomineeId.toString() }), {
      params: Promise.resolve({ code: "UK" }),
    });

    expect(res.status).toBe(200);
    expect(db.collectionMocks.pmAppointmentVotes.insertOne).toHaveBeenCalledOnce();
    expect(db.collectionMocks.governmentFormations.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "UK", pmAppointmentNominationLockId: expect.any(ObjectId) }),
      expect.objectContaining({
        $unset: { pmAppointmentNominationLockId: "" },
      })
    );
  });
});
