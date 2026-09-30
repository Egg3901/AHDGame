import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/banking/featureFlag", () => ({
  isPrivateBankingEnabled: vi.fn().mockResolvedValue(true),
}));

import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { executeMonetaryOperation } from "./operations";

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  db.collection("centralBanks");
  db.collection("federalBudget");
  db.collection("gameConfig");
  db.collectionMocks.centralBanks.findOne.mockResolvedValue({
    _id: "US",
    countryId: "US",
    reserveBalance: 100,
    externalBroadMoney: 1_000,
  });
});

describe("open market operations against the bond market pool", () => {
  const bondId = new ObjectId();
  function seatBond() {
    db.collection("bonds");
    db.collection("bondMarketPools");
    db.collectionMocks.bonds.findOne.mockResolvedValue({
      _id: bondId,
      issuerType: "sovereign",
      countryId: "US",
      currencyCode: "USD",
      matured: false,
      defaulted: false,
      publicFloat: 100,
      centralBankHoldings: 10,
      totalIssued: 110_000,
      marketPrice: 1,
    });
  }

  it("QE buys float from the pool and leaves the deposits in the pool", async () => {
    seatBond();
    const result = await executeMonetaryOperation(db as unknown as Db, {
      countryId: "US",
      type: "qe",
      turn: 12,
      actorName: "Chair",
      bondId: bondId.toString(),
      units: 5,
    });
    expect(result.units).toBe(5);
    expect(db.collectionMocks.bondMarketPools.updateOne).toHaveBeenCalledWith(
      { _id: "USD" },
      expect.objectContaining({
        $inc: expect.objectContaining({ cashLocal: 5000, "lifetime.qeIn": 5000 }),
      }),
      expect.objectContaining({ upsert: true })
    );
  });

  it("QT is refused when the pool cannot pay for the units", async () => {
    seatBond();
    db.collectionMocks.bondMarketPools.findOneAndUpdate.mockResolvedValue(null);
    await expect(
      executeMonetaryOperation(db as unknown as Db, {
        countryId: "US",
        type: "qt",
        turn: 12,
        actorName: "Chair",
        bondId: bondId.toString(),
        units: 1,
      })
    ).rejects.toThrow(/cannot absorb/);
    expect(db.collectionMocks.bonds.updateOne).not.toHaveBeenCalled();
  });
});

describe("non-QE monetary operations", () => {
  it("creates Treasury money as a cash-only credit; the bond-owned stock is untouched", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "federal",
      countryId: "US",
      treasuryBalance: -1_000,
      gdp: 10_000,
      investorConfidence: 70,
      debt: { principal: 1_000, ceiling: 20_000 },
    });
    db.collectionMocks.federalBudget.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const result = await executeMonetaryOperation(db as unknown as Db, {
      countryId: "US",
      type: "treasury_advance",
      turn: 12,
      actorName: "Chair",
      amount: 250,
    });

    expect(result.moneySupplyDelta).toBe(0);
    const update = db.collectionMocks.federalBudget.updateOne.mock.calls[0][1].$set;
    expect(update.treasuryBalance).toBe(-750);
    // A cash advance is not a bond issuance or redemption (refs #1975).
    expect(update).not.toHaveProperty("debt.principal");
    expect(db.collectionMocks.centralBanks.updateOne).toHaveBeenCalledWith(
      { _id: "US" },
      expect.objectContaining({
        $inc: expect.objectContaining({ netMoneyCreatedLifetime: 250 }),
      })
    );
  });

  it("treasury advance is a compare-and-swap: a concurrent move fails, the retry converges", async () => {
    db.collectionMocks.federalBudget.findOne
      .mockResolvedValueOnce({
        _id: "federal",
        countryId: "US",
        treasuryBalance: -1_000,
        debt: { principal: 1_000, ceiling: 20_000 },
      })
      .mockResolvedValueOnce({
        _id: "federal",
        countryId: "US",
        treasuryBalance: -900,
        debt: { principal: 1_000, ceiling: 20_000 },
      });
    // Another writer moved the balance between the read and the write, so the
    // guarded write matches nothing; the retry re-reads and lands cleanly.
    db.collectionMocks.federalBudget.updateOne
      .mockResolvedValueOnce({ modifiedCount: 0 })
      .mockResolvedValueOnce({ modifiedCount: 1 });

    const attempt = {
      countryId: "US",
      type: "treasury_advance",
      turn: 12,
      actorName: "Chair",
      amount: 250,
    } as const;
    await expect(executeMonetaryOperation(db as unknown as Db, attempt)).rejects.toThrow(
      /changed concurrently/
    );
    const result = await executeMonetaryOperation(db as unknown as Db, attempt);

    expect(result.moneySupplyDelta).toBe(0);
    const calls = db.collectionMocks.federalBudget.updateOne.mock.calls;
    expect(calls).toHaveLength(2);
    // The retry credits the re-read balance, not the stale one: exactly once.
    expect(calls[1][1].$set.treasuryBalance).toBe(-650);
    expect(calls[1][1].$set).not.toHaveProperty("debt.principal");
    // The failed first attempt wrote no ledger entry and booked no money.
    expect(db.collectionMocks.centralBanks.updateOne).toHaveBeenCalledTimes(1);
  });

  it.each([
    { deposits: [900, 300], enabled: true, expected: [300, 100], reserve: 0 },
    { deposits: [0, 0], enabled: true, expected: [200, 200], reserve: 0 },
    { deposits: [], enabled: true, expected: [], reserve: 400 },
  ])(
    "routes a liquidity command through funded settlement: %j",
    async ({ deposits, expected, reserve }) => {
      const memory = createInMemoryDb();
      memory.seed("centralBanks", [{ _id: "US", reserveBalance: 100, netMoneyCreatedLifetime: 0 }]);
      memory.seed("gameConfig", [{ _id: "default", privateBankingEnabled: true }]);
      memory.seed(
        "corporations",
        deposits.map((totalDeposits) => ({
          _id: new ObjectId(),
          bankCharter: {
            status: "active",
            currency: "USD",
            cashReserves: 0,
            cbMarginDebt: 0,
            totalDeposits,
          },
        }))
      );
      const result = await executeMonetaryOperation(memory as unknown as Db, {
        countryId: "US",
        type: "liquidity_injection",
        turn: 12,
        actorName: "Chair",
        amount: 400,
        operationId: "wrapper-liquidity",
      });
      expect(
        memory.collection("corporations").docs.map((bank) => bank.bankCharter.cashReserves)
      ).toEqual(expected);
      expect(result.reserveDelta).toBe(reserve);
      expect(result.banksCredited).toBe(expected.length);
      expect(memory.collection("centralBanks").docs[0].reserveBalance).toBe(100 + reserve);
    }
  );
});
