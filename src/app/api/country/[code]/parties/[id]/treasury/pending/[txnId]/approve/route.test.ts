import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn(), getMongoClient: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/api/requirePlayerTransfers", () => ({
  requirePlayerTransfersEnabled: vi.fn(async () => null),
}));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn(async () => ({ currentTurn: 100 })) }));
vi.mock("@/lib/treasury/executeSendToMember", () => ({
  executeSendToMember: vi.fn(async () => ({
    ok: true,
    response: NextResponse.json({ success: true }),
  })),
}));
vi.mock("@/lib/treasury/executeTransferToStateParty", () => ({
  executeTransferToStateParty: vi.fn(async () => ({
    ok: true,
    response: NextResponse.json({ success: true }),
  })),
}));

describe("POST /api/country/[code]/parties/[id]/treasury/pending/[txnId]/approve", () => {
  let db: MockDb;
  const userId = new ObjectId();
  const chairId = new ObjectId();
  const treasurerId = new ObjectId();
  const recipientId = new ObjectId();
  const partyOid = new ObjectId();
  const txnOid = new ObjectId();
  const partyId = "1";

  function row(overrides: Record<string, unknown> = {}) {
    return {
      _id: txnOid,
      partyId: partyOid,
      countryId: "US",
      type: "send",
      amount: 5_000,
      targetCharacterId: recipientId,
      proposedBy: chairId,
      status: "open",
      approvalModeAtPropose: "double",
      leadershipApproval: { characterId: chairId, approvedAt: new Date() },
      ...overrides,
    };
  }

  function call() {
    return import("./route").then(({ POST }) =>
      POST(new Request("http://localhost/approve", { method: "POST" }), {
        params: Promise.resolve({ code: "us", id: partyId, txnId: txnOid.toString() }),
      })
    );
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("pendingTreasuryTransactions");
    db.collection("characters");
    db.collection("nationalPartyElections");

    db.collectionMocks["nationalPartyElections"]!.countDocuments.mockResolvedValue(0);
    db.collectionMocks["pendingTreasuryTransactions"]!.findOne.mockResolvedValueOnce(
      row()
    ).mockResolvedValue(
      row({ treasurerApproval: { characterId: treasurerId, approvedAt: new Date() } })
    );
    db.collectionMocks["pendingTreasuryTransactions"]!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: recipientId,
      name: "Recipient",
      party: partyId,
      countryId: "US",
    });

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: userId.toString(),
        username: "treasurer",
        isAdmin: false,
        isBanned: false,
        character: { _id: treasurerId, name: "Treasurer" },
      },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: partyOid,
      sequentialId: Number(partyId),
      countryId: "US",
      name: "Test Party",
      treasury: 500_000,
      chairId,
      treasurerId,
    } as never);
  });

  it("approves and executes when nothing blocks it", async () => {
    const response = await call();
    expect(response.status).toBe(200);

    const { executeSendToMember } = await import("@/lib/treasury/executeSendToMember");
    expect(executeSendToMember).toHaveBeenCalled();
  });

  it("passes the checked turn to the executor so the cap uses one bucket", async () => {
    await call();
    const { executeSendToMember } = await import("@/lib/treasury/executeSendToMember");
    const [args] = vi.mocked(executeSendToMember).mock.calls[0] as [{ currentTurn: number }];
    expect(args.currentTurn).toBe(100);
  });

  it("refuses to pay out a row queued before the leadership election freeze", async () => {
    // Otherwise a row queued earlier becomes a way through the window.
    db.collectionMocks["nationalPartyElections"]!.countDocuments.mockResolvedValue(1);

    const response = await call();
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/leadership election/i);
    expect(db.collectionMocks["pendingTreasuryTransactions"]!.updateOne).not.toHaveBeenCalled();

    const { executeSendToMember } = await import("@/lib/treasury/executeSendToMember");
    expect(executeSendToMember).not.toHaveBeenCalled();
  });
});
