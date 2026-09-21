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
vi.mock("@/lib/db/partyLookup", () => ({
  findPartyBySequentialId: vi.fn(),
  getStatePartyOrgDocumentId: vi.fn(),
}));
vi.mock("@/lib/db/collections", () => ({ getPartyBudgetCollection: vi.fn(async () => ({})) }));
vi.mock("@/lib/partyBudgetGuards", () => ({ findPartyBudgetForScope: vi.fn(async () => null) }));
vi.mock("@/lib/partyTreasuryPlan", () => ({
  wouldTriggerTreasuryReserveOverride: vi.fn(() => false),
}));
vi.mock("@/lib/treasury/emit", () => ({ emitTreasuryTransaction: vi.fn(async () => {}) }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(
    (retryAfter: number) =>
      new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      })
  ),
}));

function makeRequest(amount: number) {
  return new Request("http://localhost/api/country/us/region/PA/party/1/transfer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount }),
  });
}

describe("POST /api/country/[code]/region/[id]/party/[partyId]/transfer", () => {
  let db: MockDb;
  const userId = new ObjectId();
  const chairId = new ObjectId();
  const partyOid = new ObjectId();
  const partyId = "1";
  const stateId = "PA";
  const statePartyKey = `${stateId}_${partyId}`;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("states");
    db.collection("statePartyOrg");
    db.collection("politicalParties");
    db.collection("adminLogs");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: userId.toString(),
        username: "chair",
        isAdmin: false,
        character: { _id: chairId, name: "State Chair", countryId: "US" },
      },
    } as never);

    const { findPartyBySequentialId, getStatePartyOrgDocumentId } =
      await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: partyOid,
      sequentialId: Number(partyId),
      countryId: "US",
      name: "Test Party",
      chairId: new ObjectId(),
    } as never);
    vi.mocked(getStatePartyOrgDocumentId).mockReturnValue(statePartyKey);

    db.collectionMocks["states"]!.findOne.mockResolvedValue({ _id: stateId, countryId: "US" });
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue({
      _id: statePartyKey,
      stateId,
      partyId,
      treasury: 20_000,
      chairId,
    });
  });

  function transfer(amount: number) {
    return import("./route").then(({ POST }) =>
      POST(makeRequest(amount), {
        params: Promise.resolve({ code: "us", id: stateId, partyId }),
      })
    );
  }

  it("transfers and credits the national party treasury on success", async () => {
    const response = await transfer(2_500);
    expect(response.status).toBe(200);
    expect(db.collectionMocks["statePartyOrg"]!.updateOne).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks["politicalParties"]!.updateOne).toHaveBeenCalledTimes(1);
  });

  it("refunds the state treasury when the national credit throws after the debit", async () => {
    db.collectionMocks["politicalParties"]!.updateOne.mockRejectedValueOnce(
      new Error("credit down")
    );

    const response = await transfer(2_500);

    expect(response.status).toBeGreaterThanOrEqual(500);
    // Debit then refund, both against the same state treasury.
    expect(db.collectionMocks["statePartyOrg"]!.updateOne).toHaveBeenCalledTimes(2);
    const debit = db.collectionMocks["statePartyOrg"]!.updateOne.mock.calls[0]![1] as {
      $inc: Record<string, number>;
    };
    const refund = db.collectionMocks["statePartyOrg"]!.updateOne.mock.calls[1]![1] as {
      $inc: Record<string, number>;
    };
    expect(debit.$inc).toMatchObject({ treasury: -2_500 });
    expect(refund.$inc).toMatchObject({ treasury: 2_500 });
    expect(db.collectionMocks["adminLogs"]!.insertOne).not.toHaveBeenCalled();
  });

  it("refunds the state treasury and returns 404 when the national party disappears", async () => {
    db.collectionMocks["politicalParties"]!.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const response = await transfer(2_500);

    expect(response.status).toBe(404);
    expect(db.collectionMocks["statePartyOrg"]!.updateOne).toHaveBeenCalledTimes(2);
    const refund = db.collectionMocks["statePartyOrg"]!.updateOne.mock.calls[1]![1] as {
      $inc: Record<string, number>;
    };
    expect(refund.$inc).toMatchObject({ treasury: 2_500 });
  });
});
