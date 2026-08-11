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
    db.collection("adminLogs");
    db.collection("activityLog");

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
});
