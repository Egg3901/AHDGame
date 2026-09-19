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

describe("executeSendToMember", () => {
  let db: MockDb;
  const partyOid = new ObjectId();
  const recipientId = new ObjectId();
  const initiatorId = new ObjectId();

  function args() {
    return {
      db: db as unknown as Db,
      countryId: "US" as const,
      party: { _id: partyOid, name: "Test Party", sequentialId: 1, treasury: 500_000 },
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
});
