import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { spendingProvider, US_REFERENCE_GDP_PER_CAPITA } from "./spendingProvider";

describe("spendingProvider", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    ["states", "federalBudget", "stateBudgets"].forEach((c) => db.collection(c));
  });

  function seed() {
    db.collectionMocks.states!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: async () => [
        { _id: "CA", countryId: "US", population: 39_000_000 },
        { _id: "TX", countryId: "US", population: 31_000_000 },
      ],
    });
    db.collectionMocks.federalBudget!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: async () => [
        {
          _id: "federal",
          countryId: "US",
          spending: { byCategory: { education: 70_000_000, defense: 140_000_000 } },
        },
      ],
    });
    db.collectionMocks.stateBudgets!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: async () => [
        { _id: "CA", countryId: "US", spending: { byCategory: { education: 39_000_000 } } },
      ],
    });
  }

  it("sums federal-per-capita + state-per-capita per region/category", async () => {
    seed();
    const out = await spendingProvider(db as unknown as Db);
    // US pop = 70M; federal education 70M → $1/head nationally.
    // CA: 1 (federal) + 39M/39M = 1 (state) = 2.
    expect(out.perCapitaByRegion.get("CA")?.education).toBeCloseTo(2, 6);
    // P5: the defense channel — federal 140M / 70M country pop = 2 per capita.
    expect(out.perCapitaByRegion.get("CA")?.defense).toBeCloseTo(2, 6);
    // TX: 1 (federal) + 0 (no state budget) = 1.
    expect(out.perCapitaByRegion.get("TX")?.education).toBeCloseTo(1, 6);
  });

  it("the social channel SUMS the social/welfare/socialSecurity byCategory keys (P3a)", async () => {
    db.collectionMocks.states!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: async () => [{ _id: "CA", countryId: "US", population: 10_000_000 }],
    });
    db.collectionMocks.federalBudget!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: async () => [
        {
          _id: "federal",
          countryId: "US",
          spending: {
            byCategory: {
              social: 10_000_000,
              welfare: 20_000_000,
              socialSecurity: 30_000_000,
              environment: 5_000_000,
            },
          },
        },
      ],
    });
    db.collectionMocks.stateBudgets!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: async () => [],
    });
    const out = await spendingProvider(db as unknown as Db);
    expect(out.perCapitaByRegion.get("CA")?.social).toBeCloseTo(6, 6); // (10+20+30)M / 10M
    expect(out.perCapitaByRegion.get("CA")?.environment).toBeCloseTo(0.5, 6);
  });

  it("folds UK transport aliases into infrastructure and exposes budget-backed public capital", async () => {
    db.collectionMocks.states!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: async () => [{ _id: "LON", countryId: "UK", population: 10_000_000 }],
    });
    db.collectionMocks.federalBudget!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: async () => [
        {
          _id: "UK",
          countryId: "UK",
          gdp: 120_000_000_000,
          spending: { byCategory: { transport: 1_000_000_000 } },
        },
      ],
    });
    db.collectionMocks.stateBudgets!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: async () => [],
    });

    const out = await spendingProvider(db as unknown as Db);
    expect(out.perCapitaByRegion.get("LON")?.infrastructure).toBeGreaterThan(0);
    expect(out.publicCapitalAnnualLocalMillionsByRegion.get("LON")).toBeCloseTo(1_000, 6);
  });

  it("normalizes per-capita spend by country GDP/capita onto the US reference scale (#0887 RC2)", async () => {
    db.collectionMocks.states!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: async () => [
        { _id: "CA", countryId: "US", population: 10_000_000 },
        { _id: "LON", countryId: "UK", population: 10_000_000 },
      ],
    });
    db.collectionMocks.federalBudget!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: async () => [
        {
          _id: "federal",
          countryId: "US",
          // US GDP/capita exactly at the reference → factor 1 (no change).
          gdp: 10_000_000 * US_REFERENCE_GDP_PER_CAPITA,
          spending: { byCategory: { publicSafety: 100 * 10_000_000 } },
        },
        {
          _id: "UK",
          countryId: "UK",
          // UK GDP/capita = half the reference → same LOCAL per-capita spend is
          // twice the fiscal effort → doubled on the US-reference scale.
          gdp: 10_000_000 * (US_REFERENCE_GDP_PER_CAPITA / 2),
          spending: { byCategory: { publicSafety: 100 * 10_000_000 } },
        },
      ],
    });
    db.collectionMocks.stateBudgets!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: async () => [],
    });
    const out = await spendingProvider(db as unknown as Db);
    expect(out.perCapitaByRegion.get("CA")?.publicSafety).toBeCloseTo(100, 6);
    expect(out.perCapitaByRegion.get("LON")?.publicSafety).toBeCloseTo(200, 6);
  });

  it("skips normalization when a country has no usable GDP (factor 1)", async () => {
    db.collectionMocks.states!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: async () => [{ _id: "LEN", countryId: "IE", population: 2_000_000 }],
    });
    db.collectionMocks.federalBudget!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: async () => [
        {
          _id: "IE",
          countryId: "IE",
          // gdp missing → normalization must not divide by 0/undefined
          spending: { byCategory: { education: 50 * 2_000_000 } },
        },
      ],
    });
    db.collectionMocks.stateBudgets!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: async () => [],
    });
    const out = await spendingProvider(db as unknown as Db);
    expect(out.perCapitaByRegion.get("LEN")?.education).toBeCloseTo(50, 6);
  });

  it("is safe on zero/missing population and empty budgets", async () => {
    db.collectionMocks.states!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: async () => [{ _id: "ZZ", countryId: "US", population: 0 }],
    });
    db.collectionMocks.federalBudget!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: async () => [],
    });
    db.collectionMocks.stateBudgets!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: async () => [],
    });
    const out = await spendingProvider(db as unknown as Db);
    expect(out.perCapitaByRegion.get("ZZ")?.education ?? 0).toBe(0);
  });
});
