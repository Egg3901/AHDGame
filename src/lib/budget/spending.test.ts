import type { Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import type { FederalBudget } from "@/lib/db/types/budget";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  calculateFederalSpending,
  normalizeFederalSpending,
  normalizeStateSpending,
  SECTOR_SUBSIDIES_SPENDING_KEY,
} from "./spending";
import { getGdpIndexedCostScale } from "./costs";

describe("normalizeFederalSpending", () => {
  it("returns a safe zeroed structure when spending is missing", () => {
    expect(normalizeFederalSpending(undefined)).toEqual({
      byCategory: { [SECTOR_SUBSIDIES_SPENDING_KEY]: 0 },
      stateGrants: 0,
      debtInterest: 0,
      total: 0,
    });
  });

  it("preserves totals while ensuring the subsidy key exists", () => {
    expect(
      normalizeFederalSpending({
        byCategory: { defense: 10 },
        stateGrants: 2,
        debtInterest: 3,
        total: 0,
      })
    ).toEqual({
      byCategory: { defense: 10, [SECTOR_SUBSIDIES_SPENDING_KEY]: 0 },
      stateGrants: 2,
      debtInterest: 3,
      total: 15,
    });
  });
});

describe("normalizeStateSpending", () => {
  it("returns a safe zeroed structure when spending is missing", () => {
    expect(normalizeStateSpending(undefined)).toEqual({
      byCategory: { [SECTOR_SUBSIDIES_SPENDING_KEY]: 0 },
      resourceProspecting: 0,
      total: 0,
    });
  });

  it("preserves categories while ensuring the subsidy key exists", () => {
    expect(
      normalizeStateSpending({
        byCategory: { education: 7 },
        total: 0,
      })
    ).toEqual({
      byCategory: { education: 7, [SECTOR_SUBSIDIES_SPENDING_KEY]: 0 },
      resourceProspecting: 0,
      total: 7,
    });
  });

  it("preserves and folds the persistent state-prospecting spend line", () => {
    expect(
      normalizeStateSpending({
        byCategory: { education: 7 },
        resourceProspecting: 500_000,
        total: 0,
      })
    ).toEqual({
      byCategory: { education: 7, [SECTOR_SUBSIDIES_SPENDING_KEY]: 0 },
      resourceProspecting: 500_000,
      total: 500_007,
    });
  });
});

describe("calculateFederalSpending", () => {
  function mockBudget(overrides: Partial<FederalBudget> = {}): FederalBudget {
    return {
      _id: "CN",
      countryId: "CN",
      fiscalYear: 1991,
      revenue: { total: 1_000, other: 1_000 },
      taxRates: {},
      taxBases: {},
      economicFactors: {
        gdpGrowth: 0,
        wageGrowth: 0,
        inflationRate: 0,
        tradeGrowth: 0,
        lastUpdated: new Date(),
      },
      spending: { byCategory: {}, stateGrants: 0, debtInterest: 0, total: 0 },
      debt: { principal: 0, interestRate: 0, ceiling: 0, ceilingLastRaisedYear: 1991 },
      surplus: 0,
      gdp: 1_000_000,
      debtToGdpRatio: 0,
      creditRating: "BBB",
      baselineSpendingByCategory: { health: 100, education: 50 },
      baselineStateGrants: 25,
      ...overrides,
    } as FederalBudget;
  }

  it("falls back to seeded baselines when only zero-cost tax laws exist", async () => {
    const db = createMockDb();
    db.collection("enactedLaws").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          legislationTypeId: "cn_enterprise_income_tax",
          countryId: "CN",
          scope: "national",
          budgetCategory: "tax",
          budgetCost: 0,
          rate: 38,
        },
      ]),
    });
    db.collection("states").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "HB", countryId: "CN", population: 1000 }]),
    });

    const spending = await calculateFederalSpending(db as unknown as Db, mockBudget(), 10);

    expect(spending).toEqual({
      byCategory: { health: 100, education: 50, [SECTOR_SUBSIDIES_SPENDING_KEY]: 0 },
      stateGrants: 25,
      debtInterest: 10,
      total: 185,
    });
  });

  it("uses enacted spending laws when a nonzero cost exists", async () => {
    const db = createMockDb();
    db.collection("enactedLaws").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          legislationTypeId: "cn_enterprise_income_tax",
          countryId: "CN",
          scope: "national",
          budgetCategory: "tax",
          budgetCost: 0,
          rate: 38,
        },
        {
          legislationTypeId: "cn_medical_insurance",
          countryId: "CN",
          scope: "national",
          budgetCategory: "health",
          budgetCost: 0,
          annualCostUsd: 200,
        },
      ]),
    });
    db.collection("states").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "HB", countryId: "CN", population: 1000 }]),
    });

    const spending = await calculateFederalSpending(db as unknown as Db, mockBudget(), 10);

    // CN GDP-per-capita here = gdp 1_000_000 / pop 1000 = 1000, below CN's 1991
    // anchor (~1881), so the cost-scale ramp extrapolates below scaleLow 0.02
    // (F-03: proportional-to-gpc, no longer clamped): 200 × 0.02 × 1000/1880.8.
    const health = 200 * getGdpIndexedCostScale("CN", 1000);
    expect(spending).toEqual({
      byCategory: { health, [SECTOR_SUBSIDIES_SPENDING_KEY]: 0 },
      stateGrants: 0,
      debtInterest: 10,
      total: 10 + health,
    });
  });

  it("books CN config-derived central transfer grants as national stateGrants", async () => {
    const db = createMockDb();
    // One enacted national spending law keeps byCategory non-empty so the
    // baseline fallback does not fire; stateGrants starts at 0 (CN has no
    // isGrant funding law) and the transfer pool must be added on top.
    db.collection("enactedLaws").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          legislationTypeId: "cn_medical_insurance",
          countryId: "CN",
          scope: "national",
          budgetCategory: "health",
          budgetCost: 0,
          annualCostUsd: 200,
        },
      ]),
    });
    db.collection("states").find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: "cn_huadong", countryId: "CN", population: 1000 }]),
    });
    // The actual per-region grants the regional processor distributed.
    db.collection("regionalBudgets").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "cn_huadong", countryId: "CN", centralTransferGrant: 1000 },
        { _id: "cn_xibei", countryId: "CN", centralTransferGrant: 1000 },
      ]),
    });

    const spending = await calculateFederalSpending(db as unknown as Db, mockBudget(), 10);

    // health = 200 × scale(gpc 1000) — extrapolated below the CN 1991 anchor (F-03).
    const health = 200 * getGdpIndexedCostScale("CN", 1000);
    expect(spending).toEqual({
      byCategory: { health, [SECTOR_SUBSIDIES_SPENDING_KEY]: 0 },
      stateGrants: 2000,
      debtInterest: 10,
      total: 2010 + health,
    });
  });

  it("books the UK Westminster grant the regions received as national stateGrants", async () => {
    // UK used to route its regional grant through an isGrant funding law
    // (uk_local_government_funding). The political-legislation v2 catalog has
    // no such law, so the grant is now a config-derived transfer pool exactly
    // like CN/DE — and unless it is booked here, regions spend money the
    // national budget never records paying.
    const db = createMockDb();
    db.collection("enactedLaws").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          legislationTypeId: "uk.health.prevention.primary",
          countryId: "UK",
          scope: "national",
          budgetCategory: "health",
          budgetCost: 0,
          annualCostUsd: 200,
        },
      ]),
    });
    db.collection("states").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "LON", countryId: "UK", population: 600 },
        { _id: "SCO", countryId: "UK", population: 400 },
      ]),
    });
    db.collection("regionalBudgets").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "LON", countryId: "UK", westminsterGrant: 150 },
        { _id: "SCO", countryId: "UK", westminsterGrant: 100 },
      ]),
    });

    const spending = await calculateFederalSpending(
      db as unknown as Db,
      mockBudget({ _id: "UK", countryId: "UK" }),
      10
    );

    expect(spending.stateGrants).toBe(250);
  });

  it("books only the drawn-down grant for a planned economy, and the full grant for a market one", async () => {
    // Plan-economy allocations LAPSE: the centre books what a republic actually
    // draws down, not the whole allocation. Live RU distributes ₽44.00B and its
    // republics spend ₽24.34B — the ₽19.66B remainder is banked into a regional
    // surplus that is never accumulated anywhere, so booking it as national
    // spending charges the union for programmes that do not exist. A market
    // economy's transfer is genuinely disbursed, so it still books in full.
    async function stateGrantsFor(countryId: "RU" | "UK", regions: unknown[]) {
      const db = createMockDb();
      // The lapse gate reads the command-economy flag and the world year.
      db.collection("gameConfig").findOne.mockResolvedValue({
        _id: "default",
        commandEconomyEnabled: true,
      });
      db.collection("gameState").findOne.mockResolvedValue({
        _id: "current",
        preset: "1953-default",
        currentYear: 1957,
        currentTurn: 274,
        startingYear: 1953,
        eraSystemEnabled: true,
      });
      db.collection("enactedLaws").find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            legislationTypeId: "x.health",
            countryId,
            scope: "national",
            budgetCategory: "health",
            budgetCost: 0,
            annualCostUsd: 200,
          },
        ]),
      });
      db.collection("states").find.mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue(
            (regions as { _id: string }[]).map((r) => ({ _id: r._id, countryId }))
          ),
      });
      db.collection("regionalBudgets").find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue(regions),
      });
      const spending = await calculateFederalSpending(
        db as unknown as Db,
        // baselineStateGrants 0 so the empty-byCategory fallback contributes
        // nothing and the assertion isolates the transfer arithmetic.
        mockBudget({ _id: countryId, countryId, baselineStateGrants: 0 }),
        10
      );
      return spending.stateGrants;
    }

    // RU (planned in 1957): one republic underspends its grant, one overspends.
    expect(
      await stateGrantsFor("RU", [
        { _id: "FEA", countryId: "RU", unionGrant: 1000, enactedBillCosts: 400 },
        { _id: "CEN", countryId: "RU", unionGrant: 1000, enactedBillCosts: 1800 },
      ])
    ).toBe(1400); // 400 drawn down + 1000 capped at the allocation

    // UK (market): the transfer is disbursed whether the region spends it or not.
    expect(
      await stateGrantsFor("UK", [
        { _id: "LON", countryId: "UK", westminsterGrant: 1000, enactedBillCosts: 400 },
        { _id: "SCO", countryId: "UK", westminsterGrant: 1000, enactedBillCosts: 1800 },
      ])
    ).toBe(2000);
  });
});
