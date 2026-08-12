import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/banking/featureFlag", () => ({
  isPrivateBankingEnabled: vi.fn().mockResolvedValue(true),
}));

import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import { executeMonetaryOperation } from "./operations";

let db: MockDb;

/** Seat `banks` as active USD charters for the corporations collection. */
function seatBanks(banks: { _id: string; totalDeposits?: number }[]) {
  db.collection("corporations");
  db.collectionMocks.corporations.find.mockReturnValue({
    toArray: async () =>
      banks.map((b) => ({
        _id: b._id,
        bankCharter: { status: "active", currency: "USD", totalDeposits: b.totalDeposits ?? 0 },
      })),
  });
  db.collectionMocks.corporations.bulkWrite.mockResolvedValue({ modifiedCount: banks.length });
}

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

describe("non-QE monetary operations", () => {
  it("creates Treasury money and immediately resyncs the derived debt position", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "federal",
      countryId: "US",
      treasuryBalance: -1_000,
      gdp: 10_000,
      investorConfidence: 70,
      debt: { principal: 1_000, ceiling: 20_000 },
    });

    const result = await executeMonetaryOperation(db as unknown as Db, {
      countryId: "US",
      type: "treasury_advance",
      turn: 12,
      actorName: "Chair",
      amount: 250,
    });

    expect(result.moneySupplyDelta).toBe(250);
    const update = db.collectionMocks.federalBudget.updateOne.mock.calls[0][1].$set;
    expect(update.treasuryBalance).toBe(-750);
    expect(update["debt.principal"]).toBe(750);
    expect(db.collectionMocks.centralBanks.updateOne).toHaveBeenCalledWith(
      { _id: "US" },
      expect.objectContaining({
        $inc: expect.objectContaining({ netMoneyCreatedLifetime: 250 }),
      })
    );
  });

  it("lends an injection to the chartered banks, pro rata by deposits", async () => {
    seatBanks([
      { _id: "bankA", totalDeposits: 900 },
      { _id: "bankB", totalDeposits: 300 },
    ]);

    const result = await executeMonetaryOperation(db as unknown as Db, {
      countryId: "US",
      type: "liquidity_injection",
      turn: 12,
      actorName: "Chair",
      amount: 400,
    });

    // 3:1 deposit split, and the money is created rather than parked.
    const ops = db.collectionMocks.corporations.bulkWrite.mock.calls[0][0];
    expect(
      ops.map((o: never) => (o as { updateOne: { filter: { _id: string } } }).updateOne.filter._id)
    ).toEqual(["bankA", "bankB"]);
    expect(ops[0].updateOne.update.$inc).toEqual({
      liquidCapital: 300,
      "bankCharter.cbMarginDebt": 300,
    });
    expect(ops[1].updateOne.update.$inc.liquidCapital).toBe(100);
    expect(result).toEqual(
      expect.objectContaining({ moneySupplyDelta: 400, reserveDelta: 0, banksCredited: 2 })
    );
    expect(db.collectionMocks.centralBanks.updateOne).toHaveBeenCalledWith(
      { _id: "US" },
      expect.objectContaining({ $inc: expect.objectContaining({ netMoneyCreatedLifetime: 400 }) })
    );
  });

  it("splits evenly when no chartered bank holds deposits yet", async () => {
    seatBanks([{ _id: "bankA" }, { _id: "bankB" }]);

    await executeMonetaryOperation(db as unknown as Db, {
      countryId: "US",
      type: "liquidity_injection",
      turn: 12,
      actorName: "Chair",
      amount: 300,
    });

    const ops = db.collectionMocks.corporations.bulkWrite.mock.calls[0][0];
    expect(ops[0].updateOne.update.$inc.liquidCapital).toBe(150);
    expect(ops[1].updateOne.update.$inc.liquidCapital).toBe(150);
  });

  it("falls back to the central bank's own reserve pool when no bank can take it", async () => {
    seatBanks([]);

    const result = await executeMonetaryOperation(db as unknown as Db, {
      countryId: "US",
      type: "liquidity_injection",
      turn: 12,
      actorName: "Chair",
      amount: 300,
    });

    expect(result).toEqual(
      expect.objectContaining({ moneySupplyDelta: 0, reserveDelta: 300, banksCredited: 0 })
    );
    expect(db.collectionMocks.centralBanks.updateOne).toHaveBeenCalledWith(
      { _id: "US" },
      expect.objectContaining({ $inc: { reserveBalance: 300 } })
    );
  });

  it("falls back when private banking is switched off", async () => {
    vi.mocked(isPrivateBankingEnabled).mockResolvedValueOnce(false);
    seatBanks([{ _id: "bankA", totalDeposits: 100 }]);

    const result = await executeMonetaryOperation(db as unknown as Db, {
      countryId: "US",
      type: "liquidity_injection",
      turn: 12,
      actorName: "Chair",
      amount: 300,
    });

    expect(result.reserveDelta).toBe(300);
    expect(db.collectionMocks.corporations.bulkWrite).not.toHaveBeenCalled();
  });
});
