import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Corporation } from "@/lib/db/types";
import type { BankCharter } from "@/lib/db/types/bank";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function makeActiveCharter(overrides: Partial<BankCharter> = {}): BankCharter {
  return {
    type: "retail",
    status: "active",
    currency: "USD",
    charteredTurn: 10,
    postedCapital: 10_000_000,
    depositOffset: 0,
    lendingOffset: 0,
    npcDeposits: 2_500_000,
    totalDeposits: 3_000_000,
    totalLoans: 500_000,
    ...overrides,
  };
}

function makeCorp(charter: BankCharter, overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: new ObjectId(),
    name: "Stuck Bank Corp",
    type: "financial",
    liquidCapital: 1_000_000,
    liquidCurrencyCode: "USD",
    countryId: "US",
    ceoId: new ObjectId(),
    userId: new ObjectId(),
    headquartersState: "NY",
    bankCharter: charter,
    ...overrides,
  } as unknown as Corporation;
}

describe("adminUnwind.unwindBank", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    db.collection("corporations");
    db.collection("characters");
    db.collection("centralBanks");
    db.collection("bankCharterHistory");
    db.collection("gameState");
    db.collection("gameConfig");

    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 99,
      preset: "2019-default",
    });
    // Flag OFF: unwind must still work (this is the recovery tool).
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      privateBankingEnabled: false,
    });
  });

  async function importUnwind() {
    return import("../adminUnwind");
  }

  it("flips depositor pointers, returns npcDeposits with conservation, refunds capital, archives", async () => {
    const corp = makeCorp(makeActiveCharter());
    const externalBefore = 50_000_000;
    const npcDeposits = corp.bankCharter!.npcDeposits!;

    db.collectionMocks
      .corporations!.findOne.mockResolvedValueOnce(corp)
      // revokeCharter re-reads the corp; simulate cleared deposits after our $set
      .mockResolvedValueOnce({
        ...corp,
        bankCharter: {
          ...corp.bankCharter!,
          npcDeposits: 0,
          totalDeposits: 0,
        },
      });

    db.collectionMocks.characters!.updateMany.mockResolvedValue({
      matchedCount: 3,
      modifiedCount: 3,
    });
    db.collectionMocks.centralBanks!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
    db.collectionMocks.corporations!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });

    const { unwindBank } = await importUnwind();
    const result = await unwindBank(db as unknown as Db, corp._id, "stuck freeze recovery");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyRevoked).toBe(false);
    expect(result.depositorsFlipped).toBe(3);
    expect(result.npcDepositsReturned).toBe(npcDeposits);
    expect(result.refundedCapital).toBe(10_000_000);

    // Pointer flip: savingsHolder only, not balances
    const [flipFilter, flipUpdate] = db.collectionMocks.characters!.updateMany.mock.calls[0];
    expect(flipFilter).toEqual({
      "currencyBalances.savingsHolder.USD": corp._id.toString(),
    });
    expect(flipUpdate.$set["currencyBalances.savingsHolder.USD"]).toBe("centralBank");
    expect(JSON.stringify(flipUpdate)).not.toContain("savings.USD");

    // Conservation: NPC deposits returned to externalBroadMoney
    const [cbFilter, cbUpdate] = db.collectionMocks.centralBanks!.updateOne.mock.calls[0];
    expect(cbFilter).toEqual({ _id: "US" });
    expect(cbUpdate.$inc.externalBroadMoney).toBe(npcDeposits);
    expect(externalBefore + npcDeposits).toBe(externalBefore + result.npcDepositsReturned);

    // revokeCharter archived
    expect(db.collectionMocks.bankCharterHistory!.insertOne).toHaveBeenCalledTimes(1);
    const archived = db.collectionMocks.bankCharterHistory!.insertOne.mock.calls[0][0];
    expect(archived.reason).toBe("revoked");
    expect(archived.charter.status).toBe("revoked");

    // Loans not touched: no bankLoans collection writes
    expect(db.collectionMocks.bankLoans).toBeUndefined();
  });

  it("works with privateBankingEnabled false (no feature-flag gate)", async () => {
    const corp = makeCorp(makeActiveCharter({ npcDeposits: 0, totalDeposits: 0 }));
    db.collectionMocks.corporations!.findOne.mockResolvedValue(corp);
    db.collectionMocks.characters!.updateMany.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });
    db.collectionMocks.corporations!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });

    const { unwindBank } = await importUnwind();
    const result = await unwindBank(db as unknown as Db, corp._id, "flag-off recovery");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyRevoked).toBe(false);
    expect(result.refundedCapital).toBe(10_000_000);
    // gameConfig was never consulted for the flag by unwindBank itself
    expect(db.collectionMocks.gameConfig!.findOne).not.toHaveBeenCalled();
  });

  it("is idempotent when charter is already revoked", async () => {
    const corp = makeCorp(makeActiveCharter({ status: "revoked" }));
    db.collectionMocks.corporations!.findOne.mockResolvedValue(corp);

    const { unwindBank } = await importUnwind();
    const first = await unwindBank(db as unknown as Db, corp._id, "already done");
    const second = await unwindBank(db as unknown as Db, corp._id, "already done");

    expect(first).toEqual({
      ok: true,
      alreadyRevoked: true,
      depositorsFlipped: 0,
      npcDepositsReturned: 0,
      refundedCapital: 0,
    });
    expect(second).toEqual(first);
    expect(db.collectionMocks.characters!.updateMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.bankCharterHistory!.insertOne).not.toHaveBeenCalled();
  });
});
