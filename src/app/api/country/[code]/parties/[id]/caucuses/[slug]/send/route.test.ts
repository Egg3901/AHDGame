import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
  getMongoClient: vi.fn(async () => ({
    startSession: () => ({
      withTransaction: vi.fn(async (cb: () => Promise<unknown>) => cb()),
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
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn(async () => ({ currentTurn: 100 })) }));

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
  const chairId = new ObjectId();
  const memberId = new ObjectId();
  const partyId = "1";

  function call(amount: number) {
    return import("./route").then(({ POST }) =>
      POST(makeRequest({ characterId: memberId.toString(), amount }), {
        params: Promise.resolve({ code: "us", id: partyId, slug: "test" }),
      })
    );
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("caucuses");
    db.collection("characters");
    db.collection("treasuryTransactions");
    db.collection("nationalPartyElections");
    db.collection("adminLogs");
    db.collection("activityLog");

    db.collectionMocks["treasuryTransactions"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks["nationalPartyElections"]!.countDocuments.mockResolvedValue(0);

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: userId.toString(),
        username: "chair",
        isAdmin: false,
        character: { _id: chairId, name: "Caucus Chair", countryId: "US", party: partyId },
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
        _id: new ObjectId(),
        slug: "test",
        name: "Test Caucus",
        countryId: "US",
        partyId,
        chairId,
        treasury: 5_000_000,
      },
    } as never);
    vi.mocked(listCaucusMemberships).mockResolvedValue([
      { memberId: chairId },
      { memberId },
    ] as never);

    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: memberId,
      name: "Member",
      party: partyId,
      countryId: "US",
    });
  });

  it("sends to a caucus member when nothing blocks it", async () => {
    const response = await call(100_000);
    expect(response.status).toBe(200);
    expect(db.collectionMocks["caucuses"]!.updateOne).toHaveBeenCalled();
  });

  it("counts caucus payouts against the same per-turn cap as party funds", async () => {
    // 2,000,000 already received this turn from any party source.
    db.collectionMocks["treasuryTransactions"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ total: 2_000_000 }]),
    });

    const response = await call(100_000);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/already received the maximum/);
    expect(db.collectionMocks["caucuses"]!.updateOne).not.toHaveBeenCalled();
  });

  it("refuses caucus sends during the leadership election freeze", async () => {
    // The caucus must not be a way around the party's handover freeze.
    db.collectionMocks["nationalPartyElections"]!.countDocuments.mockResolvedValue(1);

    const response = await call(100_000);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/leadership election/i);
    expect(db.collectionMocks["caucuses"]!.updateOne).not.toHaveBeenCalled();
  });
});
