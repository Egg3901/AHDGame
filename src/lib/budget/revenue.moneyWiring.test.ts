import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { calculateFederalRevenue, loadLatestSourcedImportAggregates } from "./revenue";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("./publicEnterpriseRevenue", () => ({
  calculateCountryOwnedBudgetRevenue: vi.fn().mockResolvedValue({ healthcareIncome: 0, other: 0 }),
}));
vi.mock("./spending", () => ({
  calculateFederalSpending: vi
    .fn()
    .mockResolvedValue({ byCategory: {}, stateGrants: 0, debtInterest: 0, total: 0 }),
}));
vi.mock("@/lib/era/context", () => ({
  getEraContext: vi.fn().mockResolvedValue({ year: null }),
}));

// UK: importValue base = 0.2 * GDP, tariffs rate 10%.
const UK_GDP = 14_400_000_000;

function ukBudget() {
  return {
    _id: "UK",
    countryId: "UK",
    gdp: UK_GDP,
    revenue: { other: 0 },
    taxBases: {
      taxableIncome: 0.5 * UK_GDP,
      domesticCorporateProfits: 0.1 * UK_GDP * 0.75,
      foreignCorporateProfits: 0.1 * UK_GDP * 0.25,
      wagesAndSalaries: 0.5 * UK_GDP,
      importValue: 0.2 * UK_GDP,
      taxableSales: 0.35 * UK_GDP,
    },
  };
}

const UK_RATES = {
  incomeTax: 0,
  domesticCorporateTax: 0,
  foreignCorporateTax: 0,
  payrollTax: 0,
  tariffs: 10,
  salesTax: 0,
};

describe("money wiring (interstate-logistics plan step 5, phase B): tariff flow netting", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
  });

  function wire(budget: unknown, enactedLaws: unknown[] = []) {
    db.collectionMocks.federalBudget = {
      ...db.collectionMocks.federalBudget,
      findOne: vi.fn().mockResolvedValue(budget),
    } as typeof db.collectionMocks.federalBudget;
    db.collectionMocks.enactedLaws = {
      ...db.collectionMocks.enactedLaws,
      find: vi.fn().mockImplementation(() => ({
        toArray: vi.fn().mockResolvedValue(enactedLaws),
      })),
    } as typeof db.collectionMocks.enactedLaws;
    db.collection.mockImplementation((name: string) => db.collectionMocks[name]);
  }

  it("sourcedImports omitted: unchanged GDP-proxy tariffs (byte-identical to pre-wiring behavior)", async () => {
    wire(ukBudget());
    const revenue = await calculateFederalRevenue(db as unknown as Db, UK_RATES, "UK");
    // bases.importValue = 0.2 * UK_GDP, rate 10% -> tariffs = 0.02 * UK_GDP.
    expect(revenue.tariffs).toBeCloseTo(0.02 * UK_GDP, 6);
  });

  it("sourcedImports provided with no fx map: fx rate falls back to 1.0 (anchor treated as local)", async () => {
    wire(ukBudget());
    // 1 unit/turn of anchor tariff+import value, annualized by TURNS_PER_YEAR, fx 1.0.
    const revenue = await calculateFederalRevenue(
      db as unknown as Db,
      UK_RATES,
      "UK",
      undefined,
      undefined,
      undefined,
      undefined,
      { tariffPaidAnchor: 100, importValueAnchor: 1000 }
    );
    const annualizedImportValueLocal = 1000 * TURNS_PER_YEAR; // fx 1.0
    const annualizedTariffLocal = 100 * TURNS_PER_YEAR; // fx 1.0
    const nettedProxyBase = Math.max(0, 0.2 * UK_GDP - annualizedImportValueLocal);
    const expectedTariffs = nettedProxyBase * (10 / 100) + annualizedTariffLocal;
    expect(revenue.tariffs).toBeCloseTo(expectedTariffs, 6);
  });

  it("nets the proxy against a real fx-converted, annualized sourced flow", async () => {
    wire(ukBudget());
    const fxRate = 0.8; // 1 anchor (₳) = 0.8 GBP
    const fxByCurrency = new Map([["GBP", fxRate]]) as ReadonlyMap<string, number>;
    // 10_000 ₳/turn import value, 500 ₳/turn tariff paid.
    const tariffPaidAnchor = 500;
    const importValueAnchor = 10_000;
    const revenue = await calculateFederalRevenue(
      db as unknown as Db,
      UK_RATES,
      "UK",
      undefined,
      undefined,
      undefined,
      fxByCurrency as never,
      { tariffPaidAnchor, importValueAnchor }
    );
    const annualizedImportValueLocal = importValueAnchor * TURNS_PER_YEAR * fxRate;
    const annualizedTariffLocal = tariffPaidAnchor * TURNS_PER_YEAR * fxRate;
    const proxyBase = 0.2 * UK_GDP;
    const nettedProxyBase = Math.max(0, proxyBase - annualizedImportValueLocal);
    const expectedTariffs = nettedProxyBase * (10 / 100) + annualizedTariffLocal;
    expect(revenue.tariffs).toBeCloseTo(expectedTariffs, 3);
  });

  it("clamps at zero when the annualized sourced import value exceeds the GDP proxy base", async () => {
    wire(ukBudget());
    const fxRate = 1.0;
    const fxByCurrency = new Map([["GBP", fxRate]]) as ReadonlyMap<string, number>;
    // Deliberately huge anchor import value so annualized-local blows past the
    // 0.2 * UK_GDP proxy base — the max(0, ...) clamp must hold, and the
    // sourced tariff revenue must still show up on top of the clamped-zero base.
    const importValueAnchor = (0.2 * UK_GDP) / TURNS_PER_YEAR + 1_000_000_000;
    const tariffPaidAnchor = 777;
    const revenue = await calculateFederalRevenue(
      db as unknown as Db,
      UK_RATES,
      "UK",
      undefined,
      undefined,
      undefined,
      fxByCurrency as never,
      { tariffPaidAnchor, importValueAnchor }
    );
    const annualizedTariffLocal = tariffPaidAnchor * TURNS_PER_YEAR * fxRate;
    // Clamped base is 0, so tariffs = 0 * rate + annualizedTariffLocal.
    expect(revenue.tariffs).toBeCloseTo(annualizedTariffLocal, 6);
  });

  it("uses the country's own currency fx rate, not another country's entry in the map", async () => {
    wire(ukBudget());
    // Map has a USD entry but no GBP entry -> UK's fx lookup misses -> falls
    // back to 1.0, NOT to the USD rate.
    const fxByCurrency = new Map([["USD", 5.0]]) as ReadonlyMap<string, number>;
    const revenue = await calculateFederalRevenue(
      db as unknown as Db,
      UK_RATES,
      "UK",
      undefined,
      undefined,
      undefined,
      fxByCurrency as never,
      { tariffPaidAnchor: 100, importValueAnchor: 1000 }
    );
    const annualizedImportValueLocal = 1000 * TURNS_PER_YEAR * 1.0;
    const annualizedTariffLocal = 100 * TURNS_PER_YEAR * 1.0;
    const nettedProxyBase = Math.max(0, 0.2 * UK_GDP - annualizedImportValueLocal);
    const expectedTariffs = nettedProxyBase * (10 / 100) + annualizedTariffLocal;
    expect(revenue.tariffs).toBeCloseTo(expectedTariffs, 6);
  });
});

describe("loadLatestSourcedImportAggregates", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
  });

  it("returns an empty map when no sourcingNetworkLoad doc exists at or before the turn", async () => {
    db.collectionMocks.sourcingNetworkLoad = {
      find: vi.fn().mockImplementation(() => ({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
      })),
    } as never;
    db.collection.mockImplementation((name: string) => db.collectionMocks[name]);
    const result = await loadLatestSourcedImportAggregates(db as unknown as Db, 10);
    expect(result.size).toBe(0);
  });

  it("returns the latest doc's importAggregates keyed by countryId", async () => {
    db.collectionMocks.sourcingNetworkLoad = {
      find: vi.fn().mockImplementation(() => ({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([
          {
            turn: 9,
            importAggregates: {
              UK: { tariffPaid: 50, importValue: 900 },
              JP: { tariffPaid: 10, importValue: 200 },
            },
          },
        ]),
      })),
    } as never;
    db.collection.mockImplementation((name: string) => db.collectionMocks[name]);
    const result = await loadLatestSourcedImportAggregates(db as unknown as Db, 10);
    expect(result.get("UK")).toEqual({ tariffPaid: 50, importValue: 900 });
    expect(result.get("JP")).toEqual({ tariffPaid: 10, importValue: 200 });
    expect(result.get("US")).toBeUndefined();
  });
});
