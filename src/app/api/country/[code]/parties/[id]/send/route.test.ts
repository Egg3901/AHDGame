import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
  getMongoClient: vi.fn(async () => ({
    startSession: () => ({
      withTransaction: vi.fn(async () => {
        const err = new Error("transactions not supported on standalone") as Error & {
          code?: number;
        };
        err.code = 20;
        throw err;
      }),
      endSession: vi.fn(async () => {}),
    }),
  })),
}));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/api/requirePlayerTransfers", () => ({
  requirePlayerTransfersEnabled: vi.fn(async () => null),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn(async () => false) }));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn(async () => ({ currentTurn: 100 })) }));

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/us/parties/1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/country/[code]/parties/[id]/send", () => {
  let db: MockDb;
  const userId = new ObjectId();
  const chairId = new ObjectId();
  const targetCharacterId = new ObjectId();
  const partyId = "1";
  const partyOid = new ObjectId();

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("politicalParties");
    db.collection("characters");
    db.collection("treasuryTransactions");
    db.collection("nationalPartyElections");
    db.collection("adminLogs");
    db.collection("activityLog");

    // No payouts yet this turn, and no leadership election closing.
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
        username: "treasurer",
        isAdmin: false,
        character: {
          _id: chairId,
          name: "Chair",
        },
      },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: partyOid,
      sequentialId: Number(partyId),
      countryId: "US",
      name: "Test Party",
      treasury: 50_000,
      chairId,
      // Exercise the immediate-execute path; the two-person-approval
      // workflow is tested in `pendingTreasuryTransactions.test.ts` +
      // the approve-route test.
      transactionApprovalMode: "single",
    } as never);

    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: targetCharacterId,
      name: "Member",
      party: partyId,
      countryId: "US",
    });
  });

  it("refunds the treasury and returns 404 when the recipient disappears after debit", async () => {
    db.collectionMocks["characters"]!.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ characterId: targetCharacterId.toString(), amount: 5_000 }),
      {
        params: Promise.resolve({ code: "us", id: partyId }),
      }
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toMatch(/character not found/i);

    expect(db.collectionMocks["politicalParties"]!.updateOne).toHaveBeenCalledTimes(2);
    const debitCall = db.collectionMocks["politicalParties"]!.updateOne.mock.calls[0];
    expect((debitCall[1] as Record<string, Record<string, number>>)["$inc"]).toMatchObject({
      treasury: -5_000,
    });

    const refundCall = db.collectionMocks["politicalParties"]!.updateOne.mock.calls[1];
    expect((refundCall[1] as Record<string, Record<string, number>>)["$inc"]).toMatchObject({
      treasury: 5_000,
    });
    expect(db.collectionMocks["adminLogs"]!.insertOne).not.toHaveBeenCalled();
  });

  it("aborts the transaction path with 404 when the recipient disappears on replica-set Mongo", async () => {
    const { getMongoClient } = await import("@/lib/mongodb");
    vi.mocked(getMongoClient).mockResolvedValue({
      startSession: () => ({
        withTransaction: vi.fn(async (callback: () => Promise<unknown>) => callback()),
        endSession: vi.fn(async () => {}),
      }),
    } as never);

    db.collectionMocks["characters"]!.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ characterId: targetCharacterId.toString(), amount: 5_000 }),
      {
        params: Promise.resolve({ code: "us", id: partyId }),
      }
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toMatch(/character not found/i);
    expect(db.collectionMocks["politicalParties"]!.updateOne).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks["adminLogs"]!.insertOne).not.toHaveBeenCalled();
  });

  // ─── Per-turn payout cap + leadership election freeze ─────────────────────

  /** Rich party, so the cap is what bites rather than the balance. */
  async function richParty() {
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: partyOid,
      sequentialId: Number(partyId),
      countryId: "US",
      name: "Test Party",
      treasury: 50_000_000,
      chairId,
      transactionApprovalMode: "single",
    } as never);
  }

  function send(amount: number) {
    return import("./route").then(({ POST }) =>
      POST(makeRequest({ characterId: targetCharacterId.toString(), amount }), {
        params: Promise.resolve({ code: "us", id: partyId }),
      })
    );
  }

  it("refuses a send that would push the recipient over their per-turn cap", async () => {
    // US cap is 2,000,000 and 1,500,000 is already spent this turn.
    await richParty();
    db.collectionMocks["treasuryTransactions"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ total: 1_500_000 }]),
    });

    const response = await send(600_000);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/500,000 more/);
    expect(db.collectionMocks["politicalParties"]!.updateOne).not.toHaveBeenCalled();
  });

  it("allows a send that lands exactly on the cap", async () => {
    await richParty();
    db.collectionMocks["treasuryTransactions"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ total: 1_500_000 }]),
    });

    const response = await send(500_000);
    expect(response.status).toBe(200);
    expect(db.collectionMocks["politicalParties"]!.updateOne).toHaveBeenCalled();
  });

  it("counts state party and caucus payouts towards the same cap", async () => {
    // The ledger sum is deliberately not filtered by holderType, so a
    // player already paid from a state party cannot top up nationally.
    await richParty();
    db.collectionMocks["treasuryTransactions"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ total: 2_000_000 }]),
    });

    const response = await send(1_000);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/already received the maximum/);
  });

  it("refuses any send in the closing turns of a leadership election", async () => {
    db.collectionMocks["nationalPartyElections"]!.countDocuments.mockResolvedValue(1);

    const response = await send(1_000);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/leadership election/i);
    expect(db.collectionMocks["politicalParties"]!.updateOne).not.toHaveBeenCalled();
  });
});
