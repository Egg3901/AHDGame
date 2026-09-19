import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { resetCorpFxRateCacheForTests } from "@/lib/currency/corporationCapital";

describe("sectorRevenueTaxProvider", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    resetCorpFxRateCacheForTests();
    db = createMockDb();
  });

  // Instantiate the collection lazily (MockDb caches it) then stub find().
  function setupCollection<T>(name: string, data: T[]) {
    db.collection(name);
    db.collectionMocks[name]!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(data) }),
      toArray: vi.fn().mockResolvedValue(data),
    });
  }

  it("produces per-state owned/unowned sector lists and tax rates", async () => {
    setupCollection("corporateSectors", [
      { _id: "sec1", stateId: "s1", revenue: 100, currentGrowthRate: 2, corporationId: undefined },
    ]);
    setupCollection("unownedSectors", [{ _id: "u1", stateId: "s1", revenue: 50 }]);
    setupCollection("federalBudget", [
      { _id: "federal", countryId: "US", taxRates: { salesTax: 7 } },
    ]);
    setupCollection("stateBudgets", [{ _id: "s1", taxRates: { salesTax: 6 } }]);

    const { sectorRevenueTaxProvider } = await import("./providers");
    const out = await sectorRevenueTaxProvider(db as unknown as Db);

    expect(out.ownedByState.get("s1")).toEqual([
      { revenue: 100, currentGrowthRate: 2, hostRevenue: 100 },
    ]);
    expect(out.unownedByState.get("s1")).toEqual([{ revenue: 50 }]);
    expect(out.federalSalesTaxByCountry.get("US")).toBe(7);
    expect(out.stateSalesTaxByState.get("s1")).toBe(6);
  });

  it("reports plantsEnabled from marketSystemMode (P2/D7)", async () => {
    setupCollection("corporateSectors", []);
    setupCollection("unownedSectors", []);
    setupCollection("federalBudget", []);
    setupCollection("stateBudgets", []);
    db.collection("gameConfig");
    db.collectionMocks.gameConfig!.findOne = vi
      .fn()
      .mockResolvedValue({ _id: "default", marketSystemMode: "plants" });

    const { sectorRevenueTaxProvider } = await import("./providers");
    expect((await sectorRevenueTaxProvider(db as unknown as Db)).plantsEnabled).toBe(true);
  });

  it("reports plantsEnabled false below the plants tier and with no config", async () => {
    setupCollection("corporateSectors", []);
    setupCollection("unownedSectors", []);
    setupCollection("federalBudget", []);
    setupCollection("stateBudgets", []);
    const { sectorRevenueTaxProvider } = await import("./providers");
    // MockDb default findOne → null (unseeded world) ⇒ mode "off"
    expect((await sectorRevenueTaxProvider(db as unknown as Db)).plantsEnabled).toBe(false);

    db.collection("gameConfig");
    db.collectionMocks.gameConfig!.findOne = vi
      .fn()
      .mockResolvedValue({ _id: "default", marketSystemMode: "capital" });
    expect((await sectorRevenueTaxProvider(db as unknown as Db)).plantsEnabled).toBe(false);
  });

  it("uses the legacy growthRate fallback when currentGrowthRate is absent", async () => {
    setupCollection("corporateSectors", [
      { _id: "sec1", stateId: "s1", revenue: 100, growthRate: 3, corporationId: undefined },
    ]);
    setupCollection("unownedSectors", []);
    setupCollection("federalBudget", []);
    setupCollection("stateBudgets", []);

    const { sectorRevenueTaxProvider } = await import("./providers");
    const out = await sectorRevenueTaxProvider(db as unknown as Db);
    expect(out.ownedByState.get("s1")).toEqual([
      { revenue: 100, currentGrowthRate: 3, hostRevenue: 100 },
    ]);
  });

  it("carries sectorType on owned and unowned rows (P3c — environment mix)", async () => {
    setupCollection("corporateSectors", [
      {
        _id: "sec1",
        stateId: "s1",
        revenue: 100,
        currentGrowthRate: 2,
        corporationId: undefined,
        sectorType: "energy",
      },
    ]);
    setupCollection("unownedSectors", [
      { _id: "u1", stateId: "s1", revenue: 50, sectorType: "agriculture" },
    ]);
    setupCollection("federalBudget", []);
    setupCollection("stateBudgets", []);

    const { sectorRevenueTaxProvider } = await import("./providers");
    const out = await sectorRevenueTaxProvider(db as unknown as Db);

    expect(out.ownedByState.get("s1")![0]!.sectorType).toBe("energy");
    expect(out.unownedByState.get("s1")![0]!.sectorType).toBe("agriculture");
  });

  it("converts sector revenue with the HOST FX rate, not the owning corp's (ticket #1084)", async () => {
    // UK-hosted sector owned by a USD corp: fields are GBP. Corp FX (USD=1)
    // would leave 800 as 800 ₳; host FX (GBP 0.8) correctly yields 1000 ₳.
    setupCollection("corporateSectors", [
      {
        _id: "sec1",
        stateId: "LON",
        countryId: "UK",
        revenue: 800,
        realizedRevenue: 800,
        currentGrowthRate: 2,
        corporationId: "corpUSD",
      },
    ]);
    setupCollection("unownedSectors", []);
    setupCollection("corporations", [
      { _id: "corpUSD", countryId: "US", liquidCurrencyCode: "USD" },
    ]);
    setupCollection("exchangeRates", [
      { currencyCode: "GBP", rate: 0.8 },
      { currencyCode: "USD", rate: 1 },
    ]);
    setupCollection("federalBudget", []);
    setupCollection("stateBudgets", []);

    const { sectorRevenueTaxProvider } = await import("./providers");
    const row = (await sectorRevenueTaxProvider(db as unknown as Db)).ownedByState.get("LON")![0]!;
    expect(row.hostRevenue).toBe(800);
    expect(row.hostRealizedRevenue).toBe(800);
    expect(row.revenue).toBe(1000);
    expect(row.realizedRevenue).toBe(1000);
  });

  it("uses the authored host rate when a country has no live forex row", async () => {
    setupCollection("corporateSectors", [
      {
        _id: "sec-pl",
        stateId: "PL-WAW",
        countryId: "PL",
        revenue: 2400,
        realizedRevenue: 1200,
        currentGrowthRate: 2,
        corporationId: "corpPL",
      },
    ]);
    setupCollection("unownedSectors", []);
    setupCollection("corporations", [
      { _id: "corpPL", countryId: "PL", liquidCurrencyCode: "PLZ" },
    ]);
    // Deliberately no PLZ row. Poland is budget-only in the 1953 forex model.
    setupCollection("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
    db.collection("gameState");
    db.collectionMocks.gameState!.findOne = vi
      .fn()
      .mockResolvedValue({ _id: "current", preset: "1953-default" });
    setupCollection("federalBudget", []);
    setupCollection("stateBudgets", []);

    const { sectorRevenueTaxProvider } = await import("./providers");
    const row = (await sectorRevenueTaxProvider(db as unknown as Db)).ownedByState.get(
      "PL-WAW"
    )![0]!;

    expect(row.hostRevenue).toBe(2400);
    expect(row.hostRealizedRevenue).toBe(1200);
    expect(row.revenue).toBe(100);
    expect(row.realizedRevenue).toBe(50);
  });

  it("governmentApprovalProvider maps countryId → approvalRating (P4)", async () => {
    setupCollection("governmentApprovals", [
      { _id: "US", countryId: "US", approvalRating: 52 },
      { _id: "UK", countryId: "UK", approvalRating: 38 },
    ]);
    const { governmentApprovalProvider } = await import("./providers");
    const out = await governmentApprovalProvider(db as unknown as Db);
    expect(out.get("US")).toBe(52);
    expect(out.get("UK")).toBe(38);
    expect(out.has("DE")).toBe(false); // missing → absent (phase falls back to neutral)
  });

  it("returns empty maps when no data", async () => {
    setupCollection("corporateSectors", []);
    setupCollection("unownedSectors", []);
    setupCollection("federalBudget", []);
    setupCollection("stateBudgets", []);

    const { sectorRevenueTaxProvider } = await import("./providers");
    const out = await sectorRevenueTaxProvider(db as unknown as Db);
    expect(out.ownedByState.size).toBe(0);
    expect(out.unownedByState.size).toBe(0);
  });

  it("fiscalRatiosProvider computes clamped per-country ratios from federalBudget", async () => {
    setupCollection("federalBudget", [
      {
        _id: "federal",
        countryId: "US",
        treasuryBalance: -1000,
        gdp: 2000,
        gdpSmoothed: 2000,
        debt: { ceiling: 5000 },
        revenue: { total: 400 },
        spending: { total: 460 },
      },
      {
        _id: "DE",
        countryId: "DE",
        treasuryBalance: 50,
        gdp: 1000,
        gdpSmoothed: 1000,
        debt: { ceiling: 5000 },
        revenue: { total: 300 },
        spending: { total: 303 },
      },
    ]);
    const { fiscalRatiosProvider } = await import("./providers");
    const out = await fiscalRatiosProvider(db as unknown as Db);

    const us = out.get("US")!;
    expect(us.debtToGdp).toBe(50); // debt 1000 / gdp 2000
    expect(us.budgetBalance).toBeCloseTo(-3, 6); // (400-460)/2000
    expect(us.schuldenbremseHeadroom).toBe(-1); // 0.35 - 3% deficit = -2.65 → clamp -1

    const de = out.get("DE")!;
    expect(de.debtToGdp).toBe(0); // surplus → no debt
    expect(de.budgetBalance).toBeCloseTo(-0.3, 6); // (300-303)/1000
    expect(de.schuldenbremseHeadroom).toBeCloseTo(0.05, 6); // 0.35 - 0.3
  });

  it("fiscalRatiosProvider yields zero ratios when gdp is zero (no divide-by-zero)", async () => {
    setupCollection("federalBudget", [
      {
        _id: "federal",
        countryId: "US",
        treasuryBalance: -10,
        gdp: 0,
        debt: { ceiling: 0 },
        revenue: { total: 1 },
        spending: { total: 2 },
      },
    ]);
    const { fiscalRatiosProvider } = await import("./providers");
    const out = await fiscalRatiosProvider(db as unknown as Db);
    expect(out.get("US")).toEqual({ debtToGdp: 0, budgetBalance: 0, schuldenbremseHeadroom: 0.35 });
  });

  it("fiscalTradeInputsProvider aggregates tariff/foreign-tax/forex/FTA/bloc per country", async () => {
    setupCollection("federalBudget", [
      {
        _id: "federal",
        countryId: "US",
        taxRates: { tariffs: 5, foreignCorporateTax: 20 },
        economicFactors: { inflationRate: 3 },
      },
      { _id: "DE", countryId: "DE", taxRates: { tariffs: 2, foreignCorporateTax: 15 } },
    ]);
    setupCollection("exchangeRates", [
      { _id: "US", countryId: "US", rate: 1, baseRate: 1 },
      { _id: "DE", countryId: "DE", rate: 1.2, baseRate: 1 }, // weakened 20%
    ]);
    setupCollection("organizationLegislation", [
      { type: "free_trade_agreement", status: "active", parties: ["US", "DE"] },
    ]);
    setupCollection("organizationMemberships", [
      { countryId: "DE", organizationId: "EU", status: "active" },
    ]);

    const { fiscalTradeInputsProvider } = await import("./providers");
    const out = await fiscalTradeInputsProvider(db as unknown as Db);

    expect(out.get("US")).toEqual({
      tariff: 5,
      foreignCorporateTax: 20,
      forexStrength: 0,
      ftaPartnerCount: 1,
      blocMember: false,
      inflationRate: 3, // from economicFactors (lagged)
    });
    const de = out.get("DE")!;
    expect(de.ftaPartnerCount).toBe(1); // both sides of the US|DE pair
    expect(de.blocMember).toBe(true); // EU member
    expect(de.forexStrength).toBeCloseTo(0.2, 6); // rate 1.2 / base 1 − 1 (weaker = more competitive)
    expect(de.inflationRate).toBe(2); // no economicFactors → default 2%
  });
});
