/**
 * Growth-frontier re-check when a leader approves a pending join request.
 *
 * The frontier can shrink between the request being filed and it being
 * approved (members leave, NPPs retire), so the gate runs again at accept time.
 * `partyFrontier` is mocked; its behaviour is unit-tested in
 * `src/lib/parties/partyFrontier.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(900) }));
vi.mock("@/lib/db/partyLookup", async () => {
  const actual = await vi.importActual<object>("@/lib/db/partyLookup");
  return { ...actual, findPartyBySequentialId: vi.fn() };
});
vi.mock("@/lib/parties/partyFrontier", () => ({ canCharacterJoinParty: vi.fn() }));
vi.mock("@/lib/parties/applyCharacterPartyJoin", () => ({
  applyCharacterPartyJoin: vi.fn().mockResolvedValue({ becameChair: false }),
}));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/parties/actingChair", () => ({ canActAsChair: vi.fn().mockReturnValue(true) }));

const chairId = new ObjectId();
const requesterId = new ObjectId();
const partyObjectId = new ObjectId();

function makeRequest(action: "accept" | "decline" = "accept") {
  return new Request("http://localhost/api/country/us/parties/7/join-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, characterId: requesterId.toString() }),
  });
}

const params = Promise.resolve({ code: "us", id: "7" });

describe("POST join-requests — growth frontier re-check on accept", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "chair",
        isAdmin: false,
        hasCharacter: true,
        character: { _id: chairId, name: "Chair", countryId: "US", homeState: "NY" },
      },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: partyObjectId,
      sequentialId: 7,
      countryId: "US",
      name: "Northeast Labor Party",
      chairId,
      membershipMode: "approval",
      pendingJoinRequests: [{ characterId: requesterId, characterName: "Hopeful" }],
    } as never);

    db.collection("characters").findOne.mockResolvedValue({
      _id: requesterId,
      name: "Hopeful",
      countryId: "US",
      homeState: "CA",
      party: "independent",
      userId: new ObjectId(),
    });
    db.collection("politicalParties").updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
  });

  it("blocks accepting a requester who is now outside the frontier", async () => {
    const { canCharacterJoinParty } = await import("@/lib/parties/partyFrontier");
    vi.mocked(canCharacterJoinParty).mockResolvedValue({
      ok: false,
      error: "Northeast Labor Party is not established in or next to your home region.",
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest("accept"), { params });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("not established in or next to");

    const { applyCharacterPartyJoin } = await import("@/lib/parties/applyCharacterPartyJoin");
    expect(vi.mocked(applyCharacterPartyJoin)).not.toHaveBeenCalled();
  });

  it("accepts a requester inside the frontier", async () => {
    const { canCharacterJoinParty } = await import("@/lib/parties/partyFrontier");
    vi.mocked(canCharacterJoinParty).mockResolvedValue({ ok: true });

    const { POST } = await import("./route");
    const res = await POST(makeRequest("accept"), { params });

    expect(res.status).toBe(200);
    const { applyCharacterPartyJoin } = await import("@/lib/parties/applyCharacterPartyJoin");
    expect(vi.mocked(applyCharacterPartyJoin)).toHaveBeenCalledOnce();
  });

  it("re-checks using the requester, not the approving chair", async () => {
    const { canCharacterJoinParty } = await import("@/lib/parties/partyFrontier");
    vi.mocked(canCharacterJoinParty).mockResolvedValue({ ok: true });

    const { POST } = await import("./route");
    await POST(makeRequest("accept"), { params });

    const [, charArg] = vi.mocked(canCharacterJoinParty).mock.calls[0];
    expect((charArg as { homeState: string }).homeState).toBe("CA");
  });

  it("does not run the frontier check when declining", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest("decline"), { params });

    expect(res.status).toBe(200);
    const { canCharacterJoinParty } = await import("@/lib/parties/partyFrontier");
    expect(vi.mocked(canCharacterJoinParty)).not.toHaveBeenCalled();
  });
});
