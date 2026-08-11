import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
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

  it("adds lending reserves without counting them as circulating money", async () => {
    const result = await executeMonetaryOperation(db as unknown as Db, {
      countryId: "US",
      type: "liquidity_injection",
      turn: 12,
      actorName: "Chair",
      amount: 300,
    });

    expect(result).toEqual(
      expect.objectContaining({ moneySupplyDelta: 0, reserveDelta: 300, amount: 300 })
    );
    expect(db.collectionMocks.centralBanks.updateOne).toHaveBeenCalledWith(
      { _id: "US" },
      expect.objectContaining({ $inc: { reserveBalance: 300 } })
    );
  });
});
