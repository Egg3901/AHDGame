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

describe("POST /api/country/[code]/parties/[id]/treasury/pending/[txnId]/approve", () => {
  let db: MockDb;
  let executionClaimResult: { matchedCount: number; modifiedCount: number };
  const userId = new ObjectId();
  const chairId = new ObjectId();
  const treasurerId = new ObjectId();
  const viceChairId = new ObjectId();
  const recipientId = new ObjectId();
  const partyOid = new ObjectId();
  const txnOid = new ObjectId();
  const partyId = "1";

  type UpdateDoc = { $set?: Record<string, unknown>; $unset?: Record<string, unknown> };

  /** The open -> executing flip that serialises who actually pays out. */
  function isExecutionClaim(update: unknown): boolean {
    return (update as UpdateDoc)?.$set?.status === "executing";
  }

  function updateCalls() {
    return db.collectionMocks["pendingTreasuryTransactions"]!.updateOne.mock.calls as [
      Record<string, unknown>,
      UpdateDoc,
    ][];
  }

  function executionClaim() {
    return updateCalls().find((c) => isExecutionClaim(c[1]));
  }

  /**
   * The release: the signature comes off AND the row goes back to
   * "open". Matched on the status restore, not on `$unset` alone — the
   * approved stamp also unsets `executingAt`, and treating that as a
   * release would report the happy path as a rollback.
   */
  function releaseCall() {
    return updateCalls().find((c) => c[1]?.$set?.status === "open");
  }

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
    executionClaimResult = { matchedCount: 1, modifiedCount: 1 };
    db.collectionMocks["pendingTreasuryTransactions"]!.updateOne.mockImplementation(
      async (_filter: unknown, update: unknown) =>
        isExecutionClaim(update) ? executionClaimResult : { matchedCount: 1, modifiedCount: 1 }
    );
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
      viceChairId,
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

  it("hands the signature back when the underlying transfer refuses", async () => {
    // The slot is claimed BEFORE the execute so two approvers racing
    // cannot both pay out. Without a release, a refusal left the
    // signature on a still-open row: the panel showed an approved
    // transaction, every further Approve burned the other slot the same
    // way, and it sat there until the 48-turn expiry sweep.
    const { executeSendToMember } = await import("@/lib/treasury/executeSendToMember");
    vi.mocked(executeSendToMember).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "over the cap" }, { status: 400 }),
    } as never);

    const response = await call();
    expect(response.status).toBe(400);

    const unset = releaseCall();
    expect(unset).toBeDefined();
    // Both halves matter: the signature comes off AND the row goes back
    // to "open" so the remaining approver can still act on it.
    expect(unset![0]).toMatchObject({ status: "executing" });
    expect(unset![1]).toEqual({
      $unset: { treasurerApproval: "", executingAt: "" },
      $set: { status: "open" },
    });
  });

  it("hands the signature back when the recipient has vanished", async () => {
    // Every exit after the claim strands the signature the same way, not
    // just the executor's refusal. This one never reaches the executor.
    db.collectionMocks["characters"]!.findOne.mockResolvedValue(null);

    const response = await call();
    expect(response.status).toBe(404);

    expect(releaseCall()).toEqual([
      { _id: expect.anything(), status: "executing" },
      { $unset: { treasurerApproval: "", executingAt: "" }, $set: { status: "open" } },
    ]);
  });

  it("hands the signature back when the executor throws", async () => {
    const { executeSendToMember } = await import("@/lib/treasury/executeSendToMember");
    vi.mocked(executeSendToMember).mockRejectedValue(new Error("mongo exploded") as never);

    // handleRouteError turns the throw into a 500; what matters is that
    // the row is not left carrying a signature it cannot spend.
    const response = await call();
    expect(response.status).toBeGreaterThanOrEqual(500);

    expect(releaseCall()).toBeDefined();
  });

  it("leaves the signature in place when the transfer succeeds", async () => {
    // Set explicitly: `vi.clearAllMocks()` resets calls but not
    // implementations, so the refusal above would otherwise leak here.
    const { executeSendToMember } = await import("@/lib/treasury/executeSendToMember");
    vi.mocked(executeSendToMember).mockResolvedValue({
      ok: true,
      response: NextResponse.json({ success: true }),
    } as never);

    await call();
    expect(releaseCall()).toBeUndefined();
  });

  it("claims the row for execution before it moves any money", async () => {
    // Filling the last slot is not the same event as paying out. Both
    // approvers of a double-mode row can observe a complete row at the
    // same instant, so the open -> executing flip is what decides which
    // ONE of them proceeds. It has to happen before the executor runs.
    await call();

    const claim = executionClaim();
    expect(claim).toBeDefined();
    expect(claim![0]).toMatchObject({ status: "open" });

    const claimIndex = updateCalls().findIndex((c) => isExecutionClaim(c[1]));
    const { executeSendToMember } = await import("@/lib/treasury/executeSendToMember");
    expect(claimIndex).toBeGreaterThanOrEqual(0);
    expect(executeSendToMember).toHaveBeenCalledTimes(1);
    // The flip is guarded on `status: "open"`, so a second racer's flip
    // matches nothing and it never reaches the executor at all.
    expect(vi.mocked(executeSendToMember).mock.invocationCallOrder[0]).toBeGreaterThan(
      db.collectionMocks["pendingTreasuryTransactions"]!.updateOne.mock.invocationCallOrder[
        claimIndex
      ]!
    );
  });

  it("does not pay out when another approver already claimed the row for execution", async () => {
    // The losing half of the race. Both approvers claimed DIFFERENT
    // slots, so the `$exists: false` slot guard cannot separate them;
    // both then re-read a complete row. Without the status flip both
    // called the executor and the treasury paid twice.
    executionClaimResult = { matchedCount: 0, modifiedCount: 0 };

    const response = await call();

    const { executeSendToMember } = await import("@/lib/treasury/executeSendToMember");
    expect(executeSendToMember).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("keeps the signature when it loses the execution race", async () => {
    // The loser's approval is a real, valid signature — the winner is
    // executing WITH it. Handing it back would strip a signature out
    // from under a transfer already in flight.
    executionClaimResult = { matchedCount: 0, modifiedCount: 0 };

    await call();

    expect(releaseCall()).toBeUndefined();
  });

  it("leaves the row executing when the approved stamp cannot be written", async () => {
    // The last gap: the money has moved and the row has not yet been
    // stamped. It must not fall back to "open" — an open row with a
    // free slot is one Approve click away from paying out again.
    // "executing" is terminal for the approve path.
    db.collectionMocks["pendingTreasuryTransactions"]!.updateOne.mockImplementation(
      async (_filter: unknown, update: unknown) => {
        if ((update as { $set?: { status?: string } })?.$set?.status === "approved") {
          throw new Error("mongo exploded");
        }
        return { matchedCount: 1, modifiedCount: 1 };
      }
    );

    const response = await call();

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(releaseCall()).toBeUndefined();
  });

  async function reserveIsPierced() {
    const { wouldTriggerTreasuryReserveOverride } = await import("@/lib/partyTreasuryPlan");
    vi.mocked(wouldTriggerTreasuryReserveOverride).mockReturnValue(true);
  }

  async function sendArgs() {
    const { executeSendToMember } = await import("@/lib/treasury/executeSendToMember");
    return vi.mocked(executeSendToMember).mock.calls[0]?.[0] as
      { reserveWarning: string | null } | undefined;
  }

  it("flags the emergency override when two officers pierce the reserve without the treasurer", async () => {
    // Before any two officers could sign, the treasurer was on every
    // completed row by construction, so the reserve rule ("breach and
    // not the treasurer") could never fire and the route hardcoded
    // null. Chair + Vice-Chair can now complete a reserve-piercing send
    // with no treasurer involved at all, and that has to reach the
    // admin log and the response the same way the direct path does.
    await reserveIsPierced();
    db.collectionMocks["pendingTreasuryTransactions"]!.findOne.mockReset();
    db.collectionMocks["pendingTreasuryTransactions"]!.findOne.mockResolvedValueOnce(
      row({ leadershipApproval: { characterId: chairId, approvedAt: new Date() } })
    ).mockResolvedValue(
      row({
        leadershipApproval: { characterId: chairId, approvedAt: new Date() },
        treasurerApproval: { characterId: viceChairId, approvedAt: new Date() },
      })
    );

    await call();

    expect((await sendArgs())?.reserveWarning).toMatch(/Emergency override/i);
  });

  it("does not flag an override when the treasurer is one of the signatories", async () => {
    // The default row in this suite is signed by the chair and the
    // treasurer, which is exactly the case the rule exempts.
    await reserveIsPierced();

    await call();

    expect((await sendArgs())?.reserveWarning).toBeNull();
  });

  it("does not flag an override when the reserve is untouched", async () => {
    await call();

    expect((await sendArgs())?.reserveWarning).toBeNull();
  });

  it("does not reopen the row when the executor reports the treasury state as uncertain", async () => {
    // Debited, not credited, refund failed. Reopening would put a free
    // slot back on a row whose money is already gone.
    const { executeSendToMember } = await import("@/lib/treasury/executeSendToMember");
    const { TreasuryExecutionUncertainError } = await import("@/lib/treasury/executionUncertain");
    vi.mocked(executeSendToMember).mockRejectedValue(
      new TreasuryExecutionUncertainError("debited, not refunded") as never
    );

    const response = await call();

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(releaseCall()).toBeUndefined();
  });

  it("says the row expired rather than blaming another approver", async () => {
    // The expiry sweep can take the row between the slot claim and the
    // execution claim. Reporting that as "another approver is
    // completing this" sends the player to wait for a payout that is
    // never coming.
    executionClaimResult = { matchedCount: 0, modifiedCount: 0 };
    db.collectionMocks["pendingTreasuryTransactions"]!.findOne.mockReset();
    db.collectionMocks["pendingTreasuryTransactions"]!.findOne.mockResolvedValueOnce(row())
      .mockResolvedValueOnce(
        row({ treasurerApproval: { characterId: treasurerId, approvedAt: new Date() } })
      )
      .mockResolvedValue(
        row({
          treasurerApproval: { characterId: treasurerId, approvedAt: new Date() },
          status: "expired",
        })
      );

    const response = await call();
    const body = await response.json();

    expect(body.message ?? body.error).toMatch(/expired/i);
    expect(body.message ?? body.error).not.toMatch(/another approver/i);
  });

  it("still credits another approver when the row really is being executed", async () => {
    executionClaimResult = { matchedCount: 0, modifiedCount: 0 };
    db.collectionMocks["pendingTreasuryTransactions"]!.findOne.mockReset();
    db.collectionMocks["pendingTreasuryTransactions"]!.findOne.mockResolvedValueOnce(row())
      .mockResolvedValueOnce(
        row({ treasurerApproval: { characterId: treasurerId, approvedAt: new Date() } })
      )
      .mockResolvedValue(
        row({
          treasurerApproval: { characterId: treasurerId, approvedAt: new Date() },
          status: "executing",
        })
      );

    const response = await call();
    const body = await response.json();

    expect(body.message).toMatch(/another approver/i);
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
