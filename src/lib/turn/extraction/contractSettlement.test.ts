import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { ExtractionContract } from "@/lib/db/types/extractionContract";
import { resetCorpFxRateCacheForTests } from "@/lib/currency/corporationCapital";
import { royaltyDueAnchor } from "./contractSettlement";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const NOW = new Date("2026-01-01T00:00:00Z");

function cursorOf<T>(docs: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

function setFind(db: MockDb, name: string, docs: unknown[]) {
  db.collection(name);
  db.collectionMocks[name]!.find.mockReturnValue(cursorOf(docs) as never);
}

const CORP_ID = new ObjectId();

function makeContract(over: Partial<ExtractionContract> = {}): ExtractionContract {
  return {
    _id: new ObjectId(),
    stateId: "TX",
    countryId: "US",
    corporationId: CORP_ID,
    resource: "oil",
    share: 0.5,
    grantedTurn: 1,
    grantedBy: "us-congress",
    grantedByLevel: "national",
    status: "active",
    royaltyRatePerTurn: 0.01,
    missedPayments: 0,
    updatedAt: NOW,
    ...over,
  };
}

/** Configure extractionContracts.find to answer the offered vs active queries. */
function setContractQueries(
  db: MockDb,
  offered: ExtractionContract[],
  active: ExtractionContract[]
) {
  db.collection("extractionContracts");
  db.collectionMocks["extractionContracts"]!.find.mockImplementation(
    (query: { status?: string }) => {
      if (query?.status === "offered") return cursorOf(offered) as never;
      return cursorOf(active) as never;
    }
  );
}

function seedCommon(db: MockDb) {
  setFind(db, "stateResourceCapacity", [
    {
      _id: new ObjectId(),
      stateId: "TX",
      countryId: "US",
      resources: { oil: 10_000 },
      updatedAt: NOW,
    },
  ]);
  setFind(db, "commodityPrices", [
    {
      commodity: "oil",
      basePrice: 100,
      globalPrice: 100,
      statePrices: { TX: 100 },
      turn: 13,
      updatedAt: NOW,
    },
  ]);
  setFind(db, "corporations", [
    {
      _id: CORP_ID,
      userId: new ObjectId(),
      name: "Acme Oil",
      countryId: "US",
      liquidCurrencyCode: "USD",
    },
  ]);
}

async function loadFn() {
  const { settleExtractionContracts } = await import("./contractSettlement");
  return settleExtractionContracts;
}

describe("royaltyDueAnchor", () => {
  it("computes rate × share × capacity × price", () => {
    expect(royaltyDueAnchor(0.01, 0.5, 10_000, 100)).toBe(5_000);
  });
  it("returns 0 when any factor is non-positive", () => {
    expect(royaltyDueAnchor(0, 0.5, 10_000, 100)).toBe(0);
    expect(royaltyDueAnchor(0.01, 0.5, 0, 100)).toBe(0);
    expect(royaltyDueAnchor(0.01, 0.5, 10_000, 0)).toBe(0);
  });
});

describe("settleExtractionContracts", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetCorpFxRateCacheForTests();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("charges the corp, credits the national treasury, and emits a royalty tx", async () => {
    setContractQueries(db, [], [makeContract()]);
    seedCommon(db);
    db.collectionMocks["corporations"]!.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });

    const settle = await loadFn();
    const result = await settle(db as unknown as Db, 13, NOW);

    expect(result.royaltiesPaid).toBe(1);
    expect(Math.round(result.totalRoyaltyAnchor)).toBe(5_000);

    // Guarded corp debit for the FX-converted amount (USD fx = 1 → 5000).
    const debitCall = db.collectionMocks["corporations"]!.updateOne.mock.calls[0];
    expect(debitCall[1].$inc.liquidCapital).toBe(-5_000);
    expect(debitCall[0].liquidCapital.$gte).toBe(5_000);

    // National issuer credited via creditTreasury (federalBudget updateOne).
    expect(db.collectionMocks["federalBudget"]!.updateOne).toHaveBeenCalled();

    // Royalty tx emitted.
    const inserted = db.collectionMocks["financialTxLog"]!.insertMany.mock.calls[0][0];
    expect(inserted[0].type).toBe("contract_royalty_payment");
    expect(inserted[0].amount).toBe(-5_000);
  });

  it("credits a state issuer's persistent royalty revenue line", async () => {
    setContractQueries(db, [], [makeContract({ grantedByLevel: "state" })]);
    seedCommon(db);
    db.collectionMocks["corporations"]!.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });

    const settle = await loadFn();
    await settle(db as unknown as Db, 13, NOW);

    const call = db.collectionMocks["stateBudgets"]!.updateOne.mock.calls[0];
    expect(call[0]).toMatchObject({ _id: "TX", countryId: "US" });
    expect(call[1].$inc["revenue.resourceRoyalties"]).toBe(5_000);
    expect(call[1].$inc["revenue.total"]).toBe(5_000);
    // Treasury must NOT be touched for a state contract (collection never accessed).
    expect(db.collectionMocks["federalBudget"]).toBeUndefined();
  });

  it("increments missedPayments on insufficient funds without defaulting below the threshold", async () => {
    setContractQueries(db, [], [makeContract({ missedPayments: 1 })]);
    seedCommon(db);
    db.collectionMocks["corporations"]!.updateOne.mockResolvedValue({
      modifiedCount: 0,
      matchedCount: 0,
    });

    const settle = await loadFn();
    const result = await settle(db as unknown as Db, 13, NOW);

    expect(result.paymentsMissed).toBe(1);
    expect(result.contractsDefaulted).toBe(0);
    const set = db.collectionMocks["extractionContracts"]!.updateOne.mock.calls[0][1].$set;
    expect(set.missedPayments).toBe(2);
    expect(set.status).toBeUndefined();
    const notif = db.collectionMocks["notifications"]!.insertMany.mock.calls[0][0];
    expect(notif[0].type).toBe("contract_royalty_missed");
  });

  it("defaults the contract at the missed-payment threshold", async () => {
    setContractQueries(db, [], [makeContract({ missedPayments: 2 })]);
    seedCommon(db);
    db.collectionMocks["corporations"]!.updateOne.mockResolvedValue({
      modifiedCount: 0,
      matchedCount: 0,
    });

    const settle = await loadFn();
    const result = await settle(db as unknown as Db, 13, NOW);

    expect(result.contractsDefaulted).toBe(1);
    const set = db.collectionMocks["extractionContracts"]!.updateOne.mock.calls[0][1].$set;
    expect(set.missedPayments).toBe(3);
    expect(set.status).toBe("defaulted");
    expect(set.revokedTurn).toBe(13);
    const notif = db.collectionMocks["notifications"]!.insertMany.mock.calls[0][0];
    expect(notif[0].type).toBe("contract_defaulted");
  });

  it("lapses expired offers to status expired + revokedTurn", async () => {
    const offer = makeContract({
      status: "offered",
      offerExpiresTurn: 10,
      royaltyRatePerTurn: 0.01,
    });
    setContractQueries(db, [offer], []);
    seedCommon(db);

    const settle = await loadFn();
    const result = await settle(db as unknown as Db, 13, NOW);

    expect(result.offersExpired).toBe(1);
    const op = db.collectionMocks["extractionContracts"]!.bulkWrite.mock.calls[0][0][0];
    expect(op.updateOne.update.$set.status).toBe("expired");
    expect(op.updateOne.update.$set.revokedTurn).toBe(13);
  });

  it("expires a contract at term end without charging a royalty that turn", async () => {
    setContractQueries(db, [], [makeContract({ expiresTurn: 13 })]);
    seedCommon(db);

    const settle = await loadFn();
    const result = await settle(db as unknown as Db, 13, NOW);

    expect(result.contractsExpired).toBe(1);
    expect(result.royaltiesPaid).toBe(0);
    // No corp debit on the expiry turn.
    expect(db.collectionMocks["corporations"]!.updateOne).not.toHaveBeenCalled();
    const notif = db.collectionMocks["notifications"]!.insertMany.mock.calls[0][0];
    expect(notif[0].type).toBe("contract_expired");
  });

  it("falls back to the national treasury when the state budget doc is missing", async () => {
    setContractQueries(db, [], [makeContract({ grantedByLevel: "state" })]);
    seedCommon(db);
    db.collectionMocks["corporations"]!.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    // Missing stateBudgets doc: the credit matches nothing.
    db.collection("stateBudgets");
    db.collectionMocks["stateBudgets"]!.updateOne.mockResolvedValue({
      modifiedCount: 0,
      matchedCount: 0,
    });

    const settle = await loadFn();
    const result = await settle(db as unknown as Db, 13, NOW);

    expect(result.royaltiesPaid).toBe(1);
    // Money conservation: the corp was debited, so the royalty must land
    // SOMEWHERE — national treasury as custodian (creditTreasury).
    expect(db.collectionMocks["federalBudget"]!.updateOne).toHaveBeenCalled();
    // And the custodian credit gets the paired government receipt.
    const inserted = db.collectionMocks["financialTxLog"]!.insertMany.mock.calls[0][0];
    const types = inserted.map((e: { type: string }) => e.type);
    expect(types).toContain("govt_royalty_receipt");
  });

  it("emits a paired government receipt for national credits but not state credits", async () => {
    setContractQueries(db, [], [makeContract({ grantedByLevel: "national" })]);
    seedCommon(db);
    db.collectionMocks["corporations"]!.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });

    const settle = await loadFn();
    await settle(db as unknown as Db, 13, NOW);

    const inserted = db.collectionMocks["financialTxLog"]!.insertMany.mock.calls[0][0];
    const receipt = inserted.find((e: { type: string }) => e.type === "govt_royalty_receipt");
    expect(receipt).toMatchObject({
      subjectType: "government",
      countryId: "US",
      amount: 5_000,
      anchorAmount: 5_000,
    });

    // State-credit success path: no government receipt (state budgets are not
    // ledger-backed; a receipt would drift the national government account).
    vi.clearAllMocks();
    resetCorpFxRateCacheForTests();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    setContractQueries(db, [], [makeContract({ grantedByLevel: "state" })]);
    seedCommon(db);
    db.collectionMocks["corporations"]!.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    await settle(db as unknown as Db, 13, NOW);
    const stateInserted = db.collectionMocks["financialTxLog"]!.insertMany.mock.calls[0][0];
    const stateTypes = stateInserted.map((e: { type: string }) => e.type);
    expect(stateTypes).not.toContain("govt_royalty_receipt");
  });

  it("stamps lastRoyaltyTurn with the paid outcome", async () => {
    setContractQueries(db, [], [makeContract()]);
    seedCommon(db);
    db.collectionMocks["corporations"]!.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });

    const settle = await loadFn();
    await settle(db as unknown as Db, 13, NOW);

    const stamp = db.collectionMocks["extractionContracts"]!.updateOne.mock.calls.find(
      (c) => c[1]?.$set?.lastRoyaltyTurn !== undefined
    );
    expect(stamp?.[1].$set.lastRoyaltyTurn).toBe(13);
  });

  it("a retried run for the same turn charges the corp exactly once", async () => {
    const contract = makeContract();
    setContractQueries(db, [], [contract]);
    seedCommon(db);
    db.collectionMocks["corporations"]!.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });

    const settle = await loadFn();
    const first = await settle(db as unknown as Db, 13, NOW);
    expect(first.royaltiesPaid).toBe(1);

    // Retry: the phase re-reads the contract, now carrying the idempotency
    // marker stamped by the first run.
    setContractQueries(db, [], [{ ...contract, lastRoyaltyTurn: 13 }]);
    const second = await settle(db as unknown as Db, 13, NOW);
    expect(second.royaltiesPaid).toBe(0);

    // One guarded debit total across both runs.
    expect(db.collectionMocks["corporations"]!.updateOne).toHaveBeenCalledTimes(1);
  });

  it("skips royalty settlement for contracts already settled this turn (missed path too)", async () => {
    setContractQueries(db, [], [makeContract({ lastRoyaltyTurn: 13, missedPayments: 1 })]);
    seedCommon(db);

    const settle = await loadFn();
    const result = await settle(db as unknown as Db, 13, NOW);

    expect(result.royaltiesPaid).toBe(0);
    expect(result.paymentsMissed).toBe(0);
    expect(db.collectionMocks["corporations"]!.updateOne).not.toHaveBeenCalled();
  });

  it("refunds the corp and rolls back the stamp when the issuer credit fails, then continues", async () => {
    const failing = makeContract({ lastRoyaltyTurn: 12, missedPayments: 2 });
    const succeeding = makeContract();
    setContractQueries(db, [], [failing, succeeding]);
    seedCommon(db);
    db.collectionMocks["corporations"]!.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    // First national credit throws mid-loop; the second succeeds.
    db.collection("federalBudget");
    db.collectionMocks["federalBudget"]!.updateOne.mockRejectedValueOnce(
      new Error("treasury write failed")
    );

    const settle = await loadFn();
    const result = await settle(db as unknown as Db, 13, NOW);

    // The failure is counted, the loop continued, and the second contract paid.
    expect(result.errors).toBe(1);
    expect(result.royaltiesPaid).toBe(1);

    // Corp writes: debit c1, additive refund c1, debit c2.
    const corpCalls = db.collectionMocks["corporations"]!.updateOne.mock.calls;
    expect(corpCalls).toHaveLength(3);
    expect(corpCalls[0][1].$inc.liquidCapital).toBe(-5_000);
    expect(corpCalls[1][1].$inc.liquidCapital).toBe(5_000);
    expect(corpCalls[2][1].$inc.liquidCapital).toBe(-5_000);

    // The rollback restores the PRIOR settlement state so a retry re-charges.
    const restore = db.collectionMocks["extractionContracts"]!.updateOne.mock.calls.find(
      (c) => c[0]._id === failing._id && c[1]?.$set?.lastRoyaltyTurn === 12
    );
    expect(restore?.[1].$set.missedPayments).toBe(2);

    // No tx rows for the failed contract — only the succeeding one's pair.
    const inserted = db.collectionMocks["financialTxLog"]!.insertMany.mock.calls[0][0];
    const payments = inserted.filter(
      (e: { type: string }) => e.type === "contract_royalty_payment"
    );
    expect(payments).toHaveLength(1);
    expect(payments[0].meta.contractId).toBe(succeeding._id.toString());
  });

  it("unsets the stamp on credit failure when the contract had never settled before", async () => {
    const fresh = makeContract();
    setContractQueries(db, [], [fresh]);
    seedCommon(db);
    db.collectionMocks["corporations"]!.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    db.collection("federalBudget");
    db.collectionMocks["federalBudget"]!.updateOne.mockRejectedValueOnce(
      new Error("treasury write failed")
    );

    const settle = await loadFn();
    const result = await settle(db as unknown as Db, 13, NOW);

    expect(result.errors).toBe(1);
    const rollback = db.collectionMocks["extractionContracts"]!.updateOne.mock.calls.find(
      (c) => c[1]?.$unset?.lastRoyaltyTurn !== undefined
    );
    expect(rollback).toBeDefined();
    expect(rollback?.[1].$set.lastRoyaltyTurn).toBeUndefined();
    expect(rollback?.[1].$set.missedPayments).toBeUndefined();
  });

  it("only settles status:active contracts (legacy status-less contracts are excluded)", async () => {
    setContractQueries(db, [], []);
    seedCommon(db);

    const settle = await loadFn();
    await settle(db as unknown as Db, 13, NOW);

    // The active-contracts query filters on status:"active", so a legacy
    // contract with no status is never fetched or charged.
    const findCalls = db.collectionMocks["extractionContracts"]!.find.mock.calls.map((c) => c[0]);
    expect(findCalls).toContainEqual(
      expect.objectContaining({ status: "active", revokedTurn: { $exists: false } })
    );
    expect(db.collectionMocks["corporations"]!.updateOne).not.toHaveBeenCalled();
  });
});
