import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn(), getMongoClient: vi.fn() }));
vi.mock("@/lib/db/transactionWithRetry", () => ({
  runTransactionWithSessionRetry: vi.fn(async (_getClient, run) => run(null)),
}));
vi.mock("@/lib/treasury/emit", () => ({ emitTreasuryTransaction: vi.fn(async () => undefined) }));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn(async () => undefined) }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn(async () => ({ currentTurn: 100 })) }));

describe("executeTransferToStateParty", () => {
  let db: MockDb;
  const partyOid = new ObjectId();
  const initiatorId = new ObjectId();

  function args() {
    return {
      db: db as unknown as Db,
      countryId: "US" as const,
      party: { _id: partyOid, name: "Test Party", sequentialId: 1, treasury: 500_000 },
      state: { _id: "CA", name: "California" },
      amount: 5_000,
      reserveWarning: null,
      initiator: { _id: initiatorId, name: "Treasurer" },
      initiatorUsername: "treasurer",
      initiatorUserId: new ObjectId().toString(),
      isAdmin: false,
    };
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("politicalParties");
    db.collection("statePartyOrg");
    db.collection("adminLogs");
    db.collection("activityLog");

    db.collectionMocks["politicalParties"]!.updateOne.mockResolvedValue({ matchedCount: 1 });
    db.collectionMocks["statePartyOrg"]!.updateOne.mockResolvedValue({ matchedCount: 1 });
    db.collectionMocks["adminLogs"]!.insertOne.mockResolvedValue({ acknowledged: true });
    db.collectionMocks["activityLog"]!.insertOne.mockResolvedValue({ acknowledged: true });
  });

  it("moves the money and reports success on the happy path", async () => {
    const { executeTransferToStateParty } = await import("./executeTransferToStateParty");
    const result = await executeTransferToStateParty(args());

    expect(result.ok).toBe(true);
    expect(db.collectionMocks["politicalParties"]!.updateOne).toHaveBeenCalled();
  });

  it("still reports success when the admin log write fails after the debit", async () => {
    // Same contract as executeSendToMember: once the national treasury
    // has been debited and the state party credited, an audit-write
    // failure may not be reported to the caller as a failed transfer.
    // The approve route would hand the signature back and reopen a row
    // whose money is already spent.
    db.collectionMocks["adminLogs"]!.insertOne.mockRejectedValue(new Error("mongo exploded"));

    const { executeTransferToStateParty } = await import("./executeTransferToStateParty");
    const result = await executeTransferToStateParty(args());

    expect(result.ok).toBe(true);
  });

  it("still reports success when a treasury audit emit fails after the debit", async () => {
    const { emitTreasuryTransaction } = await import("@/lib/treasury/emit");
    vi.mocked(emitTreasuryTransaction).mockRejectedValue(new Error("mongo exploded") as never);

    const { executeTransferToStateParty } = await import("./executeTransferToStateParty");
    const result = await executeTransferToStateParty(args());

    expect(result.ok).toBe(true);
  });

  it("still reports success when the game-state read fails after the debit", async () => {
    // `getGameState` is only needed to stamp the financial-tx log rows.
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockRejectedValue(new Error("mongo exploded") as never);

    const { executeTransferToStateParty } = await import("./executeTransferToStateParty");
    const result = await executeTransferToStateParty(args());

    expect(result.ok).toBe(true);
  });

  it("reports the treasury state as uncertain when the refund itself fails", async () => {
    // Debited, the state party not credited, and the compensating
    // refund failed too. Reported as an ordinary failure this would
    // reopen the pending row for a second debit.
    db.collectionMocks["statePartyOrg"]!.updateOne.mockRejectedValue(new Error("credit failed"));
    db.collectionMocks["politicalParties"]!.updateOne.mockResolvedValueOnce({
      matchedCount: 1,
    }).mockRejectedValue(new Error("refund failed"));

    const { executeTransferToStateParty } = await import("./executeTransferToStateParty");
    const { isTreasuryExecutionUncertain } = await import("./executionUncertain");

    await expect(executeTransferToStateParty(args())).rejects.toSatisfy(
      isTreasuryExecutionUncertain
    );
  });

  it("does not claim uncertainty when the refund succeeds", async () => {
    // Net zero, so the caller may unwind normally.
    db.collectionMocks["statePartyOrg"]!.updateOne.mockRejectedValue(new Error("credit failed"));

    const { executeTransferToStateParty } = await import("./executeTransferToStateParty");
    const { isTreasuryExecutionUncertain } = await import("./executionUncertain");

    await expect(executeTransferToStateParty(args())).rejects.not.toSatisfy(
      isTreasuryExecutionUncertain
    );
  });

  it("still refuses before the debit when the treasury cannot cover the amount", async () => {
    db.collectionMocks["politicalParties"]!.updateOne.mockResolvedValue({ matchedCount: 0 });

    const { executeTransferToStateParty } = await import("./executeTransferToStateParty");
    const result = await executeTransferToStateParty(args());

    expect(result.ok).toBe(false);
    expect(db.collectionMocks["statePartyOrg"]!.updateOne).not.toHaveBeenCalled();
  });

  it("stamps EUR on every audit row for a 2027 euro member", async () => {
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({
      currentTurn: 100,
      preset: "2027-default",
    } as never);
    const { emitTreasuryTransaction } = await import("@/lib/treasury/emit");
    // Earlier tests leave this mock rejecting (clearAllMocks keeps
    // implementations); reset it so this test observes the happy path.
    vi.mocked(emitTreasuryTransaction).mockResolvedValue(undefined as never);
    const { emitTx } = await import("@/lib/financialTxLog/emit");

    const { executeTransferToStateParty } = await import("./executeTransferToStateParty");
    const result = await executeTransferToStateParty({ ...args(), countryId: "FR" });

    expect(result.ok).toBe(true);
    const treasuryCalls = vi.mocked(emitTreasuryTransaction).mock.calls;
    expect(treasuryCalls).toHaveLength(2);
    for (const call of treasuryCalls) {
      expect(call[0].currencyCode).toBe("EUR");
    }
    const txCalls = vi.mocked(emitTx).mock.calls;
    expect(txCalls).toHaveLength(2);
    for (const call of txCalls) {
      expect(call[1].currencyCode).toBe("EUR");
    }
    expect(db.collectionMocks["activityLog"]!.insertOne.mock.calls[0][0].currencyCode).toBe("EUR");
  });

  it("keeps the era-blind code on non-euro presets", async () => {
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({
      currentTurn: 100,
      preset: "1991-default",
    } as never);
    const { emitTreasuryTransaction } = await import("@/lib/treasury/emit");
    vi.mocked(emitTreasuryTransaction).mockResolvedValue(undefined as never);

    const { executeTransferToStateParty } = await import("./executeTransferToStateParty");
    const result = await executeTransferToStateParty({ ...args(), countryId: "FR" });

    expect(result.ok).toBe(true);
    for (const call of vi.mocked(emitTreasuryTransaction).mock.calls) {
      expect(call[0].currencyCode).toBe("FRF");
    }
    expect(db.collectionMocks["activityLog"]!.insertOne.mock.calls[0][0].currencyCode).toBe("FRF");
  });
});
