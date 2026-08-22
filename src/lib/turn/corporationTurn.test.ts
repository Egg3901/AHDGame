/**
 * Unit tests for processCorporationTurn — corporation revenue, income, and share price processing.
 * Focuses on return value shape and key processing behaviors since the function is very large.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { softCapEffectiveMargin } from "@/lib/constants/corporations";
import { processCorporationTurn } from "./corporationTurn";
// profitMargin:100 (a "zero maintenance" shortcut in these fixtures) now realizes
// at the soft-capped ~95.2%, so income/tax expectations scale by this factor.
const EFF_MARGIN_100 = softCapEffectiveMargin(100) / 100;

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/wireEvent", () => ({
  logWireEvent: vi.fn().mockResolvedValue(undefined),
  wireHeadlineCorpCreditRating: vi.fn().mockReturnValue("Test headline"),
}));
vi.mock("@/lib/bonds/corporateCredit", () => ({
  sumCorporateSectorConstructionInProgress: vi.fn().mockReturnValue(0),
  computeCorporateCreditAtTurn: vi.fn().mockReturnValue({
    creditRating: { rating: "BBB", compositeScore: 50 },
    totalDebt: 0,
    totalEquity: 1000000,
  }),
  isCorporateIssuerBond: vi.fn().mockReturnValue(false),
}));
vi.mock(
  "@/lib/budget/revenue",
  // Partial mock: keep the real `computeTaxBaseGdpShareBaseline` so
  // seeds/reference/budgets.ts (transitively imported via
  // countryReadinessContract.ts) can still seed each budget's
  // taxBaseGdpShareBaseline at module-load time without this file's full mock
  // dropping the export entirely.
  async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/budget/revenue")>();
    return {
      ...actual,
      refreshNationalBudgetRevenue: vi.fn().mockResolvedValue(undefined),
      GDP_DOMESTIC_CORPORATE_FACTOR: 0.06,
      GDP_FOREIGN_CORPORATE_FACTOR: 0.02,
    };
  }
);
vi.mock("@/lib/nationalization/soeOperations", () => ({
  processSoeOperations: vi.fn().mockResolvedValue({ soeCorps: 0 }),
}));
vi.mock("@/lib/nationalization/pendingNationalizations", () => ({
  processPendingNationalizations: vi.fn().mockResolvedValue({ completed: 0, cancelled: 0 }),
}));
vi.mock("@/lib/nationalization/privatizationAuction", () => ({
  processNationalizationAuctions: vi.fn().mockResolvedValue({ sold: 0, passedIn: 0 }),
}));

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("processCorporationTurn", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const name of [
      "corporations",
      "corporateSectors",
      "unownedSectors",
      "stateMetrics",
      "commodityPrices",
      "centralBanks",
      "bonds",
      "federalBudget",
      "stateBudgets",
      "marketCapHistory",
      "corporationHistory",
      "shareOrders",
      "characters",
      "exchangeRates",
      "states",
      "tariffs",
      "subsidies",
      "npps",
    ]) {
      db.collection(name);
    }
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("returns zero counts when no corporations exist", async () => {
    // All collections return empty by default
    const result = await processCorporationTurn(1);

    expect(result.corporationsProcessed).toBe(0);
    expect(result.sectorsProcessed).toBe(0);
    expect(result.totalRevenueGenerated).toBe(0);
    expect(result.totalIncomeGenerated).toBe(0);
  });

  it("runs the SOE operations phase", async () => {
    const { processSoeOperations } = await import("@/lib/nationalization/soeOperations");
    const { processCorporationTurn } = await import("./corporationTurn");
    await processCorporationTurn(1);
    expect(vi.mocked(processSoeOperations)).toHaveBeenCalledTimes(1);
  });

  it("resolves due deferred nationalizations in Phase 9", async () => {
    const { processPendingNationalizations } =
      await import("@/lib/nationalization/pendingNationalizations");
    const { processCorporationTurn } = await import("./corporationTurn");
    await processCorporationTurn(1);
    expect(vi.mocked(processPendingNationalizations)).toHaveBeenCalledWith(db, 1);
  });

  it("resolves due privatization auctions in Phase 9", async () => {
    const { processNationalizationAuctions } =
      await import("@/lib/nationalization/privatizationAuction");
    const { processCorporationTurn } = await import("./corporationTurn");
    await processCorporationTurn(1);
    expect(vi.mocked(processNationalizationAuctions)).toHaveBeenCalledWith(db, 1);
  });

  it("returns correct result shape with corporations", async () => {
    const corpId = new ObjectId();
    const corp = {
      _id: corpId,
      name: "TestCorp",
      countryId: "US",
      headquartersState: "CA",
      liquidCapital: 1000000,
      maintenanceCost: 500,
      targetGrowthRate: 1.5,
      currentGrowthRate: 1.5,
      marketingBudget: 100,
      marketingStrength: 50,
      logisticsStrength: 50,
      ceoId: null,
      ceoSalary: 0,
      dividendRate: 0,
      sharePrice: 10,
      totalShares: 1000000,
      lastShareTrade: null,
      corporationType: "manufacturing",
      sectors: [],
      creditRating: "BBB",
      creditComposite: 50,
      updatedAt: new Date(),
    };

    const sector = {
      _id: new ObjectId(),
      corporationId: corpId,
      countryId: "US",
      stateId: "CA",
      sectorType: "manufacturing",
      revenue: 10000,
      targetGrowthRate: 1.5,
      currentGrowthRate: 1.5,
      maintenanceCost: 500,
      strategy: null,
    };

    db.collectionMocks["corporations"]!.find.mockReturnValue(makeCursor([corp]));
    db.collectionMocks["corporateSectors"]!.find.mockReturnValue(makeCursor([sector]));
    db.collectionMocks["stateMetrics"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["commodityPrices"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "US", primeRate: 2.75 }])
    );
    db.collectionMocks["bonds"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["federalBudget"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["shareOrders"]!.find.mockReturnValue(makeCursor([]));

    const { processCorporationTurn } = await import("./corporationTurn");
    const result = await processCorporationTurn(1);

    expect(result.corporationsProcessed).toBe(1);
    expect(result.sectorsProcessed).toBe(1);
    expect(typeof result.totalRevenueGenerated).toBe("number");
    expect(typeof result.totalIncomeGenerated).toBe("number");
  });

  it("processes sectors and writes updates via bulkWrite", async () => {
    const corpId = new ObjectId();
    const corp = {
      _id: corpId,
      name: "TestCorp",
      countryId: "US",
      headquartersState: "CA",
      liquidCapital: 1000000,
      maintenanceCost: 500,
      targetGrowthRate: 1.5,
      currentGrowthRate: 1.5,
      marketingBudget: 100,
      marketingStrength: 50,
      logisticsStrength: 50,
      ceoId: null,
      ceoSalary: 0,
      dividendRate: 0,
      sharePrice: 10,
      totalShares: 1000000,
      lastShareTrade: null,
      corporationType: "manufacturing",
      sectors: [],
      creditRating: "BBB",
      creditComposite: 50,
      updatedAt: new Date(),
    };

    const sector = {
      _id: new ObjectId(),
      corporationId: corpId,
      countryId: "US",
      stateId: "CA",
      sectorType: "manufacturing",
      revenue: 10000,
      targetGrowthRate: 2.0,
      currentGrowthRate: 2.0,
      maintenanceCost: 500,
      strategy: null,
    };

    db.collectionMocks["corporations"]!.find.mockReturnValue(makeCursor([corp]));
    db.collectionMocks["corporateSectors"]!.find.mockReturnValue(makeCursor([sector]));
    db.collectionMocks["stateMetrics"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["commodityPrices"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["bonds"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["federalBudget"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["shareOrders"]!.find.mockReturnValue(makeCursor([]));

    const { processCorporationTurn } = await import("./corporationTurn");
    await processCorporationTurn(1);

    // Sectors should be updated via bulkWrite
    expect(db.collectionMocks["corporateSectors"]!.bulkWrite).toHaveBeenCalled();
    // Corps should be updated via bulkWrite
    expect(db.collectionMocks["corporations"]!.bulkWrite).toHaveBeenCalled();
    // History snapshots should be inserted
    expect(db.collectionMocks["corporationHistory"]!.insertMany).toHaveBeenCalled();
  });

  it("updates federal budget taxBases.corporateProfits with blended value when a profitable corp exists", async () => {
    const corpId = new ObjectId();
    const corp = {
      _id: corpId,
      name: "TaxCorp",
      type: "technology",
      countryId: "US",
      headquartersState: "US_CA",
      liquidCapital: 1_000_000,
      marketingBudget: 0,
      logisticsBudget: 0,
      marketingStrength: 0,
      logisticsStrength: 0,
      totalShares: 10_000_000,
      sharePrice: 1.0,
      ceoId: new ObjectId(),
      userId: new ObjectId(),
      dividendRate: 0,
      shareholders: [],
    };
    const sector = {
      _id: new ObjectId(),
      corporationId: corpId,
      countryId: "US",
      stateId: "US_CA",
      sectorType: "technology",
      revenue: 96_000,
      profitMargin: 50,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
      currentGrowthCost: 0,
      updatedAt: new Date(),
    };
    const federalBudget = {
      _id: "federal",
      countryId: "US",
      gdp: 27_000_000_000_000,
      taxBases: {
        taxableIncome: 9_000_000_000_000,
        domesticCorporateProfits: 2_160_000_000_000 * 0.75,
        foreignCorporateProfits: 2_160_000_000_000 * 0.25,
        wagesAndSalaries: 8_000_000_000_000,
        importValue: 3_000_000_000_000,
        taxableSales: 12_000_000_000_000,
      },
      taxRates: {
        incomeTax: 22,
        domesticCorporateTax: 21,
        foreignCorporateTax: 21,
        payrollTax: 15.3,
        tariffs: 3,
      },
      economicFactors: { inflationRate: 2.5 },
      debtToGdpRatio: 0.9,
      surplus: -1_000_000_000,
      debt: { principal: 0, interestRate: 0 },
      revenue: {
        incomeTax: 0,
        domesticCorporateTax: 0,
        foreignCorporateTax: 0,
        payrollTax: 0,
        tariffs: 0,
        salesTax: 0,
        healthcareIncome: 0,
        other: 0,
        total: 0,
      },
      spending: { total: 0 },
    };

    db.collectionMocks["corporations"]!.find.mockReturnValue(makeCursor([corp]));
    db.collectionMocks["corporateSectors"]!.find.mockReturnValue(makeCursor([sector]));
    db.collectionMocks["federalBudget"]!.find.mockReturnValue(makeCursor([federalBudget]));
    db.collectionMocks["stateBudgets"]!.find.mockReturnValue(makeCursor([]));

    const { processCorporationTurn } = await import("./corporationTurn");
    await processCorporationTurn(1);

    // federalBudget should have been bulkWritten with a blended corporateProfits value.
    // The GDP portion: 27T * 0.08 * 0.75 = 1.62T
    // The actual-corps portion is some small number (income * 48 * 0.25)
    // We just verify the blended value is less than the pure GDP value (2.16T)
    // and greater than the 75% GDP floor (1.62T), confirming blending occurred.
    const bulkWriteCalls = db.collectionMocks["federalBudget"]!.bulkWrite?.mock?.calls ?? [];
    const taxBaseOps = bulkWriteCalls
      .flatMap(
        (call: unknown[]) =>
          call[0] as Array<{ updateOne?: { update?: { $set?: Record<string, number> } } }>
      )
      .filter(
        (op) => op.updateOne?.update?.$set?.["taxBases.domesticCorporateProfits"] !== undefined
      );

    expect(taxBaseOps.length).toBeGreaterThan(0);
    // Combine domestic + foreign — total corp profits base after the split matches the
    // pre-split semantics (sum of both sides).
    const setBlock = taxBaseOps[0].updateOne!.update!.$set!;
    const blendedValue =
      setBlock["taxBases.domesticCorporateProfits"] + setBlock["taxBases.foreignCorporateProfits"];
    const gdpFloor = 27_000_000_000_000 * 0.08 * 0.75;
    expect(blendedValue).toBeGreaterThanOrEqual(gdpFloor);
    expect(blendedValue).toBeLessThan(27_000_000_000_000 * 0.08); // less than pure GDP base
  });

  it("converts anchor-unit corp income into local currency before blending into a JP federal tax base", async () => {
    // Regression guard for the forex-migration bug: corp income accumulates in anchor (₳/USD)
    // but gdpBase is in each country's local currency. Without fx conversion, JP's 25%
    // "actual corp income" contribution is ~150× too small (essentially zero at JPY scale).
    const corpId = new ObjectId();
    const corp = {
      _id: corpId,
      name: "JPTaxCorp",
      type: "technology",
      countryId: "JP",
      headquartersState: "KNS",
      liquidCapital: 1_000_000,
      marketingBudget: 0,
      logisticsBudget: 0,
      marketingStrength: 0,
      logisticsStrength: 0,
      totalShares: 10_000_000,
      sharePrice: 1.0,
      ceoId: new ObjectId(),
      userId: new ObjectId(),
      dividendRate: 0,
      shareholders: [],
    };
    // Post-v0.2.6 storage: sector.revenue is in the corp's home currency (JPY here).
    // 360_000 JPY daily at rate 150 = 2400 ₳ daily = 100 ₳/turn hourly, the same
    // ₳-equivalent activity the pre-migration fixture (2400 stored as ₳) modelled.
    // 100% profitMargin, no growth → annualized = 100 × 48 = 4800 ₳/year.
    const sector = {
      _id: new ObjectId(),
      corporationId: corpId,
      countryId: "JP",
      stateId: "KNS",
      sectorType: "technology",
      revenue: 360_000,
      profitMargin: 100,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
      currentGrowthCost: 0,
      updatedAt: new Date(),
    };
    const federalBudget = {
      _id: "JP",
      countryId: "JP",
      gdp: 100_000_000_000, // 100B JPY for tractable math
      taxBases: { domesticCorporateProfits: 0, foreignCorporateProfits: 0 },
      taxRates: { domesticCorporateTax: 23, foreignCorporateTax: 23 },
      economicFactors: { inflationRate: 2 },
      debtToGdpRatio: 0,
      surplus: 0,
      debt: { principal: 0, interestRate: 0 },
      revenue: { domesticCorporateTax: 0, foreignCorporateTax: 0, total: 0 },
      spending: { total: 0 },
    };

    db.collectionMocks["corporations"]!.find.mockReturnValue(makeCursor([corp]));
    db.collectionMocks["corporateSectors"]!.find.mockReturnValue(makeCursor([sector]));
    db.collectionMocks["federalBudget"]!.find.mockReturnValue(makeCursor([federalBudget]));
    db.collectionMocks["stateBudgets"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["exchangeRates"]!.find.mockReturnValue(
      makeCursor([{ currencyCode: "JPY", rate: 150 }])
    );

    const { processCorporationTurn } = await import("./corporationTurn");
    await processCorporationTurn(1);

    const bulkWriteCalls = db.collectionMocks["federalBudget"]!.bulkWrite?.mock?.calls ?? [];
    const taxBaseOps = bulkWriteCalls
      .flatMap(
        (call: unknown[]) =>
          call[0] as Array<{ updateOne?: { update?: { $set?: Record<string, number> } } }>
      )
      .filter(
        (op) => op.updateOne?.update?.$set?.["taxBases.domesticCorporateProfits"] !== undefined
      );

    expect(taxBaseOps.length).toBe(1);
    const setBlock = taxBaseOps[0].updateOne!.update!.$set!;
    const blended =
      setBlock["taxBases.domesticCorporateProfits"] + setBlock["taxBases.foreignCorporateProfits"];

    // gdpBase = 100B × 0.08 = 8B JPY;  75% floor = 6B JPY.
    // annualized anchor income = 4800 ₳; converted to JPY at 150 → 720_000 JPY;
    // 25% contribution = 180_000 JPY. Expected blended ≈ 6B + 180_000.
    // Without the fix the contribution would be raw 4800 × 0.25 = 1200 (anchor units
    // treated as JPY), which rounds to the floor at this scale — the 100× floor below
    // catches it.
    const gdpFloor = 100_000_000_000 * 0.08 * 0.75;
    // Contribution is ~180k JPY at full margin. The high side is soft-capped and
    // the realized value depends on the sector's live modifier stack, so bound it:
    // at least the zero-modifier soft-capped level, at most the full-margin level.
    // (The >1200×100 guard is what actually proves FX conversion ran, not raw ₳.)
    const contribution = blended - gdpFloor;
    expect(contribution).toBeGreaterThan(180_000 * EFF_MARGIN_100 * 0.99);
    expect(contribution).toBeLessThan(180_000 * 1.01);
    expect(contribution).toBeGreaterThan(1200 * 100);
  });

  it("converts anchor-unit corp income into local currency before blending into a JP state/region tax base", async () => {
    const corpId = new ObjectId();
    const corp = {
      _id: corpId,
      name: "JPStateCorp",
      type: "technology",
      countryId: "JP",
      headquartersState: "KNS",
      liquidCapital: 1_000_000,
      marketingBudget: 0,
      logisticsBudget: 0,
      marketingStrength: 0,
      logisticsStrength: 0,
      totalShares: 10_000_000,
      sharePrice: 1.0,
      ceoId: new ObjectId(),
      userId: new ObjectId(),
      dividendRate: 0,
      shareholders: [],
    };
    // Same rescale as the federal-tax-base test: 360_000 JPY = 2400 ₳ at rate 150.
    const sector = {
      _id: new ObjectId(),
      corporationId: corpId,
      countryId: "JP",
      stateId: "KNS",
      sectorType: "technology",
      revenue: 360_000,
      profitMargin: 100,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
      currentGrowthCost: 0,
      updatedAt: new Date(),
    };
    const federalBudget = {
      _id: "JP",
      countryId: "JP",
      gdp: 100_000_000_000,
      taxBases: { domesticCorporateProfits: 0, foreignCorporateProfits: 0 },
      taxRates: { domesticCorporateTax: 23, foreignCorporateTax: 23 },
      economicFactors: { inflationRate: 2 },
      debtToGdpRatio: 0,
      surplus: 0,
      debt: { principal: 0, interestRate: 0 },
      revenue: { domesticCorporateTax: 0, foreignCorporateTax: 0, total: 0 },
      spending: { total: 0 },
    };
    const stateBudget = {
      _id: "KNS",
      stateId: "KNS",
      stateGdp: 10_000_000_000, // 10B JPY
      taxBases: { domesticCorporateProfits: 0, foreignCorporateProfits: 0 },
      taxRates: { domesticCorporateTax: 1.5, foreignCorporateTax: 1.5 },
      revenue: { total: 0 },
      spending: { total: 0 },
    };

    db.collectionMocks["corporations"]!.find.mockReturnValue(makeCursor([corp]));
    db.collectionMocks["corporateSectors"]!.find.mockReturnValue(makeCursor([sector]));
    db.collectionMocks["federalBudget"]!.find.mockReturnValue(makeCursor([federalBudget]));
    db.collectionMocks["stateBudgets"]!.find.mockReturnValue(makeCursor([stateBudget]));
    db.collectionMocks["states"]!.find.mockReturnValue(
      makeCursor([{ _id: "KNS", countryId: "JP" }])
    );
    db.collectionMocks["exchangeRates"]!.find.mockReturnValue(
      makeCursor([{ currencyCode: "JPY", rate: 150 }])
    );

    const { processCorporationTurn } = await import("./corporationTurn");
    await processCorporationTurn(1);

    const bulkWriteCalls = db.collectionMocks["stateBudgets"]!.bulkWrite?.mock?.calls ?? [];
    const taxBaseOps = bulkWriteCalls
      .flatMap(
        (call: unknown[]) =>
          call[0] as Array<{ updateOne?: { update?: { $set?: Record<string, number> } } }>
      )
      .filter(
        (op) => op.updateOne?.update?.$set?.["taxBases.domesticCorporateProfits"] !== undefined
      );

    expect(taxBaseOps.length).toBe(1);
    const setBlock = taxBaseOps[0].updateOne!.update!.$set!;
    const blended =
      setBlock["taxBases.domesticCorporateProfits"] + setBlock["taxBases.foreignCorporateProfits"];

    // gdpBase = 10B × 0.08 = 800M JPY; 75% floor = 600M JPY.
    // annualized anchor = 4800 ₳ → 720_000 JPY after fx; 25% contribution = 180_000 JPY.
    const gdpFloor = 10_000_000_000 * 0.08 * 0.75;
    // Contribution is ~180k JPY at full margin. The high side is soft-capped and
    // the realized value depends on the sector's live modifier stack, so bound it:
    // at least the zero-modifier soft-capped level, at most the full-margin level.
    // (The >1200×100 guard is what actually proves FX conversion ran, not raw ₳.)
    const contribution = blended - gdpFloor;
    expect(contribution).toBeGreaterThan(180_000 * EFF_MARGIN_100 * 0.99);
    expect(contribution).toBeLessThan(180_000 * 1.01);
    expect(contribution).toBeGreaterThan(1200 * 100);
  });

  it("splits federal taxBase writes across sector countries for cross-border corps", async () => {
    // US-HQ corp with one US sector and one UK sector. Tax-base blend should write
    // updates to BOTH federal budget docs (one per country), keyed by sector.countryId,
    // not corp.countryId.
    const corpId = new ObjectId();
    const corp = {
      _id: corpId,
      name: "MultiCorp",
      type: "technology",
      countryId: "US",
      headquartersState: "US_CA",
      liquidCapital: 1_000_000,
      marketingBudget: 0,
      logisticsBudget: 0,
      marketingStrength: 0,
      logisticsStrength: 0,
      totalShares: 10_000_000,
      sharePrice: 1.0,
      ceoId: new ObjectId(),
      userId: new ObjectId(),
      dividendRate: 0,
      shareholders: [],
    };
    const usSector = {
      _id: new ObjectId(),
      corporationId: corpId,
      countryId: "US",
      stateId: "US_CA",
      sectorType: "technology",
      revenue: 96_000,
      profitMargin: 50,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
      currentGrowthCost: 0,
      updatedAt: new Date(),
    };
    const ukSector = {
      _id: new ObjectId(),
      corporationId: corpId,
      countryId: "UK",
      stateId: "UK_ENG",
      sectorType: "technology",
      revenue: 48_000,
      profitMargin: 50,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
      currentGrowthCost: 0,
      updatedAt: new Date(),
    };
    const makeFederalBudget = (id: string, countryId: string, gdp: number) => ({
      _id: id,
      countryId,
      gdp,
      taxBases: {
        taxableIncome: gdp * 0.35,
        domesticCorporateProfits: gdp * 0.06,
        foreignCorporateProfits: gdp * 0.02,
        wagesAndSalaries: gdp * 0.31,
        importValue: gdp * 0.18,
        taxableSales: gdp * 0.55,
      },
      taxRates: {
        incomeTax: 22,
        domesticCorporateTax: 21,
        foreignCorporateTax: 21,
        payrollTax: 15.3,
        tariffs: 3,
      },
      economicFactors: { inflationRate: 2.5 },
      debtToGdpRatio: 0.9,
      surplus: -1_000_000_000,
      debt: { principal: 0, interestRate: 0 },
      revenue: {
        incomeTax: 0,
        domesticCorporateTax: 0,
        foreignCorporateTax: 0,
        payrollTax: 0,
        tariffs: 0,
        salesTax: 0,
        healthcareIncome: 0,
        other: 0,
        total: 0,
      },
      spending: { total: 0 },
    });
    const usBudget = makeFederalBudget("federal", "US", 27_000_000_000_000);
    const ukBudget = makeFederalBudget("UK", "UK", 3_000_000_000_000);

    db.collectionMocks["corporations"]!.find.mockReturnValue(makeCursor([corp]));
    db.collectionMocks["corporateSectors"]!.find.mockReturnValue(makeCursor([usSector, ukSector]));
    db.collectionMocks["federalBudget"]!.find.mockReturnValue(makeCursor([usBudget, ukBudget]));
    db.collectionMocks["stateBudgets"]!.find.mockReturnValue(makeCursor([]));

    const { processCorporationTurn } = await import("./corporationTurn");
    await processCorporationTurn(1);

    const bulkWriteCalls = db.collectionMocks["federalBudget"]!.bulkWrite?.mock?.calls ?? [];
    const taxBaseOps = bulkWriteCalls
      .flatMap(
        (call: unknown[]) =>
          call[0] as Array<{
            updateOne?: {
              filter: { _id: string };
              update: { $set: Record<string, number> };
            };
          }>
      )
      .filter(
        (op) => op.updateOne?.update?.$set?.["taxBases.domesticCorporateProfits"] !== undefined
      );

    // Both countries should receive a corporateProfits write — one per sector country.
    const writtenIds = new Set(taxBaseOps.map((op) => op.updateOne!.filter._id));
    expect(writtenIds.has("federal")).toBe(true);
    expect(writtenIds.has("UK")).toBe(true);
  });

  it("persists per-turn tax metrics and per-jurisdiction breakdowns to corporationHistory", async () => {
    // US-HQ corp with one US sector and one JP sector. Both are profitable, so tax is owed
    // in both countries. The corporationHistory snapshot should persist total corporate tax,
    // federal/state splits, and per-country / per-state breakdown maps so the data is
    // auditable from Mongo without re-computing.
    const corpId = new ObjectId();
    const corp = {
      _id: corpId,
      name: "HistoryCorp",
      type: "technology",
      countryId: "US",
      headquartersState: "US_CA",
      liquidCapital: 1_000_000,
      marketingBudget: 0,
      logisticsBudget: 0,
      marketingStrength: 0,
      logisticsStrength: 0,
      totalShares: 10_000_000,
      sharePrice: 1.0,
      ceoId: new ObjectId(),
      userId: new ObjectId(),
      dividendRate: 0,
      shareholders: [],
    };
    const usSector = {
      _id: new ObjectId(),
      corporationId: corpId,
      countryId: "US",
      stateId: "US_CA",
      sectorType: "technology",
      revenue: 2400,
      profitMargin: 100,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
      currentGrowthCost: 0,
      updatedAt: new Date(),
    };
    const jpSector = {
      _id: new ObjectId(),
      corporationId: corpId,
      countryId: "JP",
      stateId: "KNS",
      sectorType: "technology",
      // Sector revenue is stored in the host currency. At 150 JPY per anchor
      // unit this is the same 2,400 anchor-unit annual revenue as the US sector.
      revenue: 360_000,
      profitMargin: 100,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
      currentGrowthCost: 0,
      updatedAt: new Date(),
    };
    const usFed = {
      _id: "federal",
      countryId: "US",
      gdp: 27_000_000_000_000,
      taxBases: { domesticCorporateProfits: 0, foreignCorporateProfits: 0 },
      taxRates: { domesticCorporateTax: 20, foreignCorporateTax: 20 },
      economicFactors: { inflationRate: 2 },
      debtToGdpRatio: 0,
      surplus: 0,
      debt: { principal: 0, interestRate: 0 },
      revenue: { domesticCorporateTax: 0, foreignCorporateTax: 0, total: 0 },
      spending: { total: 0 },
    };
    const jpFed = {
      _id: "JP",
      countryId: "JP",
      gdp: 100_000_000_000,
      taxBases: { domesticCorporateProfits: 0, foreignCorporateProfits: 0 },
      taxRates: { domesticCorporateTax: 23, foreignCorporateTax: 23 },
      economicFactors: { inflationRate: 2 },
      debtToGdpRatio: 0,
      surplus: 0,
      debt: { principal: 0, interestRate: 0 },
      revenue: { domesticCorporateTax: 0, foreignCorporateTax: 0, total: 0 },
      spending: { total: 0 },
    };
    const usState = {
      _id: "US_CA",
      stateId: "US_CA",
      stateGdp: 3_000_000_000_000,
      taxBases: { domesticCorporateProfits: 0, foreignCorporateProfits: 0 },
      taxRates: { domesticCorporateTax: 6, foreignCorporateTax: 6 },
      revenue: { total: 0 },
      spending: { total: 0 },
    };
    const jpState = {
      _id: "KNS",
      stateId: "KNS",
      stateGdp: 10_000_000_000,
      taxBases: { domesticCorporateProfits: 0, foreignCorporateProfits: 0 },
      taxRates: { domesticCorporateTax: 1.5, foreignCorporateTax: 1.5 },
      revenue: { total: 0 },
      spending: { total: 0 },
    };

    db.collectionMocks["corporations"]!.find.mockReturnValue(makeCursor([corp]));
    db.collectionMocks["corporateSectors"]!.find.mockReturnValue(makeCursor([usSector, jpSector]));
    db.collectionMocks["federalBudget"]!.find.mockReturnValue(makeCursor([usFed, jpFed]));
    db.collectionMocks["stateBudgets"]!.find.mockReturnValue(makeCursor([usState, jpState]));
    db.collectionMocks["exchangeRates"]!.find.mockReturnValue(
      makeCursor([{ currencyCode: "JPY", rate: 150 }])
    );
    db.collectionMocks["states"]!.find.mockReturnValue(
      makeCursor([
        // gdp drives the per-sector market floor; without it the floor is 0 and a
        // sole-owner sector reads as 100% share (dominance penalty), muddying the
        // clean $100-net tax scenario this test asserts. Real states always carry gdp.
        { _id: "US_CA", countryId: "US", gdp: 3_000_000_000_000 },
        { _id: "KNS", countryId: "JP", gdp: 10_000_000_000 },
      ])
    );

    const { processCorporationTurn } = await import("./corporationTurn");
    await processCorporationTurn(1);

    const insertCalls = db.collectionMocks["corporationHistory"]!.insertMany.mock.calls;
    expect(insertCalls.length).toBe(1);
    const doc = (insertCalls[0][0] as Array<Record<string, unknown>>)[0];

    // Two sectors (US, JP), profitMargin:100 with no overhead. Two engine effects
    // shape the taxed base: (1) the effective margin is soft-capped, so each sector
    // realizes just under 100% instead of a hard-clamped exactly-100; (2) captured
    // revenue is scaled by market share, which is now measured over real market
    // revenue rather than an unowned pool (PR #1145). Together these land pre-tax
    // income at ~174, and each jurisdiction taxes its own share. Values are the
    // deterministic engine output; rates (20/6, 23/1.5) are unchanged. Aggregate
    // stateTaxPaid and the per-state breakdown are rounded independently, so they
    // can differ by a unit (7 vs 5+1).
    expect(doc.corporateTaxPaid).toBe(44);
    expect(doc.federalTaxPaid).toBe(37);
    expect(doc.stateTaxPaid).toBe(7);
    expect(doc.incomePreDividends).toBeCloseTo(174, 0);
    expect((doc.taxPaidByCountry as Record<string, number>).US).toBe(18);
    expect((doc.taxPaidByCountry as Record<string, number>).JP).toBe(19);
    expect((doc.taxPaidByState as Record<string, number>).US_CA).toBe(5);
    expect((doc.taxPaidByState as Record<string, number>).KNS).toBe(1);
  });

  it("does not bulkWrite tax base updates when no corporations exist", async () => {
    const { processCorporationTurn } = await import("./corporationTurn");
    await processCorporationTurn(1);

    // stateBudgets.find is called once by buildCorporationLookups (builds the
    // stateCorporateTaxRateByState map). It should NOT be called additionally by
    // the Phase 4 tax-base update block when there are no corps.
    expect(db.collectionMocks["stateBudgets"]!.find.mock.calls.length).toBe(1);

    // No bulkWrite on stateBudgets or federalBudget for tax base ops
    // (incomeByCountry / incomeByOperatingState are empty → filter removes all).
    const stateBulkWriteCalls = db.collectionMocks["stateBudgets"]!.bulkWrite?.mock?.calls ?? [];
    expect(stateBulkWriteCalls.length).toBe(0);

    const bulkWriteCalls = db.collectionMocks["federalBudget"]!.bulkWrite?.mock?.calls ?? [];
    const taxBaseWriteCalls = bulkWriteCalls.filter((call: unknown[]) => {
      const ops = call[0] as Array<{
        updateOne?: { update?: { $set?: Record<string, unknown> } };
      }>;
      return ops.some(
        (op) =>
          op.updateOne?.update?.$set?.["taxBases.domesticCorporateProfits"] !== undefined ||
          op.updateOne?.update?.$set?.["taxBases.foreignCorporateProfits"] !== undefined
      );
    });
    expect(taxBaseWriteCalls.length).toBe(0);
  });

  it("deducts corporate taxes from corporation income based on country tax rate", async () => {
    const corpId = new ObjectId();
    const corp = {
      _id: corpId,
      name: "TaxableCorp",
      type: "technology",
      headquartersState: "US_CA",
      liquidCapital: 1_000_000,
      marketingBudget: 0,
      logisticsBudget: 0,
      marketingStrength: 0,
      logisticsStrength: 0,
      totalShares: 10_000_000,
      sharePrice: 1.0,
      ceoId: new ObjectId(),
      userId: new ObjectId(),
      dividendRate: 0,
      shareholders: [],
    };
    const sector = {
      _id: new ObjectId(),
      corporationId: corpId,
      countryId: "US",
      stateId: "US_CA",
      sectorType: "technology",
      revenue: 96_000,
      profitMargin: 50,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
      currentGrowthCost: 0,
      updatedAt: new Date(),
    };
    const federalBudget = {
      _id: "federal",
      countryId: "US",
      gdp: 27_000_000_000_000,
      taxBases: {
        taxableIncome: 9_000_000_000_000,
        domesticCorporateProfits: 2_160_000_000_000 * 0.75,
        foreignCorporateProfits: 2_160_000_000_000 * 0.25,
        wagesAndSalaries: 8_000_000_000_000,
        importValue: 3_000_000_000_000,
        taxableSales: 12_000_000_000_000,
      },
      taxRates: {
        incomeTax: 22,
        domesticCorporateTax: 21,
        foreignCorporateTax: 21,
        payrollTax: 15.3,
        tariffs: 3,
      },
      economicFactors: { inflationRate: 2.5 },
      debtToGdpRatio: 0.9,
      surplus: -1_000_000_000,
      debt: { principal: 0, interestRate: 0 },
      revenue: {
        incomeTax: 0,
        domesticCorporateTax: 0,
        foreignCorporateTax: 0,
        payrollTax: 0,
        tariffs: 0,
        salesTax: 0,
        healthcareIncome: 0,
        other: 0,
        total: 0,
      },
      spending: { total: 0 },
    };

    db.collectionMocks["corporations"]!.find.mockReturnValue(makeCursor([corp]));
    db.collectionMocks["corporateSectors"]!.find.mockReturnValue(makeCursor([sector]));
    db.collectionMocks["federalBudget"]!.find.mockReturnValue(makeCursor([federalBudget]));
    db.collectionMocks["stateBudgets"]!.find.mockReturnValue(makeCursor([]));

    const { processCorporationTurn } = await import("./corporationTurn");
    await processCorporationTurn(1);

    // Verify corporations bulkWrite was called with tax-deducted income
    const corpBulkWriteCalls = db.collectionMocks["corporations"]!.bulkWrite?.mock?.calls ?? [];
    expect(corpBulkWriteCalls.length).toBeGreaterThan(0);

    // Extract the liquidCapital increment from the corp update
    const ops = corpBulkWriteCalls[0][0] as Array<{
      updateOne?: { update?: { $inc?: { liquidCapital?: number } } };
    }>;
    const liquidCapitalInc = ops.find((op) => op.updateOne?.update?.$inc?.liquidCapital != null)
      ?.updateOne?.update?.$inc?.liquidCapital;

    // With 50% margin on $96k revenue, incomePreDividends = ~$48k per turn (daily/24)
    // Corporate tax at 21% should reduce the income added to liquidCapital
    expect(typeof liquidCapitalInc).toBe("number");
    // Income should be positive but less than pre-tax amount
    expect(liquidCapitalInc).toBeGreaterThan(0);
  });

  it("completes the turn and credits an NPP shareholder's dividend without a BSONError", async () => {
    // Regression for the corp-turn halt: a dividend paid to an NPP shareholder
    // produces an "npp:<id>" key in dividendPayments. The recipient-name resolution
    // batch only stripped the "imperial:" prefix, so the raw "npp:<id>" string was
    // fed to new ObjectId(), throwing BSONError and aborting the ENTIRE corporation
    // turn every tick (revenue, payments, history, and deferred nationalizations).
    const corpId = new ObjectId();
    const nppId = new ObjectId();
    const corp = {
      _id: corpId,
      name: "NppHeldCorp",
      type: "technology",
      countryId: "US",
      headquartersState: "US_CA",
      liquidCapital: 1_000_000,
      marketingBudget: 0,
      logisticsBudget: 0,
      marketingStrength: 0,
      logisticsStrength: 0,
      totalShares: 10_000_000,
      sharePrice: 1.0,
      ceoId: null,
      ceoSalary: 0,
      dividendRate: 10,
      // NPP shareholder: no characterId/imperialCharacterId, so the dividend keys
      // as "npp:<id>" — the exact shape that triggered the crash on live.
      shareholders: [{ shares: 5_100_000, nppId }],
    };
    const sector = {
      _id: new ObjectId(),
      corporationId: corpId,
      countryId: "US",
      stateId: "US_CA",
      sectorType: "technology",
      revenue: 96_000,
      profitMargin: 100,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
      currentGrowthCost: 0,
      updatedAt: new Date(),
    };

    db.collectionMocks["corporations"]!.find.mockReturnValue(makeCursor([corp]));
    db.collectionMocks["corporateSectors"]!.find.mockReturnValue(makeCursor([sector]));
    db.collectionMocks["states"]!.find.mockReturnValue(
      makeCursor([{ _id: "US_CA", countryId: "US", gdp: 3_000_000_000_000 }])
    );

    const { processCorporationTurn } = await import("./corporationTurn");
    // The turn must complete (no BSONError) and the NPP must be credited via npps.
    const result = await processCorporationTurn(1);
    expect(result.corporationsProcessed).toBe(1);

    const nppBulkWriteCalls = db.collectionMocks["npps"]!.bulkWrite?.mock?.calls ?? [];
    // Phase 6b credits NPP ownership income to personal wealth
    // (currencyBalances.personal.<CURRENCY>), not the wealth-excluded campaign
    // `funds` account it used to target.
    const walletOps = nppBulkWriteCalls
      .flatMap(
        (call: unknown[]) =>
          call[0] as Array<{
            updateOne?: {
              filter?: { _id?: ObjectId };
              update?: { $inc?: Record<string, number> };
            };
          }>
      )
      .filter((op) =>
        Object.keys(op.updateOne?.update?.$inc ?? {}).some((key) =>
          key.startsWith("currencyBalances.personal.")
        )
      );
    expect(walletOps.length).toBeGreaterThan(0);
    expect(walletOps.some((op) => op.updateOne?.filter?._id?.toString() === nppId.toString())).toBe(
      true
    );
  });

  it("does not charge corporate tax when corporation has no profit", async () => {
    const corpId = new ObjectId();
    const corp = {
      _id: corpId,
      name: "LossCorp",
      type: "technology",
      headquartersState: "US_CA",
      liquidCapital: 1_000_000,
      marketingBudget: 100_000, // High marketing cost to create loss
      logisticsBudget: 50_000,
      marketingStrength: 0,
      logisticsStrength: 0,
      totalShares: 10_000_000,
      sharePrice: 1.0,
      ceoId: new ObjectId(),
      userId: new ObjectId(),
      dividendRate: 0,
      shareholders: [],
    };
    const sector = {
      _id: new ObjectId(),
      corporationId: corpId,
      countryId: "US",
      stateId: "US_CA",
      sectorType: "technology",
      revenue: 1_000, // Very low revenue
      profitMargin: 10,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
      currentGrowthCost: 0,
      updatedAt: new Date(),
    };
    const federalBudget = {
      _id: "federal",
      countryId: "US",
      gdp: 27_000_000_000_000,
      taxBases: {
        taxableIncome: 9_000_000_000_000,
        domesticCorporateProfits: 2_160_000_000_000 * 0.75,
        foreignCorporateProfits: 2_160_000_000_000 * 0.25,
        wagesAndSalaries: 8_000_000_000_000,
        importValue: 3_000_000_000_000,
        taxableSales: 12_000_000_000_000,
      },
      taxRates: {
        incomeTax: 22,
        domesticCorporateTax: 21,
        foreignCorporateTax: 21,
        payrollTax: 15.3,
        tariffs: 3,
      },
      economicFactors: { inflationRate: 2.5 },
      debtToGdpRatio: 0.9,
      surplus: -1_000_000_000,
      debt: { principal: 0, interestRate: 0 },
      revenue: {
        incomeTax: 0,
        domesticCorporateTax: 0,
        foreignCorporateTax: 0,
        payrollTax: 0,
        tariffs: 0,
        salesTax: 0,
        healthcareIncome: 0,
        other: 0,
        total: 0,
      },
      spending: { total: 0 },
    };

    db.collectionMocks["corporations"]!.find.mockReturnValue(makeCursor([corp]));
    db.collectionMocks["corporateSectors"]!.find.mockReturnValue(makeCursor([sector]));
    db.collectionMocks["federalBudget"]!.find.mockReturnValue(makeCursor([federalBudget]));
    db.collectionMocks["stateBudgets"]!.find.mockReturnValue(makeCursor([]));

    const { processCorporationTurn } = await import("./corporationTurn");
    const result = await processCorporationTurn(1);

    // Corp should be processed but with negative/zero income (no tax on losses)
    expect(result.corporationsProcessed).toBe(1);
    expect(result.totalIncomeGenerated).toBeLessThanOrEqual(0);
  });
});
