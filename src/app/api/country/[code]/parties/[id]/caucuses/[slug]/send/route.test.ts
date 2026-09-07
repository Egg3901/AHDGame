import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
  getMongoClient: vi.fn(async () => ({
    startSession: () => ({
      withTransaction: vi.fn(async (callback: () => Promise<unknown>) => callback()),
      endSession: vi.fn(async () => {}),
    }),
  })),
}));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/db/caucusLookup", () => ({
  findCaucusBySlug: vi.fn(),
  listCaucusMemberships: vi.fn(),
}));
vi.mock("@/lib/api/requirePlayerTransfers", () => ({
  requirePlayerTransfersEnabled: vi.fn(async () => null),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn(async () => false) }));
vi.mock("@/lib/treasury/emit", () => ({ emitTreasuryTransaction: vi.fn(async () => {}) }));

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/us/parties/1/caucuses/test/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/country/[code]/parties/[id]/caucuses/[slug]/send", () => {
  let db: MockDb;
  const userId = new ObjectId();
  const caucusChairId = new ObjectId();
  const memberId = new ObjectId();
  const caucusOid = new ObjectId();
  const partyId = "1";

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("caucuses");
    db.collection("characters");
    db.collection("adminLogs");
    db.collection("activityLog");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: userId.toString(),
        username: "chair",
        isAdmin: false,
        character: { _id: caucusChairId, name: "Caucus Chair", countryId: "US", party: partyId },
      },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: Number(partyId),
      countryId: "US",
      name: "Test Party",
    } as never);

    const { findCaucusBySlug, listCaucusMemberships } = await import("@/lib/db/caucusLookup");
    vi.mocked(findCaucusBySlug).mockResolvedValue({
      caucus: {
        _id: caucusOid,
        slug: "test",
        name: "Test Caucus",
        countryId: "US",
        partyId,
        chairId: caucusChairId,
        treasury: 5_000_000,
      },
    } as never);
    vi.mocked(listCaucusMemberships).mockResolvedValue([
      { memberId: caucusChairId },
      { memberId },
    ] as never);
  });

  it("refuses a caucus chair sending caucus funds to themselves", async () => {
    // A caucus has a single officer, so there is no second signature to
    // fall back on the way the party treasury has.
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: caucusChairId,
      name: "Caucus Chair",
      party: partyId,
      countryId: "US",
      userId,
    });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ characterId: caucusChairId.toString(), amount: 1_000_000 }),
      { params: Promise.resolve({ code: "us", id: partyId, slug: "test" }) }
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toMatch(/themselves/i);
    expect(db.collectionMocks["caucuses"]!.updateOne).not.toHaveBeenCalled();
  });

  it("refuses a send to a second character owned by the chair's own account", async () => {
    // Different character id, same owning account. A character-only check
    // would let this through.
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: memberId,
      name: "Chair Alt",
      party: partyId,
      countryId: "US",
      userId,
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ characterId: memberId.toString(), amount: 1_000 }), {
      params: Promise.resolve({ code: "us", id: partyId, slug: "test" }),
    });

    expect(response.status).toBe(403);
    expect(db.collectionMocks["caucuses"]!.updateOne).not.toHaveBeenCalled();
  });

  it("still allows the chair to send to another caucus member", async () => {
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: memberId,
      name: "Member",
      party: partyId,
      countryId: "US",
      userId: new ObjectId(),
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ characterId: memberId.toString(), amount: 1_000 }), {
      params: Promise.resolve({ code: "us", id: partyId, slug: "test" }),
    });

    expect(response.status).toBe(200);
    expect(db.collectionMocks["caucuses"]!.updateOne).toHaveBeenCalled();
  });
});
