import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { reconcileSignedTariffBills } from "./reconcileTariffs";

vi.mock("@/lib/budget/revenue", () => ({
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

    expect(db.collectionMocks.tariffs.updateOne).toHaveBeenCalledTimes(2);

    const firstCall = db.collectionMocks.tariffs.updateOne.mock.calls[0];
    const secondCall = db.collectionMocks.tariffs.updateOne.mock.calls[1];

    expect(firstCall[0]).toMatchObject({
      countryId: "US",
      scopeType: "origin_country",
      targetOriginCountryId: "JP",
    });
    expect(firstCall[1].$set.rate).toBe(20);
    expect(secondCall[1].$set.rate).toBe(40);
    expect(secondCall[1].$set.sourceBillId).toStrictEqual(laterBillId);
  });
});
