import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/api/requirePlayerTransfers", () => ({
  requirePlayerTransfersEnabled: vi.fn(async () => null),
}));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn(async () => ({ currentTurn: 100 })) }));

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/us/parties/1/treasury/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/country/[code]/parties/[id]/treasury/request", () => {
  let db: MockDb;
  const userId = new ObjectId();
  const memberId = new ObjectId();
  const chairId = new ObjectId();
  const partyOid = new ObjectId();
  const partyId = "1";

  function call() {
    return import("./route").then(({ POST }) =>
      POST(makeRequest({ amount: 50_000 }), {
        params: Promise.resolve({ code: "us", id: partyId }),
      })
    );
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("pendingTreasuryTransactions");
    db.collection("nationalPartyElections");

    db.collectionMocks["nationalPartyElections"]!.countDocuments.mockResolvedValue(0);

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: userId.toString(),
        username: "member",
        isAdmin: false,
        isBanned: false,
        character: { _id: memberId, name: "Member", party: partyId, countryId: "US" },
      },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: partyOid,
      sequentialId: Number(partyId),
      countryId: "US",
      name: "Test Party",
      treasury: 5_000_000,
      chairId,
      treasurerId: new ObjectId(),
    } as never);
  });

  it("queues a request when nothing blocks it", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(db.collectionMocks["pendingTreasuryTransactions"]!.insertOne).toHaveBeenCalled();
  });

  it("refuses to queue a request during the leadership election freeze", async () => {
    // Sends cannot be queued during the window either, and the approve
    // route would refuse this row anyway, so it must not be created.
    db.collectionMocks["nationalPartyElections"]!.countDocuments.mockResolvedValue(1);

    const response = await call();
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/leadership election/i);
    expect(db.collectionMocks["pendingTreasuryTransactions"]!.insertOne).not.toHaveBeenCalled();
  });
});
