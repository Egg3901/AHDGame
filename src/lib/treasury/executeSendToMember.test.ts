import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn(), getMongoClient: vi.fn() }));
vi.mock("@/lib/db/transactionWithRetry", () => ({
  // Standalone-Mongo shape: no session, so the executor takes the
  // sequential debit/credit path. That is the production deployment.
  runTransactionWithSessionRetry: vi.fn(async (_getClient, run) => run(null)),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn(async () => false) }));
vi.mock("@/lib/treasury/payoutCap", () => ({
  checkPlayerPayoutCap: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/treasury/emit", () => ({ emitTreasuryTransaction: vi.fn(async () => undefined) }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn(async () => ({ currentTurn: 100 })) }));

describe("executeSendToMember", () => {
  let db: MockDb;
  const partyOid = new ObjectId();
  const recipientId = new ObjectId();
  const initiatorId = new ObjectId();

  function args() {
    return {
      db: db as unknown as Db,
      countryId: "US" as const,
      // One seated officer, so the base per-turn ceiling applies. The
      // seats are part of the argument now because two distinct officers
      // raise that ceiling.
      party: {
        _id: partyOid,
        name: "Test Party",
        sequentialId: 1,
        treasury: 500_000,
        chairId: initiatorId,
        viceChairId: null,
        treasurerId: null,
      },
      targetCharacter: { _id: recipientId, name: "Recipient" },
      amount: 5_000,
      reserveWarning: null,
      initiator: { _id: initiatorId, name: "Treasurer" },
      initiatorUsername: "treasurer",
      initiatorUserId: new ObjectId().toString(),
      currentTurn: 100,
    };
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("politicalParties");
    db.collection("characters");
    db.collection("adminLogs");
    db.collection("activityLog");

    db.collectionMocks["politicalParties"]!.updateOne.mockResolvedValue({ matchedCount: 1 });
    db.collectionMocks["characters"]!.updateOne.mockResolvedValue({ matchedCount: 1 });
    db.collectionMocks["adminLogs"]!.insertOne.mockResolvedValue({ acknowledged: true });
    db.collectionMocks["activityLog"]!.insertOne.mockResolvedValue({ acknowledged: true });
  });

  it("moves the money and reports success on the happy path", async () => {
    const { executeSendToMember } = await import("./executeSendToMember");
    const result = await executeSendToMember(args());

    expect(result.ok).toBe(true);
    expect(db.collectionMocks["politicalParties"]!.updateOne).toHaveBeenCalled();
    expect(db.collectionMocks["characters"]!.updateOne).toHaveBeenCalled();
  });

  it("still reports success when the admin log write fails after the debit", async () => {
    // The debit and credit have already landed by the time the audit
    // writes run. Letting the insert throw hands the caller an
    // exception that reads exactly like "nothing happened" — and the
    // approve route responds by handing the approver's signature back,
    // reopening a row whose money is already gone. The transfer is
    // done; the audit write is not allowed to unsay it.
    db.collectionMocks["adminLogs"]!.insertOne.mockRejectedValue(new Error("mongo exploded"));

    const { executeSendToMember } = await import("./executeSendToMember");
    const result = await executeSendToMember(args());

    expect(result.ok).toBe(true);
  });

  it("still reports success when the treasury audit emit fails after the debit", async () => {
    const { emitTreasuryTransaction } = await import("@/lib/treasury/emit");
    vi.mocked(emitTreasuryTransaction).mockRejectedValue(new Error("mongo exploded") as never);

    const { executeSendToMember } = await import("./executeSendToMember");
    const result = await executeSendToMember(args());

    expect(result.ok).toBe(true);
  });

  it("refunds the debit when crediting the recipient throws", async () => {
    // The standalone path is production Mongo: there is no transaction
    // to roll back, so a throw between the debit and the credit leaves
    // the treasury short unless this compensates. Only the
    // matchedCount === 0 case was handled; an actual throw was not.
    db.collectionMocks["characters"]!.updateOne.mockRejectedValue(new Error("mongo exploded"));

    const { executeSendToMember } = await import("./executeSendToMember");
    await expect(executeSendToMember(args())).rejects.toThrow();

    const refund = db.collectionMocks["politicalParties"]!.updateOne.mock.calls.find(
      (c) => ((c[1] as { $inc?: { treasury?: number } })?.$inc?.treasury ?? 0) > 0
    );
    expect(refund).toBeDefined();
  });

  it("reports the treasury state as uncertain when the refund itself fails", async () => {
    // Debited, not credited, and the compensating refund also failed.
    // The caller must NOT treat this as "nothing happened": the approve
    // route would reopen the row and a retry would debit a second time.
    db.collectionMocks["characters"]!.updateOne.mockRejectedValue(new Error("credit failed"));
    db.collectionMocks["politicalParties"]!.updateOne.mockResolvedValueOnce({
      matchedCount: 1,
    }).mockRejectedValue(new Error("refund failed"));

    const { executeSendToMember } = await import("./executeSendToMember");
    const { isTreasuryExecutionUncertain } = await import("./executionUncertain");

    await expect(executeSendToMember(args())).rejects.toSatisfy(isTreasuryExecutionUncertain);
  });

  it("does not claim uncertainty when the debit itself never landed", async () => {
    // Nothing moved, so this is an ordinary failure and the caller is
    // free to unwind the approval.
    db.collectionMocks["politicalParties"]!.updateOne.mockRejectedValue(new Error("debit failed"));

    const { executeSendToMember } = await import("./executeSendToMember");
    const { isTreasuryExecutionUncertain } = await import("./executionUncertain");

    await expect(executeSendToMember(args())).rejects.not.toSatisfy(isTreasuryExecutionUncertain);
  });

  it("still reports success when the activity-log row cannot be built", async () => {
    // `new ObjectId(...)` throws SYNCHRONOUSLY on a malformed id, and
    // the activity-log write sits after the money has moved. An escape
    // here reads to the approve route as "the transfer did not happen".
    const bad = { ...args(), initiatorUserId: "not-an-object-id" };

    const { executeSendToMember } = await import("./executeSendToMember");
    const result = await executeSendToMember(bad);

    expect(result.ok).toBe(true);
  });

  it("still refuses before the debit when the payout cap is exceeded", async () => {
    // The pre-debit guards must keep throwing/refusing normally — only
    // the post-debit side effects are made non-fatal.
    const { checkPlayerPayoutCap } = await import("@/lib/treasury/payoutCap");
    vi.mocked(checkPlayerPayoutCap).mockResolvedValue({
      ok: false,
      reason: "over the cap",
    } as never);

    const { executeSendToMember } = await import("./executeSendToMember");
    const result = await executeSendToMember(args());

    expect(result.ok).toBe(false);
    expect(db.collectionMocks["politicalParties"]!.updateOne).not.toHaveBeenCalled();
  });

  it("stamps EUR on the treasury and activity rows for a 2027 euro member", async () => {
    const { checkPlayerPayoutCap } = await import("@/lib/treasury/payoutCap");
    vi.mocked(checkPlayerPayoutCap).mockResolvedValue({ ok: true } as never);
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({
      currentTurn: 100,
      preset: "2027-default",
    } as never);
    const { emitTreasuryTransaction } = await import("@/lib/treasury/emit");
    vi.mocked(emitTreasuryTransaction).mockResolvedValue(undefined as never);

    const { executeSendToMember } = await import("./executeSendToMember");
    const result = await executeSendToMember({ ...args(), countryId: "FR" });

    expect(result.ok).toBe(true);
    const treasuryCalls = vi.mocked(emitTreasuryTransaction).mock.calls;
    expect(treasuryCalls).toHaveLength(1);
    expect(treasuryCalls[0][0].currencyCode).toBe("EUR");
    expect(db.collectionMocks["activityLog"]!.insertOne.mock.calls[0][0].currencyCode).toBe("EUR");
  });

  it("keeps the era-blind code on non-euro presets", async () => {
    const { checkPlayerPayoutCap } = await import("@/lib/treasury/payoutCap");
    vi.mocked(checkPlayerPayoutCap).mockResolvedValue({ ok: true } as never);
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({
      currentTurn: 100,
      preset: "1991-default",
    } as never);
    const { emitTreasuryTransaction } = await import("@/lib/treasury/emit");
    vi.mocked(emitTreasuryTransaction).mockResolvedValue(undefined as never);

    const { executeSendToMember } = await import("./executeSendToMember");
    const result = await executeSendToMember({ ...args(), countryId: "FR" });

    expect(result.ok).toBe(true);
    expect(vi.mocked(emitTreasuryTransaction).mock.calls[0][0].currencyCode).toBe("FRF");
    expect(db.collectionMocks["activityLog"]!.insertOne.mock.calls[0][0].currencyCode).toBe("FRF");
  });
});
