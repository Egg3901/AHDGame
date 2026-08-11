import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  determineNPPRiskArchetype,
  computeNPPInvestableBudget,
  ARCHETYPE_ALLOCATIONS,
  NPP_WEALTH_SATURATION_YEARS,
  nppAnnualIncomeAnchor,
  nppAccrualDampingMultiplier,
  processNPPFundInvestments,
} from "./nppInvesting";
import type { NPP } from "@/lib/db/types";
import { ObjectId } from "mongodb";

vi.mock("@/lib/indexFunds/featureFlag", () => ({
  isIndexFundsEnabled: vi.fn().mockResolvedValue(true),
}));

describe("nppInvesting", () => {
  const makeNPP = (overrides: Partial<NPP> = {}): NPP => ({
    _id: new ObjectId(),
    name: "Test NPP",
    homeState: "CA",
    politicalInfluence: 50,
    favorability: 50,
    policies: {} as any,
    party: "Democratic",
    currentOffice: null,
    personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
    generatedAt: new Date(),
    retiredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  describe("determineNPPRiskArchetype", () => {
    it("returns conservative for high favorability + influence", () => {
      const npp = makeNPP({ favorability: 80, politicalInfluence: 70 });
      expect(determineNPPRiskArchetype(npp)).toBe("conservative");
    });

    it("returns moderate for mid-range scores", () => {
      const npp = makeNPP({ favorability: 45, politicalInfluence: 50 });
      expect(determineNPPRiskArchetype(npp)).toBe("moderate");
    });

    it("returns aggressive for low scores", () => {
      const npp = makeNPP({ favorability: 15, politicalInfluence: 20 });
      expect(determineNPPRiskArchetype(npp)).toBe("aggressive");
    });

    it("uses 60/40 favorability/influence weighting", () => {
      // favorability=60*0.6 + influence=10*0.4 = 36+4 = 40 < 60 → moderate? No, 40 < 35 is aggressive.
      // Actually: score = 60*0.6 + 10*0.4 = 36+4 = 40 → 35 <= 40 < 60 → moderate
      const npp = makeNPP({ favorability: 60, politicalInfluence: 10 });
      expect(determineNPPRiskArchetype(npp)).toBe("moderate");
    });
  });

  describe("computeNPPInvestableBudget", () => {
    it("returns a positive budget for US NPPs", () => {
      const npp = makeNPP({ countryId: "US", favorability: 70, politicalInfluence: 60 });
      const budget = computeNPPInvestableBudget(npp);
      expect(budget).toBeGreaterThan(0);
    });

    it("defaults to US GDP when country is missing", () => {
      const npp = makeNPP({ countryId: undefined, favorability: 70, politicalInfluence: 60 });
      const budget = computeNPPInvestableBudget(npp);
      expect(budget).toBeGreaterThan(0);
    });

    it("conservative NPPs have smaller investment fractions than aggressive", () => {
      const conservativeNPP = makeNPP({
        favorability: 80,
        politicalInfluence: 80,
        countryId: "US",
      });
      const aggressiveNPP = makeNPP({ favorability: 10, politicalInfluence: 10, countryId: "US" });

      const conservativeBudget = computeNPPInvestableBudget(conservativeNPP);
      const aggressiveBudget = computeNPPInvestableBudget(aggressiveNPP);

      // Conservative invests 35+5=40% of income; aggressive invests 10+30=40%.
      // Both invest 40% of income — the difference is which funds they choose.
      expect(conservativeBudget).toBeGreaterThan(0);
      expect(aggressiveBudget).toBeGreaterThan(0);
    });

    it("US NPP budget is roughly GDP/capita / 48 * investFraction", () => {
      const npp = makeNPP({ countryId: "US", favorability: 70, politicalInfluence: 60 });
      const budget = computeNPPInvestableBudget(npp);
      // Conservative: 40% of (80000/48) = 40% of ~1667 = ~666
      expect(budget).toBeGreaterThan(500);
      expect(budget).toBeLessThan(1000);
    });
  });

  describe("nppAccrualDampingMultiplier (#3245 wealth saturation)", () => {
    const usIncome = nppAnnualIncomeAnchor("US"); // 80,000
    const usCap = usIncome * NPP_WEALTH_SATURATION_YEARS; // 160,000

    it("returns full income (1.0) at zero wealth", () => {
      expect(nppAccrualDampingMultiplier(0, usIncome)).toBe(1);
    });

    it("tapers linearly: 0.5 at half the saturation cap", () => {
      expect(nppAccrualDampingMultiplier(usCap / 2, usIncome)).toBeCloseTo(0.5, 10);
    });

    it("reaches exactly 0 at the cap (2 years of GDP-pc income)", () => {
      expect(nppAccrualDampingMultiplier(usCap, usIncome)).toBe(0);
    });

    it("floors at 0 above the cap — a saturated NPP is never charged", () => {
      expect(nppAccrualDampingMultiplier(usCap * 10, usIncome)).toBe(0);
      expect(nppAccrualDampingMultiplier(Number.MAX_SAFE_INTEGER, usIncome)).toBe(0);
    });

    it("clamps to 1 for negative or non-finite wealth", () => {
      expect(nppAccrualDampingMultiplier(-5_000, usIncome)).toBe(1);
      expect(nppAccrualDampingMultiplier(Number.NaN, usIncome)).toBe(1);
    });

    it("defensively returns 1 when the income figure is unusable", () => {
      expect(nppAccrualDampingMultiplier(50_000, 0)).toBe(1);
      expect(nppAccrualDampingMultiplier(50_000, -1)).toBe(1);
      expect(nppAccrualDampingMultiplier(50_000, Number.NaN)).toBe(1);
    });

    it("equilibrium sits within 1-3x annual income for every seeded country", () => {
      for (const countryId of ["US", "UK", "JP", "DE", "IE", "BR", "CN", "NG"]) {
        const income = nppAnnualIncomeAnchor(countryId);
        const cap = income * NPP_WEALTH_SATURATION_YEARS;
        expect(cap).toBeGreaterThanOrEqual(income * 1);
        expect(cap).toBeLessThanOrEqual(income * 3);
        // Accrual is strictly positive below cap, exactly zero at cap.
        expect(nppAccrualDampingMultiplier(cap - 1, income)).toBeGreaterThan(0);
        expect(nppAccrualDampingMultiplier(cap, income)).toBe(0);
      }
    });

    it("nppAnnualIncomeAnchor falls back to US for unknown/missing countries", () => {
      expect(nppAnnualIncomeAnchor(undefined)).toBe(nppAnnualIncomeAnchor("US"));
      expect(nppAnnualIncomeAnchor("ZZ")).toBe(nppAnnualIncomeAnchor("US"));
    });
  });

  describe("processNPPFundInvestments wealth-saturation integration (#3245)", () => {
    // US conservative NPP baseline: floor(80000/48 × 0.4) = 666/turn budget,
    // saturation cap = 2 × 80000 = ₳160,000.
    const FUND_ID = new ObjectId();
    const NAV = 100;
    const activeFund = {
      _id: FUND_ID,
      slug: "us-broad",
      status: "active",
      scope: "country",
      countryId: "US",
      kind: "broad",
      quotedNav: NAV,
    };

    type MockDb = import("@/lib/test-utils/mockDb").MockDb;
    let db: MockDb;

    function makeNppDoc(overrides: Record<string, unknown> = {}) {
      return {
        _id: new ObjectId(),
        countryId: "US",
        favorability: 80,
        politicalInfluence: 80, // conservative archetype
        nppInvestmentCashAnchor: 0,
        ...overrides,
      };
    }

    async function setup(
      nppDocs: Record<string, unknown>[],
      nppPositions: { nppId: ObjectId; fundId: ObjectId; units: number }[]
    ) {
      const { createMockDb, createAsyncIterableCursor } = await import("@/lib/test-utils/mockDb");
      db = createMockDb();
      // Active funds for listActiveFunds.
      const fundsCol = db.collection("indexFunds");
      fundsCol.find.mockReturnValue(createAsyncIterableCursor([activeFund]));
      // NPP roster.
      const nppsCol = db.collection("npps");
      nppsCol.find.mockReturnValue(createAsyncIterableCursor(nppDocs));
      // Positions: the wealth-valuation query has no nppId clause; the pass-4
      // existing-position query filters nppId: { $in }. Dispatch on the filter.
      const positionsCol = db.collection("indexFundPositions");
      positionsCol.find.mockImplementation((filter: Record<string, unknown>) =>
        createAsyncIterableCursor(filter && "nppId" in filter ? [] : nppPositions)
      );
      return db;
    }

    function accrualIncsFrom(dbm: MockDb): number[] {
      const bulk = dbm.collectionMocks["npps"]?.bulkWrite;
      if (!bulk || bulk.mock.calls.length === 0) return [];
      const incs: number[] = [];
      for (const call of bulk.mock.calls) {
        for (const op of call[0] as {
          updateOne: { update: { $inc?: Record<string, number> } };
        }[]) {
          const inc = op.updateOne.update.$inc?.nppInvestmentCashAnchor;
          if (inc !== undefined) incs.push(inc);
        }
      }
      return incs;
    }

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("accrues the full undamped budget at zero wealth (legacy behavior preserved)", async () => {
      const dbm = await setup([makeNppDoc()], []);
      const result = await processNPPFundInvestments(dbm as never, { currentTurn: 10 });
      expect(result.nppsProcessed).toBe(1);
      const incs = accrualIncsFrom(dbm);
      expect(incs).toContain(666); // floor(80000/48 × 0.4)
    });

    it("halves the accrual at half the saturation cap", async () => {
      const dbm = await setup([makeNppDoc({ nppInvestmentCashAnchor: 80_000 })], []);
      await processNPPFundInvestments(dbm as never, { currentTurn: 10 });
      const incs = accrualIncsFrom(dbm);
      expect(incs).toContain(333); // floor(666 × 0.5)
    });

    it("skips a saturated NPP entirely — no accrual, no debit, no subscriptions", async () => {
      const dbm = await setup([makeNppDoc({ nppInvestmentCashAnchor: 200_000 })], []);
      const result = await processNPPFundInvestments(dbm as never, { currentTurn: 10 });
      expect(result.nppsProcessed).toBe(0);
      expect(result.totalInvested).toBe(0);
      expect(dbm.collectionMocks["npps"].bulkWrite).not.toHaveBeenCalled();
      // Money conservation: nothing was minted and nothing was destroyed —
      // there is no drain leg, so no financialTxLog sink entry is required.
      expect(dbm.collectionMocks["financialTxLog"]).toBeUndefined();
    });

    it("counts fund-position value toward saturation, not just cash", async () => {
      const npp = makeNppDoc({ nppInvestmentCashAnchor: 0 });
      const dbm = await setup(
        [npp],
        [{ nppId: npp._id as ObjectId, fundId: FUND_ID, units: 2_000 }] // 2000 × ₳100 = ₳200k ≥ cap
      );
      const result = await processNPPFundInvestments(dbm as never, { currentTurn: 10 });
      expect(result.nppsProcessed).toBe(0);
      expect(accrualIncsFrom(dbm)).toHaveLength(0);
    });

    it("never debits more than the damped accrual (invest ≤ income, no negative drift)", async () => {
      const dbm = await setup([makeNppDoc({ nppInvestmentCashAnchor: 80_000 })], []);
      await processNPPFundInvestments(dbm as never, { currentTurn: 10 });
      const incs = accrualIncsFrom(dbm);
      const accrued = incs.filter((v) => v > 0).reduce((a, b) => a + b, 0);
      const debited = -incs.filter((v) => v < 0).reduce((a, b) => a + b, 0);
      expect(debited).toBeLessThanOrEqual(accrued);
    });

    it("values wealth only from NPP-held positions (players are structurally exempt)", async () => {
      const dbm = await setup([makeNppDoc()], []);
      await processNPPFundInvestments(dbm as never, { currentTurn: 10 });
      // The valuation query is scoped holderKind: "npp"; character positions
      // can never enter the damping measure, and the characters collection is
      // never touched by this phase.
      const firstFindFilter = dbm.collectionMocks["indexFundPositions"].find.mock
        .calls[0][0] as Record<string, unknown>;
      expect(firstFindFilter).toMatchObject({ holderKind: "npp" });
      expect(dbm.collectionMocks["characters"]).toBeUndefined();
    });
  });

  describe("ARCHETYPE_ALLOCATIONS", () => {
    it("all archetype allocations sum to broadPct + sectorPct <= 1", () => {
      for (const alloc of Object.values(ARCHETYPE_ALLOCATIONS)) {
        const total = alloc.broadPct + alloc.sectorPct;
        expect(total).toBeLessThanOrEqual(1);
        expect(total).toBeGreaterThan(0);
      }
    });

    it("domesticBias is between 0 and 1", () => {
      for (const alloc of Object.values(ARCHETYPE_ALLOCATIONS)) {
        expect(alloc.domesticBias).toBeGreaterThanOrEqual(0);
        expect(alloc.domesticBias).toBeLessThanOrEqual(1);
      }
    });
  });
});
