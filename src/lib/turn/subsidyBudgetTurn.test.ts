import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { SUBSIDY_COST_MULTIPLIER, processSubsidyBudget } from "./subsidyBudgetTurn";
import { resetCorpFxRateCacheForTests } from "@/lib/currency/corporationCapital";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type {
  Subsidy,
  Corporation,
  CorporateSector,
  FederalBudget,
  StateBudget,
} from "@/lib/db/types";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const corpId = new ObjectId();
const billId = new ObjectId();

function makeSubsidy(overrides: Partial<Subsidy>): Subsidy {
  return {
    _id: new ObjectId(),
    countryId: "US",
    scope: "national",
    stateId: undefined,
    scopeType: "economy_wide",
    targetSectorType: undefined,
    targetStrategyId: undefined,
    domesticOnly: false,
    active: true,
    sourceBillId: billId,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Subsidy;
}

function makeCorp(overrides: Partial<Corporation>): Corporation {
  return {
    _id: corpId,
    countryId: "US",
    headquartersState: "CA",
    ...overrides,
  } as Corporation;
}

function makeSector(overrides: Partial<CorporateSector>): CorporateSector {
  return {
    _id: new ObjectId(),
    corporationId: corpId,
    countryId: "US",
    stateId: "CA",
    sectorType: "technology",
    revenue: 1_000_000,
    profitMargin: 20,
    growthRate: 0,
    currentGrowthCost: 0,
    workers: 100,
    strategyId: undefined,
    ...overrides,
  } as CorporateSector;
}

function makeFederalBudget(overrides: Partial<FederalBudget> = {}): FederalBudget {
  return {
    _id: "federal",
    countryId: "US",
    revenue: { total: 5_000_000_000 },
    surplus: 4_997_250_000,
    spending: {
      byCategory: { other: 2_000_000 },
      stateGrants: 500_000,
      debtInterest: 250_000,
      total: 2_750_000,
    },
    ...overrides,
  } as FederalBudget;
}

function makeStateBudget(overrides: Partial<StateBudget> = {}): StateBudget {
  return {
    _id: "CA",
    stateId: "CA",
    revenue: { total: 3_000_000 },
    balance: 2_000_000,
    surplus: 2_000_000,
    spending: {
      byCategory: { education: 1_000_000 },
      total: 1_000_000,
    },
    ...overrides,
  } as StateBudget;
}

/** Set up all three collections so collectionMocks are accessible. */
function setupCollections(
  db: MockDb,
  subsidies: Subsidy[],
  corps: Corporation[],
  sectors: CorporateSector[],
  federalBudgets: FederalBudget[] = [makeFederalBudget()],
  stateBudgets: StateBudget[] = [makeStateBudget()]
) {
  // Access via db.collection() to trigger lazy creation
  const subsidiesColl = db.collection("subsidies") as ReturnType<typeof db.collection>;
  (subsidiesColl.find as ReturnType<typeof vi.fn>).mockReturnValue({
    toArray: vi.fn().mockResolvedValue(subsidies),
  });

  const corpsColl = db.collection("corporations") as ReturnType<typeof db.collection>;
  (corpsColl.find as ReturnType<typeof vi.fn>).mockReturnValue({
    toArray: vi.fn().mockResolvedValue(corps),
  });

  const sectorsColl = db.collection("corporateSectors") as ReturnType<typeof db.collection>;
  (sectorsColl.find as ReturnType<typeof vi.fn>).mockReturnValue({
    toArray: vi.fn().mockResolvedValue(sectors),
  });

  const federalBudgetsColl = db.collection("federalBudget") as ReturnType<typeof db.collection>;
  (federalBudgetsColl.find as ReturnType<typeof vi.fn>).mockReturnValue({
    toArray: vi.fn().mockResolvedValue(federalBudgets),
  });

  const stateBudgetsColl = db.collection("stateBudgets") as ReturnType<typeof db.collection>;
  (stateBudgetsColl.find as ReturnType<typeof vi.fn>).mockReturnValue({
    toArray: vi.fn().mockResolvedValue(stateBudgets),
  });
}

describe("SUBSIDY_COST_MULTIPLIER", () => {
  it("equals the margin benefit (7.5%) times the deadweight factor (1.4)", () => {
    expect(SUBSIDY_COST_MULTIPLIER).toBeCloseTo(0.105, 10);
  });
});

describe("processSubsidyBudget", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    // loadFxRatesByCurrency caches module-level; reset so each test's
    // exchangeRates mock (or lack of one) is what actually gets read.
    resetCorpFxRateCacheForTests();
  });

  it("returns 0 when no active subsidies", async () => {
    setupCollections(
      db,
      [],
      [],
      [],
      [
        makeFederalBudget({
          spending: {
            byCategory: { other: 2_000_000, sectorSubsidies: 0 },
            stateGrants: 500_000,
            debtInterest: 250_000,
            total: 2_750_000,
          },
        }),
      ],
      [
        makeStateBudget({
          spending: { byCategory: { education: 1_000_000, sectorSubsidies: 0 }, total: 1_000_000 },
        }),
      ]
    );

    const result = await processSubsidyBudget(db as unknown as Db);
    expect(result).toBe(0);
  });

  it("writes sectorSubsidies cost to federalBudget for national subsidy", async () => {
    const subsidy = makeSubsidy({ scope: "national", countryId: "US", scopeType: "economy_wide" });
    const corp = makeCorp({ _id: corpId, headquartersState: "CA" });
    const sector = makeSector({ corporationId: corpId, stateId: "CA", revenue: 1_000_000 });

    setupCollections(db, [subsidy], [corp], [sector], [makeFederalBudget()], []);

    const result = await processSubsidyBudget(db as unknown as Db);

    expect(result).toBe(1);
    const federalUpdateOne = db.collectionMocks["federalBudget"]!.updateOne;
    expect(federalUpdateOne).toHaveBeenCalledOnce();

    const [filter, update] = (federalUpdateOne as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(filter._id).toBe("federal");
    const expectedCost = 1_000_000 * TURNS_PER_YEAR * SUBSIDY_COST_MULTIPLIER;
    expect(update.$set.spending.byCategory.sectorSubsidies).toBe(expectedCost);
    expect(update.$set.spending.total).toBe(2_750_000 + expectedCost);
    expect(update.$set.surplus).toBe(5_000_000_000 - (2_750_000 + expectedCost));
  });

  it("writes sectorSubsidies cost to stateBudgets for state subsidy", async () => {
    const subsidy = makeSubsidy({
      scope: "state",
      stateId: "CA",
      countryId: "US",
      scopeType: "economy_wide",
    });
    const corp = makeCorp({ _id: corpId, headquartersState: "CA" });
    const sector = makeSector({ corporationId: corpId, stateId: "CA", revenue: 500_000 });

    setupCollections(db, [subsidy], [corp], [sector], [], [makeStateBudget()]);

    const result = await processSubsidyBudget(db as unknown as Db);

    expect(result).toBe(1);
    const stateUpdateOne = db.collectionMocks["stateBudgets"]!.updateOne;
    expect(stateUpdateOne).toHaveBeenCalledOnce();

    const [filter, update] = (stateUpdateOne as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(filter._id).toBe("CA");
    const expectedCost = 500_000 * TURNS_PER_YEAR * SUBSIDY_COST_MULTIPLIER;
    expect(update.$set.spending.byCategory.sectorSubsidies).toBe(expectedCost);
    expect(update.$set.spending.total).toBe(1_000_000 + expectedCost);
    expect(update.$set.surplus).toBe(3_000_000 - (1_000_000 + expectedCost));
    expect(update.$set.balance).toBe(3_000_000 - (1_000_000 + expectedCost));
  });

  it("skips subsidies with zero qualifying revenue", async () => {
    const subsidy = makeSubsidy({
      scope: "national",
      countryId: "US",
      scopeType: "sector",
      targetSectorType: "energy",
    });
    // Sector is technology, not energy
    const corp = makeCorp({ _id: corpId, headquartersState: "CA" });
    const sector = makeSector({
      corporationId: corpId,
      stateId: "CA",
      sectorType: "technology",
      revenue: 1_000_000,
    });

    setupCollections(
      db,
      [subsidy],
      [corp],
      [sector],
      [
        makeFederalBudget({
          spending: {
            byCategory: { other: 2_000_000, sectorSubsidies: 0 },
            stateGrants: 500_000,
            debtInterest: 250_000,
            total: 2_750_000,
          },
        }),
      ],
      [
        makeStateBudget({
          spending: { byCategory: { education: 1_000_000, sectorSubsidies: 0 }, total: 1_000_000 },
        }),
      ]
    );

    const result = await processSubsidyBudget(db as unknown as Db);
    expect(result).toBe(0);

    const federalUpdateOne = db.collectionMocks["federalBudget"]?.updateOne;
    if (federalUpdateOne) {
      expect(federalUpdateOne).not.toHaveBeenCalled();
    }
  });

  it("clears stale sectorSubsidies when no active subsidies remain", async () => {
    setupCollections(
      db,
      [],
      [],
      [],
      [
        makeFederalBudget({
          spending: {
            byCategory: { other: 2_000_000, sectorSubsidies: 300_000 },
            stateGrants: 500_000,
            debtInterest: 250_000,
            total: 3_050_000,
          },
        }),
      ],
      []
    );

    const result = await processSubsidyBudget(db as unknown as Db);
    expect(result).toBe(1);

    const federalUpdateOne = db.collectionMocks["federalBudget"]!.updateOne;
    expect(federalUpdateOne).toHaveBeenCalledOnce();
    const [, update] = (federalUpdateOne as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(update.$set.spending.byCategory.sectorSubsidies).toBe(0);
    expect(update.$set.spending.total).toBe(2_750_000);
    expect(update.$set.surplus).toBe(5_000_000_000 - 2_750_000);
  });

  it("uses the country budget id for non-US national subsidies", async () => {
    const subsidy = makeSubsidy({ scope: "national", countryId: "UK", scopeType: "economy_wide" });
    const corp = makeCorp({ _id: corpId, countryId: "UK", headquartersState: "ENG" });
    const sector = makeSector({
      corporationId: corpId,
      countryId: "UK",
      stateId: "ENG",
      revenue: 250_000,
    });
    const ukBudget = makeFederalBudget({
      _id: "UK",
      countryId: "UK",
      revenue: {
        incomeTax: 0,
        domesticCorporateTax: 0,
        foreignCorporateTax: 0,
        payrollTax: 0,
        tariffs: 0,
        salesTax: 0,
        healthcareIncome: 0,
        other: 0,
        total: 10_000_000,
      },
      surplus: 7_250_000,
    });

    setupCollections(db, [subsidy], [corp], [sector], [ukBudget], []);

    const result = await processSubsidyBudget(db as unknown as Db);

    expect(result).toBe(1);
    const federalUpdateOne = db.collectionMocks["federalBudget"]!.updateOne;
    const [filter, update] = (federalUpdateOne as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(filter._id).toBe("UK");
    const expectedCost = 250_000 * TURNS_PER_YEAR * SUBSIDY_COST_MULTIPLIER;
    expect(update.$set.spending.byCategory.sectorSubsidies).toBe(expectedCost);
    expect(update.$set.surplus).toBe(10_000_000 - (2_750_000 + expectedCost));
  });

  // Regression test for #2825: budget spending fields are country-currency
  // (v0.2.6), so the ₳ subsidy cost must be re-denominated to the granting
  // country's currency. A USD corp's UK sector yields a ₳ cost that must land
  // in the UK budget at the GBP rate — a raw ₳ write (old behavior) would
  // book 1/0.8 of the true GBP cost.
  it("re-denominates the subsidy cost into the granting country's currency", async () => {
    const subsidy = makeSubsidy({ scope: "national", countryId: "UK", scopeType: "economy_wide" });
    const corp = makeCorp({
      _id: corpId,
      countryId: "US",
      headquartersState: "CA",
      liquidCurrencyCode: "USD",
    });
    const sector = makeSector({
      corporationId: corpId,
      countryId: "UK",
      stateId: "ENG",
      revenue: 250_000, // USD (corp home currency)
    });
    const ukBudget = makeFederalBudget({
      _id: "UK",
      countryId: "UK",
      revenue: { total: 10_000_000 } as FederalBudget["revenue"],
      surplus: 7_250_000,
    });

    setupCollections(db, [subsidy], [corp], [sector], [ukBudget], []);
    const ratesColl = db.collection("exchangeRates") as ReturnType<typeof db.collection>;
    (ratesColl.find as ReturnType<typeof vi.fn>).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { currencyCode: "USD", rate: 1 },
        { currencyCode: "GBP", rate: 0.8 },
      ]),
    });

    const result = await processSubsidyBudget(db as unknown as Db);

    expect(result).toBe(1);
    const federalUpdateOne = db.collectionMocks["federalBudget"]!.updateOne;
    const [filter, update] = (federalUpdateOne as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(filter._id).toBe("UK");
    // 250k USD revenue → 250k ₳ (USD rate 1) → annualized ₳ cost → ×0.8 GBP.
    const expectedCost = 250_000 * TURNS_PER_YEAR * SUBSIDY_COST_MULTIPLIER * 0.8;
    expect(update.$set.spending.byCategory.sectorSubsidies).toBeCloseTo(expectedCost, 6);
  });
});
