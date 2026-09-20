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
      treasury: 50_000_000,
      chairId,
      treasurerId: new ObjectId(),
    } as never);
  });

  /** Re-seat the party with exactly one officer, so the base cap applies. */
  async function soleOfficerParty() {
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: partyOid,
      sequentialId: Number(partyId),
      countryId: "US",
      name: "Test Party",
      treasury: 50_000_000,
      chairId,
      viceChairId: null,
      treasurerId: null,
    } as never);
  }

  it("refuses a request above the per-turn payout ceiling", async () => {
    // Nothing used to stop this. The cap was only consulted at the very
    // end of the approve flow, by which point that route had already
    // claimed an approver's signature on a row that could never pay.
    // One officer seated, so the base 2,000,000 ceiling is in force.
    await soleOfficerParty();
    const response = await import("./route").then(({ POST }) =>
      POST(makeRequest({ amount: 3_000_000 }), {
        params: Promise.resolve({ code: "us", id: partyId }),
      })
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/2,000,000/);
    expect(db.collectionMocks["pendingTreasuryTransactions"]!.insertOne).not.toHaveBeenCalled();
  });

  it("allows five times as much once a second officer is seated", async () => {
    // The default fixture seats a Chair and a Treasurer, which is the
    // two-officer case: a second pair of eyes on the ledger buys the
    // party a larger ceiling.
    const response = await import("./route").then(({ POST }) =>
      POST(makeRequest({ amount: 9_000_000 }), {
        params: Promise.resolve({ code: "us", id: partyId }),
      })
    );
    expect(response.status).toBe(200);
  });

  it("still refuses above the raised ceiling", async () => {
    const response = await import("./route").then(({ POST }) =>
      POST(makeRequest({ amount: 11_000_000 }), {
        params: Promise.resolve({ code: "us", id: partyId }),
      })
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/10,000,000/);
  });

  it("accepts a request exactly at the ceiling", async () => {
    const response = await import("./route").then(({ POST }) =>
      POST(makeRequest({ amount: 2_000_000 }), {
        params: Promise.resolve({ code: "us", id: partyId }),
      })
    );
    expect(response.status).toBe(200);
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
