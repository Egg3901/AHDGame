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
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn(async () => 1000) }));
vi.mock("@/lib/parties/applyCharacterPartyJoin", () => ({
  applyCharacterPartyJoin: vi.fn(async () => ({ becameChair: false })),
}));

const countryId = "US";
const partyObjId = new ObjectId();
const partySeqId = 5;
const chairCharacterId = new ObjectId();
const requesterId = new ObjectId();

function makeRequest(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/country/us/parties/${partySeqId}/join-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function call(body: Record<string, unknown>) {
  return import("./route").then(({ POST }) =>
    POST(makeRequest(body), {
      params: Promise.resolve({ code: "us", id: String(partySeqId) }),
    })
  );
}

function party(overrides: Record<string, unknown> = {}) {
  return {
    _id: partyObjId,
    sequentialId: partySeqId,
    countryId,
    name: "Test Party",
    chairId: chairCharacterId,
    viceChairId: null,
    membershipMode: "approval",
    pendingJoinRequests: [
      {
        characterId: requesterId,
        characterName: "Jo Requester",
        requestedAt: new Date("2026-07-01"),
      },
    ],
    ...overrides,
  };
}

describe("POST /api/country/[code]/parties/[id]/join-requests", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("politicalParties");
    db.collection("characters");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "chair",
        character: { _id: chairCharacterId, party: "1", countryId },
      },
    } as never);

    // Requester the chair is acting on.
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: requesterId,
      userId: new ObjectId(),
      name: "Jo Requester",
      party: "2",
      countryId,
      homeState: "CA",
    });
  });

  it("accept: applies the join via the shared helper, clears the request, notifies", async () => {
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue(party());

    const res = await call({ action: "accept", characterId: requesterId.toString() });
    expect(res.status).toBe(200);

    const { applyCharacterPartyJoin } = await import("@/lib/parties/applyCharacterPartyJoin");
    expect(applyCharacterPartyJoin).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(applyCharacterPartyJoin).mock.calls[0]![0];
    expect(arg.actorRole).toBe("chair");
    expect(arg.autoChairWhenVacant).toBe(false);
    expect((arg.character as { _id: ObjectId })._id).toBe(requesterId);

    // Pending request is pulled from the party.
    const pull = db.collectionMocks["politicalParties"]!.updateOne.mock.calls.find(
      (c) => (c[1] as { $pull?: unknown }).$pull
    );
    expect(pull).toBeTruthy();

    const { createNotification } = await import("@/lib/notifications");
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "party_join_accepted" })
    );
  });

  it("decline: clears the request without joining, notifies", async () => {
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue(party());

    const res = await call({ action: "decline", characterId: requesterId.toString() });
    expect(res.status).toBe(200);

    const { applyCharacterPartyJoin } = await import("@/lib/parties/applyCharacterPartyJoin");
    expect(applyCharacterPartyJoin).not.toHaveBeenCalled();
    expect(db.collectionMocks["politicalParties"]!.updateOne).toHaveBeenCalled();

    const { createNotification } = await import("@/lib/notifications");
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "party_join_declined" })
    );
  });

  it("rejects a non-leader with 403 and performs no writes", async () => {
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue(
      party({ chairId: new ObjectId(), viceChairId: null })
    );

    const res = await call({ action: "accept", characterId: requesterId.toString() });
    expect(res.status).toBe(403);

    const { applyCharacterPartyJoin } = await import("@/lib/parties/applyCharacterPartyJoin");
    expect(applyCharacterPartyJoin).not.toHaveBeenCalled();
    expect(db.collectionMocks["politicalParties"]!.updateOne).not.toHaveBeenCalled();
  });

  it("rejects when the character has no pending request (400)", async () => {
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue(
      party({ pendingJoinRequests: [] })
    );

    const res = await call({ action: "accept", characterId: requesterId.toString() });
    expect(res.status).toBe(400);

    const { applyCharacterPartyJoin } = await import("@/lib/parties/applyCharacterPartyJoin");
    expect(applyCharacterPartyJoin).not.toHaveBeenCalled();
  });
});
