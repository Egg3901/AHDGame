import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { calculateJPRegionalBudget, processJPRegionalBudgets } from "./regionalBudget";

describe("calculateJPRegionalBudget", () => {
  const baseInput = {
    residentTaxRate: 0.1, // 10% center rate
    fixedAssetTaxRate: 0.014, // 1.4% center rate
    nationalGrantPerCapita: 170000, // ¥170,000/cap center
    regionPopulation: 5200000, // Hokkaido: 5.2M
    medianIncome: 3500000, // ¥3.5M median
    propertyValueBase: 8000000, // ¥8M avg property value
    nationalPopulation: 126000000, // 126M total
    ministerAllocation: null,
  };

  it("calculates resident tax revenue correctly", () => {
    const result = calculateJPRegionalBudget(baseInput);
    // residentTaxRate × medianIncome × population
    expect(result.residentTaxRevenue).toBe(0.1 * 3500000 * 5200000);
  });

  it("calculates fixed asset tax revenue correctly", () => {
    const result = calculateJPRegionalBudget(baseInput);
    // fixedAssetTaxRate × propertyValueBase × population
    expect(result.fixedAssetTaxRevenue).toBe(0.014 * 8000000 * 5200000);
  });

  it("calculates national grant with even 1/8th split when no minister allocation", () => {
    const result = calculateJPRegionalBudget(baseInput);
    // nationalGrantPerCapita × nationalPopulation / 8 regions
    expect(result.nationalGrant).toBe((170000 * 126000000) / 8);
  });

  it("uses minister allocation when provided", () => {
    const result = calculateJPRegionalBudget({
      ...baseInput,
      ministerAllocation: 5000000000000, // ¥5T allocated to this region
    });
    expect(result.nationalGrant).toBe(5000000000000);
  });

  it("total budget sums all three revenue sources", () => {
    const result = calculateJPRegionalBudget(baseInput);
    expect(result.totalBudget).toBe(
      result.residentTaxRevenue + result.fixedAssetTaxRevenue + result.nationalGrant
    );
  });

  it("handles zero tax rates", () => {
    const result = calculateJPRegionalBudget({
      ...baseInput,
      residentTaxRate: 0,
      fixedAssetTaxRate: 0,
    });
    expect(result.residentTaxRevenue).toBe(0);
    expect(result.fixedAssetTaxRevenue).toBe(0);
    expect(result.totalBudget).toBe(result.nationalGrant);
  });

  it("handles zero national grant", () => {
    const result = calculateJPRegionalBudget({
      ...baseInput,
      nationalGrantPerCapita: 0,
    });
    expect(result.nationalGrant).toBe(0);
    expect(result.totalBudget).toBe(result.residentTaxRevenue + result.fixedAssetTaxRevenue);
  });

  it("handles maximum tax rates", () => {
    const result = calculateJPRegionalBudget({
      ...baseInput,
      residentTaxRate: 0.2, // 20% max
      fixedAssetTaxRate: 0.05, // 5% max
    });
    expect(result.residentTaxRevenue).toBe(0.2 * 3500000 * 5200000);
    expect(result.fixedAssetTaxRevenue).toBe(0.05 * 8000000 * 5200000);
  });
});

describe("processJPRegionalBudgets", () => {
  let db: MockDb;
  const cursor = (rows: unknown[]) => ({
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  });

  beforeEach(() => {
    db = createMockDb();
    for (const name of [
      "states",
      "statePolicies",
      "resetLawPrograms",
      "legislationTypes",
      "regionalBudgets",
      "macroMetrics",
      "cabinetSettings",
    ]) {
      db.collection(name);
    }
  });

  it("settles v2 regional allocations against the live prefectural budget", async () => {
    db.collectionMocks.states!.find.mockImplementation(() =>
      cursor([{ _id: "HOK", countryId: "JP", population: 5_000_000 }])
    );
    let policyRead = 0;
    db.collectionMocks.statePolicies!.find.mockImplementation(() => {
      policyRead += 1;
      return cursor(
        policyRead === 1
          ? [
              {
                stateId: "HOK",
                legislationTypeId: "jp_resident_tax",
                policyOptionId: "resident",
                policyOptionIndex: 0,
                enactedTurn: 1,
                enactedAt: new Date(0),
              },
              {
                stateId: "HOK",
                legislationTypeId: "jp_fixed_asset_tax",
                policyOptionId: "property",
                policyOptionIndex: 0,
                enactedTurn: 1,
                enactedAt: new Date(0),
              },
            ]
          : []
      );
    });
    db.collectionMocks.resetLawPrograms!.find.mockImplementation(() =>
      cursor([
        {
          _id: "world:JP:HOK:L10",
          regionId: "HOK",
          familyId: "L10",
          choice: "center_left",
          annualAgencyAllocation: 5_000_000_000_000,
        },
      ])
    );
    db.collectionMocks.legislationTypes!.find.mockImplementation(() =>
      cursor([
        { _id: "jp_resident_tax", policyOptions: [{ id: "resident", rate: 10 }] },
        { _id: "jp_fixed_asset_tax", policyOptions: [{ id: "property", rate: 1.4 }] },
      ])
    );
    db.collectionMocks.regionalBudgets!.find.mockImplementation(() => cursor([]));
    db.collectionMocks.macroMetrics!.find.mockImplementation(() => cursor([]));
    db.collectionMocks.cabinetSettings!.findOne.mockResolvedValue(null);

    await processJPRegionalBudgets(db as never, 10);

    const setData =
      db.collectionMocks.regionalBudgets!.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(setData.enactedBillCosts).toBe(5_000_000_000_000);
    expect(setData.fundedBillCosts).toBeLessThan(5_000_000_000_000);
    expect(setData.unfundedBillCosts).toBeGreaterThan(0);
    expect(setData.programSettlements["world:JP:HOK:L10"].implementationFactor).toBeGreaterThan(0);
    expect(setData.programSettlements["world:JP:HOK:L10"].implementationFactor).toBeLessThan(1);
  });
});
