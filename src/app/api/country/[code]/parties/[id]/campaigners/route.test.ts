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
  return new Request("http://localhost/api/country/us/parties/1/campaigners", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/country/[code]/parties/[id]/campaigners", () => {
  let db: MockDb;
  let chairId: ObjectId;
  let memberA: ObjectId;
  let memberB: ObjectId;
  let memberC: ObjectId;
  let outsiderId: ObjectId;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("characters");
    db.collection("politicalParties");

    chairId = new ObjectId();
    memberA = new ObjectId();
    memberB = new ObjectId();
    memberC = new ObjectId();
    outsiderId = new ObjectId();

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
        username: "chair",
        isAdmin: false,
        character: { _id: chairId, name: "Chair" },
      },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Test Party",
      chairId,
      viceChairId: new ObjectId(),
    } as never);

    // Default: characters lookup returns matching members
    db.collectionMocks["characters"]!.find.mockReturnValue({
      toArray: async () => [
        { _id: memberA, name: "Alice", party: "1", countryId: "US" },
        { _id: memberB, name: "Bob", party: "1", countryId: "US" },
      ],
    } as never);
  });

  // Ticket #974: the national chair could re-grant campaign powers that the
  // state-leadership relocation gate (#949) is meant to withhold.
  it("rejects a campaigner who relocated within the residency window", async () => {
    db.collectionMocks["characters"]!.find.mockReturnValue({
      toArray: async () => [
        { _id: memberA, name: "Alice", party: "1", countryId: "US" },
        {
          _id: memberB,
          name: "Fresh Mover",
          party: "1",
          countryId: "US",
          lastRelocatedTurn: 190,
        },
      ],
    } as never);
    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ campaignerIds: [memberA.toString(), memberB.toString()] }),
      { params: Promise.resolve({ code: "us", id: "1" }) }
    );
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toMatch(/relocated recently/i);
    expect(body.turnsRemaining).toBe(14);
    expect(db.collectionMocks["politicalParties"]!.updateOne).not.toHaveBeenCalled();
  });

  it("rejects invalid country code", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ campaignerIds: [] }), {
      params: Promise.resolve({ code: "zz", id: "1" }),
    });
    expect(response.status).toBe(400);
  });

  it("returns 404 when party is missing", async () => {
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue(null);
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ campaignerIds: [] }), {
      params: Promise.resolve({ code: "us", id: "1" }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 403 for non-chair (vice-chair excluded too)", async () => {
    const viceChairId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "vc",
        isAdmin: false,
        character: { _id: viceChairId, name: "VC" },
      },
    } as never);
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Test Party",
      chairId: new ObjectId(),
      viceChairId,
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ campaignerIds: [memberA.toString()] }), {
      params: Promise.resolve({ code: "us", id: "1" }),
    });
    expect(response.status).toBe(403);
  });

  it("rejects more than MAX_NATIONAL_CAMPAIGNERS (3)", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({
        campaignerIds: [
          memberA.toString(),
          memberB.toString(),
          memberC.toString(),
          new ObjectId().toString(),
        ],
      }),
      { params: Promise.resolve({ code: "us", id: "1" }) }
    );
    expect(response.status).toBe(400);
  });

  it("rejects duplicate ids", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ campaignerIds: [memberA.toString(), memberA.toString()] }),
      { params: Promise.resolve({ code: "us", id: "1" }) }
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/duplicate/i);
  });

  it("rejects when a candidate isn't a current party member", async () => {
    db.collectionMocks["characters"]!.find.mockReturnValue({
      toArray: async () => [
        { _id: memberA, name: "Alice", party: "1", countryId: "US" },
        { _id: outsiderId, name: "Outsider", party: "2", countryId: "US" },
      ],
    } as never);
    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ campaignerIds: [memberA.toString(), outsiderId.toString()] }),
      { params: Promise.resolve({ code: "us", id: "1" }) }
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/not a current member/i);
  });

  it("rejects when an id doesn't resolve to a character", async () => {
    db.collectionMocks["characters"]!.find.mockReturnValue({
      toArray: async () => [{ _id: memberA, name: "Alice", party: "1", countryId: "US" }],
    } as never);
    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ campaignerIds: [memberA.toString(), new ObjectId().toString()] }),
      { params: Promise.resolve({ code: "us", id: "1" }) }
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/not valid characters/i);
  });

  it("happy path — chair sets 2 campaigners", async () => {
    db.collectionMocks["characters"]!.find.mockReturnValue({
      toArray: async () => [
        { _id: memberA, name: "Alice", party: "1", countryId: "US" },
        { _id: memberB, name: "Bob", party: "1", countryId: "US" },
      ],
    } as never);
    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ campaignerIds: [memberA.toString(), memberB.toString()] }),
      { params: Promise.resolve({ code: "us", id: "1" }) }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.campaignerIds).toEqual([memberA.toString(), memberB.toString()]);
    expect(db.collectionMocks["politicalParties"]!.updateOne).toHaveBeenCalled();
  });

  it("happy path — empty array clears all campaigners", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ campaignerIds: [] }), {
      params: Promise.resolve({ code: "us", id: "1" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.campaignerIds).toEqual([]);
  });

  it("admin override works", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "admin",
        isAdmin: true,
        character: { _id: new ObjectId(), name: "Admin" },
      },
    } as never);
    db.collectionMocks["characters"]!.find.mockReturnValue({
      toArray: async () => [{ _id: memberA, name: "Alice", party: "1", countryId: "US" }],
    } as never);
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ campaignerIds: [memberA.toString()] }), {
      params: Promise.resolve({ code: "us", id: "1" }),
    });
    expect(response.status).toBe(200);
  });
});
