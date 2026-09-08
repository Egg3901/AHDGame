import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/api/requirePlayerTransfers", () => ({
  requirePlayerTransfersEnabled: vi.fn(async () => null),
}));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn(async () => ({ currentTurn: 100 })) }));
vi.mock("@/lib/db/collections", () => ({ getPartyBudgetCollection: vi.fn(async () => ({})) }));
vi.mock("@/lib/partyBudgetGuards", () => ({ findPartyBudgetForScope: vi.fn(async () => null) }));
vi.mock("@/lib/partyTreasuryPlan", () => ({
  wouldTriggerTreasuryReserveOverride: vi.fn(() => false),
}));
vi.mock("@/lib/treasury/executeTransferToStateParty", () => ({
  executeTransferToStateParty: vi.fn(async () => ({
    ok: true,
    response: NextResponse.json({ success: true }),
  })),
}));

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/us/parties/1/transfer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/country/[code]/parties/[id]/transfer", () => {
  let db: MockDb;
  const userId = new ObjectId();
  const chairId = new ObjectId();
  const partyOid = new ObjectId();
  const partyId = "1";

  async function setParty(overrides: Record<string, unknown> = {}) {
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: partyOid,
      sequentialId: Number(partyId),
      countryId: "US",
      name: "Test Party",
      treasury: 500_000,
      chairId,
      treasurerId: null,
      ...overrides,
    } as never);
  }

  function call() {
    return import("./route").then(({ POST }) =>
      POST(makeRequest({ stateId: "pa", amount: 5_000 }), {
        params: Promise.resolve({ code: "us", id: partyId }),
      })
    );
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("states");
    db.collection("politicalParties");
    db.collection("pendingTreasuryTransactions");
    db.collection("nationalPartyElections");
    db.collection("nationalPartyCandidates");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: userId.toString(),
        username: "chair",
        isAdmin: false,
        character: { _id: chairId, name: "Chair" },
      },
    } as never);

    db.collectionMocks["states"]!.findOne.mockResolvedValue({
      _id: "PA",
      countryId: "US",
      name: "Pennsylvania",
    });
    await setParty();
  });

  it("refuses the transfer while a contested Treasurer election is closing", async () => {
    db.collectionMocks["nationalPartyElections"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: new ObjectId(), endTurn: 103 }]),
    });
    db.collectionMocks["nationalPartyCandidates"]!.countDocuments.mockResolvedValue(1);

    const response = await call();
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/treasurer election/i);

    const { executeTransferToStateParty } =
      await import("@/lib/treasury/executeTransferToStateParty");
    expect(executeTransferToStateParty).not.toHaveBeenCalled();
  });

  it("keeps the vacant-seat fallback when nobody is standing for Treasurer", async () => {
    db.collectionMocks["nationalPartyElections"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: new ObjectId(), endTurn: 103 }]),
    });
    db.collectionMocks["nationalPartyCandidates"]!.countDocuments.mockResolvedValue(0);

    const response = await call();
    expect(response.status).toBe(200);

    const { executeTransferToStateParty } =
      await import("@/lib/treasury/executeTransferToStateParty");
    expect(executeTransferToStateParty).toHaveBeenCalled();
  });

  it("queues for approval when a Treasurer is seated (double mode)", async () => {
    await setParty({ treasurerId: new ObjectId() });

    const response = await call();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pending).toBe(true);
    expect(db.collectionMocks["pendingTreasuryTransactions"]!.insertOne).toHaveBeenCalled();
  });
});
