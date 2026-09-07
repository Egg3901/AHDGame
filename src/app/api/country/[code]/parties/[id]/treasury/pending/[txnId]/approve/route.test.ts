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

function makeRequest() {
  return new Request("http://localhost/approve", { method: "POST" });
}

describe("POST /api/country/[code]/parties/[id]/treasury/pending/[txnId]/approve", () => {
  let db: MockDb;
  const userId = new ObjectId();
  const chairId = new ObjectId();
  const treasurerId = new ObjectId();
  const partyOid = new ObjectId();
  const txnOid = new ObjectId();
  const partyId = "1";

  // Row: Chair proposed a send to themselves. Leadership slot pre-filled.
  function selfSendRow(overrides: Record<string, unknown> = {}) {
    return {
      _id: txnOid,
      partyId: partyOid,
      countryId: "US",
      type: "send",
      amount: 5_000,
      targetCharacterId: chairId,
      proposedBy: chairId,
      status: "open",
      approvalModeAtPropose: "double",
      leadershipApproval: { characterId: chairId, approvedAt: new Date() },
      ...overrides,
    };
  }

  async function authAs(characterId: ObjectId) {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: userId.toString(),
        username: "actor",
        isAdmin: false,
        isBanned: false,
        character: { _id: characterId, name: "Actor" },
      },
    } as never);
  }

  async function setParty(overrides: Record<string, unknown> = {}) {
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: partyOid,
      sequentialId: Number(partyId),
      countryId: "US",
      name: "Test Party",
      treasury: 50_000,
      chairId,
      treasurerId,
      ...overrides,
    } as never);
  }

  function call() {
    return import("./route").then(({ POST }) =>
      POST(makeRequest(), {
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
    db.collection("nationalPartyCandidates");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    await authAs(treasurerId);
    await setParty();
    db.collectionMocks["pendingTreasuryTransactions"]!.findOne.mockResolvedValue(selfSendRow());
    db.collectionMocks["pendingTreasuryTransactions"]!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
    // Recipient is still a member of the party.
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: chairId,
      name: "Chair",
      party: partyId,
      countryId: "US",
      userId: new ObjectId(),
    });
  });

  it("refuses the recipient approving a payment to themselves", async () => {
    // The Chair proposed a self-send, so their leadership slot is filled.
    // Without the recipient exclusion they could take the treasurer slot
    // as acting Treasurer and sign both halves alone.
    await authAs(chairId);
    await setParty({ treasurerId: null });

    const response = await call();
    expect(response.status).toBe(403);
    expect(db.collectionMocks["pendingTreasuryTransactions"]!.updateOne).not.toHaveBeenCalled();
  });

  it("lets a genuine second officer approve the same row", async () => {
    // First findOne is the pre-claim read, second is the post-claim
    // re-read that decides whether the row is now complete.
    db.collectionMocks["pendingTreasuryTransactions"]!.findOne.mockResolvedValueOnce(
      selfSendRow()
    ).mockResolvedValueOnce(
      selfSendRow({ treasurerApproval: { characterId: treasurerId, approvedAt: new Date() } })
    );

    const response = await call();
    expect(response.status).toBe(200);
    expect(db.collectionMocks["pendingTreasuryTransactions"]!.updateOne).toHaveBeenCalled();

    const { executeSendToMember } = await import("@/lib/treasury/executeSendToMember");
    expect(executeSendToMember).toHaveBeenCalled();
  });

  it("refuses payout when the recipient has left the party", async () => {
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: chairId,
      name: "Chair",
      party: "independent",
      countryId: "US",
      userId: new ObjectId(),
    });

    const response = await call();
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/no longer a member/i);
    // Rejected before the slot claim, so the row is not left half-approved.
    expect(db.collectionMocks["pendingTreasuryTransactions"]!.updateOne).not.toHaveBeenCalled();
  });

  it("refuses payout while a contested Treasurer election is closing", async () => {
    // Vacant Treasurer seat, so the Chair is the one who can still reach
    // an empty slot. Row targets an ordinary member, not the approver.
    const memberId = new ObjectId();
    await authAs(chairId);
    await setParty({ treasurerId: null });
    db.collectionMocks["pendingTreasuryTransactions"]!.findOne.mockResolvedValue(
      selfSendRow({
        targetCharacterId: memberId,
        proposedBy: memberId,
        type: "request",
        approvalModeAtPropose: "single",
        leadershipApproval: undefined,
      })
    );
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: memberId,
      name: "Member",
      party: partyId,
      countryId: "US",
      userId: new ObjectId(),
    });
    db.collectionMocks["nationalPartyElections"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: new ObjectId(), endTurn: 103 }]),
    });
    db.collectionMocks["nationalPartyCandidates"]!.countDocuments.mockResolvedValue(1);

    const response = await call();
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/treasurer election/i);
    expect(db.collectionMocks["pendingTreasuryTransactions"]!.updateOne).not.toHaveBeenCalled();
  });
});
