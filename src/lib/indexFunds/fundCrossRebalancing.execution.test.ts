import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { IndexFund } from "@/lib/db/types";

const mocks = vi.hoisted(() => ({
  creditSharesToFund: vi.fn(),
  debitSharesFromFund: vi.fn(),
  getFundById: vi.fn(),
  insertFundTransaction: vi.fn(),
  updateFundHoldings: vi.fn(),
}));

vi.mock("@/lib/corporations/shareholderOps", () => ({
  creditSharesToFund: mocks.creditSharesToFund,
  debitSharesFromFund: mocks.debitSharesFromFund,
}));
vi.mock("@/lib/indexFunds/fundQueries", () => ({
  getFundById: mocks.getFundById,
  insertFundTransaction: mocks.insertFundTransaction,
  updateFundHoldings: mocks.updateFundHoldings,
}));
vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi.fn(
    async (_withTransaction: unknown, withoutTransaction: () => Promise<unknown>) =>
      withoutTransaction()
  ),
}));
vi.mock("@/lib/corporations/shareTradeHistory", () => ({ recordShareTrade: vi.fn() }));

import { executeFundCrossRebalancing, type PlannedCrossTransfer } from "./fundCrossRebalancing";

describe("executeFundCrossRebalancing standalone compensation", () => {
  const corporationId = new ObjectId();
  const sellerFundId = new ObjectId();
  const buyerFundId = new ObjectId();
  const originalSellerHoldings = [
    { corporationId, shares: 20, avgCostPerShareAnchor: 4, lastValueAnchor: 80 },
  ];
  const originalBuyerHoldings: IndexFund["holdings"] = [];
  const plan: PlannedCrossTransfer = {
    corporationId,
    sellerFundId,
    buyerFundId,
    shares: 5,
    pricePerShareAnchor: 4,
    valueAnchor: 20,
  };

  let cashUpdates: Array<{ filter: unknown; update: unknown }>;
  let capTableUpdates: Array<{ filter: unknown; update: unknown }>;
  let failBuyerHoldingsRestore: boolean;
  let db: Db;

  beforeEach(() => {
    vi.clearAllMocks();
    cashUpdates = [];
    capTableUpdates = [];
    failBuyerHoldingsRestore = false;
    const seller = {
      _id: sellerFundId,
      name: "Seller",
      cashAnchor: 10,
      holdings: originalSellerHoldings,
    } as IndexFund;
    const buyer = {
      _id: buyerFundId,
      name: "Buyer",
      cashAnchor: 100,
      holdings: originalBuyerHoldings,
    } as IndexFund;
    mocks.getFundById.mockImplementation(async (_db: Db, id: ObjectId) =>
      id.equals(sellerFundId) ? seller : buyer
    );
    mocks.debitSharesFromFund.mockResolvedValue(15);
    mocks.creditSharesToFund.mockResolvedValue(true);
    mocks.updateFundHoldings.mockResolvedValue(undefined);
    mocks.insertFundTransaction
      .mockResolvedValueOnce(new ObjectId())
      .mockRejectedValueOnce(new Error("buyer log failed"));

    db = {
      collection: vi.fn((name: string) => {
        if (name === "corporations") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: corporationId,
              sharePrice: 4,
              fundamentalSharePrice: 4,
              totalShares: 100,
              publicFloat: 0,
              liquidCurrencyCode: "USD",
              shareholders: [
                { fundId: sellerFundId, shares: 20, avgCostPerShare: 2 },
                { fundId: buyerFundId, shares: 10, avgCostPerShare: 9 },
              ],
            }),
            updateOne: vi.fn(async (filter, update) => {
              capTableUpdates.push({ filter, update });
              return { matchedCount: 1 };
            }),
          };
        }
        if (name === "indexFunds") {
          return {
            updateOne: vi.fn(async (filter, update) => {
              cashUpdates.push({ filter, update });
              if (
                failBuyerHoldingsRestore &&
                (filter as { _id?: ObjectId; holdings?: unknown })._id?.equals(buyerFundId) &&
                "holdings" in (filter as object)
              ) {
                throw new Error("buyer restore failed");
              }
              return { matchedCount: 1 };
            }),
          };
        }
        if (name === "indexFundTransactions") {
          return { deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }) };
        }
        throw new Error(`Unexpected collection ${name}`);
      }),
    } as unknown as Db;
  });

  it("reverses every completed write after a late transaction-log failure", async () => {
    const result = await executeFundCrossRebalancing(db, [plan], 7);

    expect(result.transfers).toBe(0);
    expect(result.errors).toEqual([expect.stringContaining("buyer log failed")]);
    expect(mocks.updateFundHoldings).toHaveBeenCalledTimes(2);
    expect(cashUpdates).toHaveLength(6);
    expect(cashUpdates[2]).toMatchObject({
      filter: { _id: buyerFundId, holdings: expect.any(Array) },
      update: { $set: { holdings: originalBuyerHoldings } },
    });
    expect(cashUpdates[3]).toMatchObject({
      filter: { _id: sellerFundId, holdings: expect.any(Array) },
      update: { $set: { holdings: originalSellerHoldings } },
    });
    expect(capTableUpdates).toHaveLength(2);
    expect(capTableUpdates[0]).toMatchObject({
      filter: { shareholders: { $elemMatch: { fundId: buyerFundId, shares: 15 } } },
      update: {
        $set: {
          "shareholders.$.shares": 10,
          "shareholders.$.avgCostPerShare": 9,
        },
      },
    });
    expect(capTableUpdates[1]).toMatchObject({
      filter: { shareholders: { $elemMatch: { fundId: sellerFundId, shares: 15 } } },
      update: {
        $set: {
          "shareholders.$.shares": 20,
          "shareholders.$.avgCostPerShare": 2,
        },
      },
    });
  });

  it("attempts all reversals and reports aggregate failure when compensation is incomplete", async () => {
    failBuyerHoldingsRestore = true;

    const result = await executeFundCrossRebalancing(db, [plan], 7);

    expect(result.errors[0]).toContain("buyer log failed");
    expect(result.errors[0]).toContain("buyer restore failed");
    expect(cashUpdates).toHaveLength(6);
    expect(capTableUpdates).toHaveLength(2);
  });
});
