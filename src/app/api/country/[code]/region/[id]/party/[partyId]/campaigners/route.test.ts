import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));
vi.mock("@/lib/db/partyLookup", async () => {
  const actual = await vi.importActual<object>("@/lib/db/partyLookup");
  return { ...actual, findPartyBySequentialId: vi.fn() };
});

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/us/region/CA/party/1/campaigners", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/country/[code]/region/[id]/party/[partyId]/campaigners", () => {
  let db: MockDb;
  let stateChairId: ObjectId;
  let inStateMember: ObjectId;
  let outOfStateMember: ObjectId;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("states");
    db.collection("statePartyOrg");
    db.collection("characters");

    stateChairId = new ObjectId();
    inStateMember = new ObjectId();
    outOfStateMember = new ObjectId();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { getGameTime } = await import("@/lib/time/gameTime");
    vi.mocked(getGameTime).mockResolvedValue({
      currentTurn: 200,
      effectiveNow: new Date("2026-07-12T00:00:00Z").getTime(),
    } as never);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "stateChair",
        isAdmin: false,
        character: { _id: stateChairId, name: "State Chair" },
      },
    } as never);

    db.collectionMocks["states"]!.findOne.mockResolvedValue({
      _id: "CA",
      name: "California",
    });

    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue({
      _id: "CA_1",
      stateId: "CA",
      partyId: "1",
      countryId: "US",
      chairId: stateChairId,
      viceChairId: new ObjectId(),
    });

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Test Party",
      chairId: new ObjectId(),
    } as never);
  });

  it("rejects invalid country code", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ campaignerId: null }), {
      params: Promise.resolve({ code: "zz", id: "CA", partyId: "1" }),
    });
    expect(response.status).toBe(400);
  });

  it("returns 404 when state-party row is missing", async () => {
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue(null);
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ campaignerId: null }), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 403 for state vice-chair (excluded)", async () => {
    const viceId = new ObjectId();
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue({
      _id: "CA_1",
      stateId: "CA",
      partyId: "1",
      countryId: "US",
      chairId: new ObjectId(),
      viceChairId: viceId,
    });
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "vc",
        isAdmin: false,
        character: { _id: viceId, name: "VC" },
      },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ campaignerId: inStateMember.toString() }), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }),
    });
    expect(response.status).toBe(403);
  });

  it("rejects an out-of-state member", async () => {
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: outOfStateMember,
      name: "TX Tex",
      party: "1",
      countryId: "US",
      homeState: "TX",
    });
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ campaignerId: outOfStateMember.toString() }), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/in-state/i);
  });

  it("rejects a non-party member", async () => {
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: inStateMember,
      name: "Outsider",
      party: "2", // wrong party
      countryId: "US",
      homeState: "CA",
    });
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ campaignerId: inStateMember.toString() }), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/not a current member/i);
  });

  it("happy path — state chair assigns an in-state member", async () => {
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: inStateMember,
      name: "Cali Carla",
      party: "1",
      countryId: "US",
      homeState: "CA",
    });
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ campaignerId: inStateMember.toString() }), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.campaignerId).toBe(inStateMember.toString());
    expect(db.collectionMocks["statePartyOrg"]!.updateOne).toHaveBeenCalledWith(
      { _id: "CA_1" },
      expect.objectContaining({
        $set: expect.objectContaining({ campaignerId: inStateMember }),
      })
    );
  });

  // Ticket #974: the state-leadership relocation gate (#949) was bypassable by
  // appointing the freshly-moved character as state campaigner instead.
  it("rejects a member who relocated within the residency window", async () => {
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: inStateMember,
      name: "Fresh Mover",
      party: "1",
      countryId: "US",
      homeState: "CA",
      lastRelocatedTurn: 190, // 10 turns ago, window is 24
    });
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ campaignerId: inStateMember.toString() }), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }),
    });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toMatch(/relocated recently/i);
    expect(body.turnsRemaining).toBe(14);
    expect(db.collectionMocks["statePartyOrg"]!.updateOne).not.toHaveBeenCalled();
  });

  it("allows a member whose relocation is outside the residency window", async () => {
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: inStateMember,
      name: "Settled Sam",
      party: "1",
      countryId: "US",
      homeState: "CA",
      lastRelocatedTurn: 100,
    });
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ campaignerId: inStateMember.toString() }), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }),
    });
    expect(response.status).toBe(200);
  });

  it("happy path — null clears the campaigner", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ campaignerId: null }), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.campaignerId).toBeNull();
  });

  it("national chair can also assign", async () => {
    const natChairId = new ObjectId();
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Test Party",
      chairId: natChairId,
    } as never);
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "natchair",
        isAdmin: false,
        character: { _id: natChairId, name: "Nat Chair" },
      },
    } as never);
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: inStateMember,
      name: "Cali Carla",
      party: "1",
      countryId: "US",
      homeState: "CA",
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ campaignerId: inStateMember.toString() }), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }),
    });
    expect(response.status).toBe(200);
  });
});
