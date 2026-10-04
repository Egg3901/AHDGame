import { MongoClient, ObjectId, type AnyBulkWriteOperation, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import type { Corporation } from "@/lib/db/types";
import type { CorpSnapshot } from "./types";
import { applyOperatingCashThenDevelopmentCash } from "./manufacturingDevelopmentCashSettlement";

describe("manufacturing development cash settlement", () => {
  it("runs after operating cash and snapshots only the actual live balance and receipt", async () => {
    const paidId = new ObjectId();
    const refusedId = new ObjectId();
    const paidCorp = corporation(paidId);
    const refusedCorp = corporation(refusedId);
    const events: string[] = [];
    const developmentOps: AnyBulkWriteOperation<Corporation>[] = [
      { updateOne: { filter: { _id: paidId }, update: { $inc: { liquidCapital: -250 } } } },
      { updateOne: { filter: { _id: refusedId }, update: { $inc: { liquidCapital: -250 } } } },
    ];
    const advertisingReceiptOp = advertisingReceipt(paidId, "media-project-paid");
    const rows = [
      {
        _id: paidId,
        liquidCapital: 750,
        manufacturingProductDevelopmentPaidTurnV2: 5,
        manufacturingProductDevelopmentReceiptV2: {
          projectId: "project-paid",
          turn: 5,
          amountAnchor: 250,
        },
      },
      { _id: refusedId, liquidCapital: 1_000 },
    ];
    const bulkWrite = vi.fn(async (operations: AnyBulkWriteOperation<Corporation>[]) => {
      const update = "updateOne" in operations[0] ? operations[0].updateOne.update : {};
      events.push("$inc" in update ? "development-debit" : "credit-snapshot");
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    });
    const find = vi.fn(() => {
      events.push("cash-and-receipt-read");
      return { toArray: async () => rows };
    });
    const db = {
      collection: () => ({ bulkWrite, find }),
    } as unknown as Db;
    const snapshots = [snapshot(paidId, 1_000), snapshot(refusedId, 1_000)];

    const result = await applyOperatingCashThenDevelopmentCash({
      db,
      operations: [...developmentOps, advertisingReceiptOp],
      turn: 5,
      corporations: [paidCorp, refusedCorp],
      snapshots,
      exchangeRatesByCurrency: new Map([["USD", 1]]),
      bondsByCorpId: new Map(),
      sectorsByCorp: new Map(),
      applyOperatingCashWrites: async () => {
        events.push("operating-p-and-l");
      },
    });

    expect(events).toEqual([
      "operating-p-and-l",
      "development-debit",
      "cash-and-receipt-read",
      "credit-snapshot",
    ]);
    expect(bulkWrite).toHaveBeenNthCalledWith(1, [...developmentOps, advertisingReceiptOp], {
      ordered: false,
    });
    expect(advertisingReceiptOp).toMatchObject({
      updateOne: {
        filter: { _id: paidId, $expr: { $and: expect.any(Array) } },
        update: {
          $set: {
            mediaProductAdvertisingReceiptV1: {
              projectId: "media-project-paid",
              turn: 5,
              amountAnchor: 100,
            },
          },
        },
      },
    });
    expect(result).toEqual({ paidReceipts: 1, paidAmountAnchor: 250 });
    expect(snapshots.map((item) => item.liquidCapital)).toEqual([750, 1_000]);
    expect(snapshots.map((item) => item.liquidCapitalAnchorAfterIncome)).toEqual([750, 1_000]);
  });

  const mongoUri = process.env.AHD_PRODUCT_DEVELOPMENT_MONGO_TEST_URI;
  it.skipIf(!mongoUri)(
    "guards a concurrent cash loss and a retry after receipt consumption in Mongo",
    async () => {
      const client = new MongoClient(mongoUri!);
      await client.connect();
      const db = client.db(`product_development_cash_${new ObjectId().toString()}`);
      const insufficientId = new ObjectId();
      const fundedId = new ObjectId();
      const insufficientCorp = corporation(insufficientId);
      const fundedCorp = corporation(fundedId);
      const collection = db.collection<Corporation>("corporations");
      const operations = [
        developmentDebit(insufficientId, 250, "project-insufficient"),
        developmentDebit(fundedId, 250, "project-funded"),
      ];
      try {
        await collection.insertMany([
          {
            ...insufficientCorp,
            liquidCapital: 1_000,
            operatingCashArrearsByCurrency: { USD: 0 },
          },
          { ...fundedCorp, liquidCapital: 1_000 },
        ]);

        const firstSnapshots = [snapshot(insufficientId, 1_000), snapshot(fundedId, 1_000)];
        const first = await applyOperatingCashThenDevelopmentCash({
          db,
          operations: [
            ...operations,
            advertisingReceipt(insufficientId, "media-project-insufficient"),
            advertisingReceipt(fundedId, "media-project-funded"),
          ],
          turn: 5,
          corporations: [insufficientCorp, fundedCorp],
          snapshots: firstSnapshots,
          exchangeRatesByCurrency: new Map([["USD", 1]]),
          bondsByCorpId: new Map(),
          sectorsByCorp: new Map(),
          applyOperatingCashWrites: async () => {
            await collection.updateOne(
              { _id: insufficientId },
              {
                $set: {
                  liquidCapital: -50,
                  operatingCashArrearsByCurrency: { USD: 50 },
                },
              }
            );
          },
        });

        expect(first).toEqual({ paidReceipts: 1, paidAmountAnchor: 250 });
        expect(firstSnapshots.map((item) => item.liquidCapital)).toEqual([-50, 750]);
        expect(
          await collection.findOne({
            _id: insufficientId,
            manufacturingProductDevelopmentReceiptV2: { $exists: true },
          })
        ).toBeNull();
        expect(
          await collection.findOne({
            _id: insufficientId,
            mediaProductAdvertisingReceiptV1: { $exists: true },
          })
        ).toBeNull();
        expect(
          await collection.findOne({ _id: fundedId, "mediaProductAdvertisingReceiptV1.turn": 5 })
        ).toMatchObject({
          mediaProductAdvertisingReceiptV1: {
            projectId: "media-project-funded",
            turn: 5,
            amountAnchor: 100,
          },
        });

        // Simulate a crash after the durable receipt was consumed. The per-turn
        // stamp still rejects a duplicate debit when the same request is retried.
        await collection.updateOne(
          { _id: fundedId },
          { $unset: { manufacturingProductDevelopmentReceiptV2: "" } }
        );
        const retrySnapshots = [snapshot(insufficientId, -50), snapshot(fundedId, 750)];
        const retry = await applyOperatingCashThenDevelopmentCash({
          db,
          operations: [operations[1]],
          turn: 5,
          corporations: [fundedCorp],
          snapshots: [retrySnapshots[1]],
          exchangeRatesByCurrency: new Map([["USD", 1]]),
          bondsByCorpId: new Map(),
          sectorsByCorp: new Map(),
          applyOperatingCashWrites: async () => undefined,
        });
        expect(retry).toEqual({ paidReceipts: 0, paidAmountAnchor: 0 });
        expect(retrySnapshots[1].liquidCapital).toBe(750);
        expect((await collection.findOne({ _id: fundedId }))?.liquidCapital).toBe(750);
      } finally {
        await db.dropDatabase();
        await client.close();
      }
    },
    20_000
  );
});

function corporation(_id: ObjectId): Corporation {
  return {
    _id,
    name: "Cash test corporation",
    type: "manufacturing",
    countryId: "US",
    liquidCapital: 1_000,
    liquidCurrencyCode: "USD",
    isPrivate: true,
    totalShares: 1_000,
    shareholders: [],
  } as unknown as Corporation;
}

function snapshot(corpId: ObjectId, cash: number): CorpSnapshot {
  return {
    corpId,
    income: 0,
    sectorNPV: 10_000,
    liquidCapital: cash,
    liquidCapitalAnchorAfterIncome: cash,
    creditComposite: 50,
    creditRating: "BB",
  } as CorpSnapshot;
}

function developmentDebit(
  corporationId: ObjectId,
  amount: number,
  projectId: string
): AnyBulkWriteOperation<Corporation> {
  return {
    updateOne: {
      filter: {
        _id: corporationId,
        manufacturingProductDevelopmentPaidTurnV2: { $ne: 5 },
        manufacturingProductDevelopmentReceiptV2: { $exists: false },
        $expr: { $gte: [{ $ifNull: ["$liquidCapital", 0] }, amount] },
      },
      update: {
        $inc: { liquidCapital: -amount },
        $set: {
          manufacturingProductDevelopmentPaidTurnV2: 5,
          manufacturingProductDevelopmentReceiptV2: { projectId, turn: 5, amountAnchor: amount },
        },
      },
    },
  };
}

function advertisingReceipt(
  corporationId: ObjectId,
  projectId: string
): AnyBulkWriteOperation<Corporation> {
  return {
    updateOne: {
      filter: {
        _id: corporationId,
        $or: [
          { "mediaProductAdvertisingReceiptV1.turn": { $exists: false } },
          { "mediaProductAdvertisingReceiptV1.turn": { $lt: 5 } },
        ],
        $expr: {
          $and: [
            { $gte: [{ $ifNull: ["$liquidCapital", 0] }, 0] },
            {
              $eq: [
                {
                  $size: {
                    $filter: {
                      input: {
                        $objectToArray: { $ifNull: ["$operatingCashArrearsByCurrency", {}] },
                      },
                      as: "arrears",
                      cond: { $gt: ["$$arrears.v", 0] },
                    },
                  },
                },
                0,
              ],
            },
          ],
        },
      },
      update: {
        $set: {
          mediaProductAdvertisingReceiptV1: {
            projectId,
            turn: 5,
            amountAnchor: 100,
          },
        },
      },
    },
  };
}
