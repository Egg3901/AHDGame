import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";
import { reconcileSignedTariffBills } from "./reconcileTariffs";

vi.mock("@/lib/budget/revenue", () => ({
  normalizeFederalTaxRates: vi.fn().mockReturnValue(null),
  calculateFederalRevenue: vi.fn().mockResolvedValue({
    incomeTax: 0,
    domesticCorporateTax: 0,
    foreignCorporateTax: 0,
    payrollTax: 0,
    tariffs: 0,
    salesTax: 0,
    healthcareIncome: 0,
    other: 0,
    total: 0,
  }),
}));

describe("reconcileSignedTariffBills", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("bills");
    db.collection("tariffs");
    db.collection("federalBudget");
  });

  it("seeds baseline economy-wide tariffs from the national budget when no tariff docs exist", async () => {
    db.collectionMocks.tariffs.findOne.mockResolvedValue(null);
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "federal",
      taxRates: {
        incomeTax: 20,
        domesticCorporateTax: 21,
        foreignCorporateTax: 21,
        payrollTax: 15,
        tariffs: 0,
        salesTax: 0,
      },
    });
    db.collectionMocks.bills.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    });

    await reconcileSignedTariffBills(db as unknown as Db, "US");

    expect(db.collectionMocks.tariffs.updateOne).toHaveBeenCalledWith(
      {
        countryId: "US",
        scopeType: "economy_wide",
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          rate: 0,
        }),
      }),
      { upsert: true }
    );
  });

  it("replays signed tariff bills in enactment order so later laws win", async () => {
    const earlierBillId = new ObjectId();
    const laterBillId = new ObjectId();

    db.collectionMocks.tariffs.findOne.mockResolvedValue({
      _id: new ObjectId(),
      countryId: "US",
      scopeType: "economy_wide",
      rate: 2,
      sourceBillId: new ObjectId(),
      createdAt: new Date("2026-04-25T04:00:00Z"),
      updatedAt: new Date("2026-04-25T04:00:00Z"),
    });

    db.collectionMocks.bills.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: earlierBillId,
            countryId: "US",
            status: "signed",
            enactedAt: new Date("2026-04-25T05:00:00Z"),
            updatedAt: new Date("2026-04-25T05:00:00Z"),
            provisions: [
              {
                type: "tariff",
                scopeType: "origin_country",
                targetOriginCountryId: "JP",
                rate: 20,
              },
            ],
          },
          {
            _id: laterBillId,
            countryId: "US",
            status: "signed",
            enactedAt: new Date("2026-04-25T06:00:00Z"),
            updatedAt: new Date("2026-04-25T06:00:00Z"),
            provisions: [
              {
                type: "tariff",
                scopeType: "origin_country",
                targetOriginCountryId: "JP",
                rate: 40,
              },
            ],
          },
        ]),
      }),
    });

    await reconcileSignedTariffBills(db as unknown as Db, "US");

    expect(db.collectionMocks.tariffs.findOne).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.tariffs.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.tariffs.bulkWrite).toHaveBeenCalledTimes(1);

    const [ops, options] = db.collectionMocks.tariffs.bulkWrite.mock.calls[0];
    expect(options).toEqual({ ordered: true });
    expect(ops).toHaveLength(2);
    expect(ops[0].updateOne.filter).toMatchObject({
      countryId: "US",
      scopeType: "origin_country",
      targetOriginCountryId: "JP",
    });
    expect(ops[0].updateOne.update.$set.rate).toBe(20);
    expect(ops[1].updateOne.update.$set.rate).toBe(40);
    expect(ops[1].updateOne.update.$set.sourceBillId).toStrictEqual(laterBillId);
  });

  it("flushes ordered scope updates around an economy-wide budget sync", async () => {
    db.collectionMocks.tariffs.findOne.mockResolvedValue({ rate: 2 });
    db.collectionMocks.federalBudget.findOne.mockResolvedValue(null);
    db.collectionMocks.bills.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: new ObjectId(),
            countryId: "US",
            status: "signed",
            provisions: [
              {
                type: "tariff",
                scopeType: "origin_country",
                targetOriginCountryId: "JP",
                rate: 20,
              },
              { type: "tariff", scopeType: "economy_wide", rate: 5 },
              {
                type: "tariff",
                scopeType: "origin_country",
                targetOriginCountryId: "UK",
                rate: 40,
              },
            ],
          },
        ]),
      }),
    });

    await reconcileSignedTariffBills(db as unknown as Db, "US");

    expect(db.collectionMocks.tariffs.bulkWrite).toHaveBeenCalledTimes(2);
    expect(db.collectionMocks.tariffs.updateOne).toHaveBeenCalledTimes(1);
    const [firstBulk, secondBulk] = db.collectionMocks.tariffs.bulkWrite.mock.invocationCallOrder;
    const [budgetScopeWrite] = db.collectionMocks.tariffs.updateOne.mock.invocationCallOrder;
    expect(firstBulk).toBeLessThan(budgetScopeWrite);
    expect(budgetScopeWrite).toBeLessThan(secondBulk);
  });

  it("repairs a partial ordered reconciliation on the next run", async () => {
    const firstBillId = new ObjectId();
    const secondBillId = new ObjectId();
    const bills = [
      {
        _id: firstBillId,
        countryId: "US",
        status: "signed",
        enactedAt: new Date("2026-04-25T05:00:00Z"),
        provisions: [
          { type: "tariff", scopeType: "origin_country", targetOriginCountryId: "JP", rate: 20 },
          { type: "tariff", scopeType: "economy_wide", rate: 5 },
          { type: "tariff", scopeType: "origin_country", targetOriginCountryId: "UK", rate: 40 },
        ],
      },
      {
        _id: secondBillId,
        countryId: "US",
        status: "signed",
        enactedAt: new Date("2026-04-25T06:00:00Z"),
        provisions: [
          { type: "tariff", scopeType: "origin_country", targetOriginCountryId: "JP", rate: 30 },
        ],
      },
    ];
    const memory = createInMemoryDb();
    memory.seed("bills", bills);
    memory.seed("tariffs", [
      {
        _id: new ObjectId(),
        countryId: "US",
        scopeType: "economy_wide",
        targetSectorType: null,
        targetOriginCountryId: null,
        targetCorporationId: null,
        rate: 2,
      },
    ]);
    const fault = withInjectedCrash(memory, {
      collection: "tariffs",
      op: "bulkWrite",
      onCall: 1,
      afterWrite: true,
    });

    await expect(reconcileSignedTariffBills(fault.db, "US")).rejects.toThrow("crash after");
    expect(fault.log.filter(({ op }) => op === "bulkWrite")).toHaveLength(1);
    expect(memory.collection("tariffs").docs).toHaveLength(2);

    // Crash recovery skips the interrupted phase. This replay models the next turn.
    fault.disarm();
    await reconcileSignedTariffBills(memory as unknown as Db, "US");
    const tariffs = memory.collection("tariffs").docs;
    expect(tariffs).toHaveLength(3);
    expect(
      tariffs
        .map((tariff) => ({
          scope: tariff.scopeType,
          origin: tariff.targetOriginCountryId ?? null,
          rate: tariff.rate,
          sourceBillId: tariff.sourceBillId?.toString() ?? null,
        }))
        .sort((a, b) => `${a.scope}:${a.origin}`.localeCompare(`${b.scope}:${b.origin}`))
    ).toEqual([
      { scope: "economy_wide", origin: null, rate: 5, sourceBillId: firstBillId.toString() },
      { scope: "origin_country", origin: "JP", rate: 30, sourceBillId: secondBillId.toString() },
      { scope: "origin_country", origin: "UK", rate: 40, sourceBillId: firstBillId.toString() },
    ]);
  });
});
