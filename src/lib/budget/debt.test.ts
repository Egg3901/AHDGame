import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getDebtThreshold,
  calculateCreditRating,
  calculateInterestRate,
  processAnnualDebt,
  triggerDebtCeilingCrisis,
  resolveDebtCeilingCrisis,
  checkDebtCeilingCrisis,
  incrementCrisisTurns,
} from "./debt";

describe("debt module", () => {
  describe("getDebtThreshold", () => {
    it("returns AAA for debt-to-GDP ratio below 0.6", () => {
      expect(getDebtThreshold(0.3)).toEqual({
        maxRatio: 0.6,
        rating: "AAA",
        interestRate: 0.02,
        gdpPenalty: 0,
        trustPenalty: 0,
      });
    });

    it("returns AAA for debt-to-GDP ratio exactly at 0.6", () => {
      expect(getDebtThreshold(0.6)).toEqual({
        maxRatio: 0.6,
        rating: "AAA",
        interestRate: 0.02,
        gdpPenalty: 0,
        trustPenalty: 0,
      });
    });

    it("returns AA for debt-to-GDP ratio between 0.6 and 0.8", () => {
      expect(getDebtThreshold(0.7)).toEqual({
        maxRatio: 0.8,
        rating: "AA",
        interestRate: 0.025,
        gdpPenalty: 0,
        trustPenalty: 0,
      });
    });

    it("returns A for debt-to-GDP ratio between 0.8 and 1.0", () => {
      expect(getDebtThreshold(0.9)).toEqual({
        maxRatio: 1.0,
        rating: "A",
        interestRate: 0.035,
        gdpPenalty: 0.1,
        trustPenalty: 0,
      });
    });

    it("returns BBB for debt-to-GDP ratio between 1.0 and 1.2", () => {
      expect(getDebtThreshold(1.1)).toEqual({
        maxRatio: 1.2,
        rating: "BBB",
        interestRate: 0.05,
        gdpPenalty: 0.2,
        trustPenalty: 0,
      });
    });

    it("returns BB for debt-to-GDP ratio between 1.2 and 1.5", () => {
      expect(getDebtThreshold(1.3)).toEqual({
        maxRatio: 1.5,
        rating: "BB",
        interestRate: 0.07,
        gdpPenalty: 0.3,
        trustPenalty: 5,
      });
    });

    it("returns B for debt-to-GDP ratio between 1.5 and 2.5", () => {
      expect(getDebtThreshold(2.0)).toEqual({
        maxRatio: 2.5,
        rating: "B",
        interestRate: 0.1,
        gdpPenalty: 0.5,
        trustPenalty: 10,
      });
    });

    it("returns B at exactly the extreme-distress boundary (2.5)", () => {
      expect(getDebtThreshold(2.5).rating).toBe("B");
    });

    it("returns CCC above the extreme-distress boundary (refs #3236)", () => {
      expect(getDebtThreshold(2.51)).toEqual({
        maxRatio: Infinity,
        rating: "CCC",
        interestRate: 0.14,
        gdpPenalty: 0.7,
        trustPenalty: 15,
      });
    });

    it("returns last threshold (CCC) for extremely high ratios", () => {
      expect(getDebtThreshold(100)).toEqual({
        maxRatio: Infinity,
        rating: "CCC",
        interestRate: 0.14,
        gdpPenalty: 0.7,
        trustPenalty: 15,
      });
    });
  });

  describe("calculateCreditRating", () => {
    it("returns AAA for low debt ratios", () => {
      expect(calculateCreditRating(0.5)).toBe("AAA");
    });

    it("returns AA for moderate debt ratios", () => {
      expect(calculateCreditRating(0.75)).toBe("AA");
    });

    it("returns A for elevated debt ratios", () => {
      expect(calculateCreditRating(0.95)).toBe("A");
    });

    it("returns BBB for high debt ratios", () => {
      expect(calculateCreditRating(1.15)).toBe("BBB");
    });

    it("returns BB for very high debt ratios", () => {
      expect(calculateCreditRating(1.4)).toBe("BB");
    });

    it("returns B for crisis-level debt ratios", () => {
      expect(calculateCreditRating(1.6)).toBe("B");
    });

    it("returns CCC for extreme-distress debt ratios (refs #3236)", () => {
      expect(calculateCreditRating(3.0)).toBe("CCC");
      expect(calculateCreditRating(5.0)).toBe("CCC");
    });

    it("healthy and merely-high ratios are unchanged by the CCC extension", () => {
      // Guard: the new band must not shift any rating below 250% debt/GDP.
      expect(calculateCreditRating(0.5)).toBe("AAA");
      expect(calculateCreditRating(1.4)).toBe("BB");
      expect(calculateCreditRating(2.4)).toBe("B");
    });
  });

  describe("calculateInterestRate", () => {
    it("returns 2% for AAA rating", () => {
      expect(calculateInterestRate(0.5)).toBe(0.02);
    });

    it("returns 2.5% for AA rating", () => {
      expect(calculateInterestRate(0.75)).toBe(0.025);
    });

    it("returns 3.5% for A rating", () => {
      expect(calculateInterestRate(0.95)).toBe(0.035);
    });

    it("returns 5% for BBB rating", () => {
      expect(calculateInterestRate(1.15)).toBe(0.05);
    });

    it("returns 7% for BB rating", () => {
      expect(calculateInterestRate(1.4)).toBe(0.07);
    });

    it("returns 10% for B rating", () => {
      expect(calculateInterestRate(1.6)).toBe(0.1);
    });

    it("returns 14% for CCC rating (refs #3236)", () => {
      expect(calculateInterestRate(3.0)).toBe(0.14);
    });
  });

  describe("processAnnualDebt", () => {
    const mockDb = {} as any;

    it("calculates interest payment correctly", async () => {
      const federalBudget = {
        debt: {
          principal: 1000000,
          interestRate: 0.03,
          ceiling: 2000000,
        },
        spending: {
          total: 500000,
        },
        revenue: {
          total: 450000,
        },
      } as any;

      const result = await processAnnualDebt(mockDb, federalBudget, 5000000);

      expect(result.interestPayment).toBe(30000); // 1000000 * 0.03
    });

    it("does not add the annual deficit to principal (per-turn engine owns it)", async () => {
      const federalBudget = {
        debt: { principal: 1000000, interestRate: 0.03, ceiling: 2000000 },
        spending: { total: 500000 },
        revenue: { total: 400000 }, // deficit 100000 — must NOT be added here anymore
        treasuryBalance: -1000000,
      } as any;

      const result = await processAnnualDebt(mockDb, federalBudget, 5000000);

      expect(result.newPrincipal).toBe(1000000); // derived from balance, unchanged by the deficit
    });

    it("derives principal from a negative treasury balance", async () => {
      const federalBudget = {
        debt: { principal: 0, interestRate: 0.03, ceiling: 2000000 },
        spending: { total: 400000 },
        revenue: { total: 500000 },
        treasuryBalance: -250000,
      } as any;

      const result = await processAnnualDebt(mockDb, federalBudget, 5000000);

      expect(result.newPrincipal).toBe(250000);
    });

    it("treats a positive treasury balance as zero debt", async () => {
      const federalBudget = {
        debt: { principal: 100000, interestRate: 0.03, ceiling: 200000 },
        spending: { total: 100000 },
        revenue: { total: 500000 },
        treasuryBalance: 750000,
      } as any;

      const result = await processAnnualDebt(mockDb, federalBudget, 5000000);

      expect(result.newPrincipal).toBe(0);
    });

    it("calculates debt-to-GDP ratio correctly", async () => {
      const federalBudget = {
        debt: {
          principal: 1000000,
          interestRate: 0.03,
          ceiling: 2000000,
        },
        spending: {
          total: 500000,
        },
        revenue: {
          total: 500000,
        },
      } as any;

      const result = await processAnnualDebt(mockDb, federalBudget, 5000000);

      expect(result.debtToGdpRatio).toBe(0.2); // 1000000 / 5000000
    });

    it("returns correct credit rating based on new debt-to-GDP ratio", async () => {
      const federalBudget = {
        debt: {
          principal: 900000,
          interestRate: 0.02,
          ceiling: 2000000,
        },
        spending: {
          total: 500000,
        },
        revenue: {
          total: 400000,
        },
        treasuryBalance: -900000,
      } as any;

      const result = await processAnnualDebt(mockDb, federalBudget, 5000000);

      // Derived principal: 900000, ratio: 0.18 -> AAA
      expect(result.creditRating).toBe("AAA");
    });

    it("returns correct interest rate based on new debt-to-GDP ratio", async () => {
      const federalBudget = {
        debt: {
          principal: 4100000,
          interestRate: 0.03,
          ceiling: 6000000,
        },
        spending: {
          total: 500000,
        },
        revenue: {
          total: 400000,
        },
        treasuryBalance: -4100000,
      } as any;

      const result = await processAnnualDebt(mockDb, federalBudget, 5000000);

      // Derived principal: 4100000, ratio: 0.82 -> A (0.035)
      expect(result.interestRate).toBe(0.035);
    });

    it("detects when debt ceiling is exceeded", async () => {
      const federalBudget = {
        debt: {
          principal: 2100000,
          interestRate: 0.03,
          ceiling: 2000000,
        },
        spending: {
          total: 500000,
        },
        revenue: {
          total: 300000,
        },
        treasuryBalance: -2100000,
      } as any;

      const result = await processAnnualDebt(mockDb, federalBudget, 5000000);

      // Derived principal: 2100000 > ceiling 2000000
      expect(result.ceilingExceeded).toBe(true);
    });

    it("returns false when debt ceiling is not exceeded", async () => {
      const federalBudget = {
        debt: {
          principal: 1000000,
          interestRate: 0.03,
          ceiling: 2000000,
        },
        spending: {
          total: 500000,
        },
        revenue: {
          total: 450000,
        },
      } as any;

      const result = await processAnnualDebt(mockDb, federalBudget, 5000000);

      // New principal: 1050000 < ceiling 2000000
      expect(result.ceilingExceeded).toBe(false);
    });
  });

  describe("debt ceiling crisis functions", () => {
    const mockDb = {
      collection: vi.fn().mockReturnThis(),
      updateOne: vi.fn(),
      findOne: vi.fn(),
      findOneAndUpdate: vi.fn(),
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    describe("triggerDebtCeilingCrisis", () => {
      it("creates debt ceiling crisis document", async () => {
        mockDb.updateOne.mockResolvedValue({ modifiedCount: 1 });

        await triggerDebtCeilingCrisis(mockDb as any, 2026);

        expect(mockDb.collection).toHaveBeenCalledWith("gameState");
        expect(mockDb.updateOne).toHaveBeenCalledWith(
          { _id: "debt_ceiling_crisis" },
          {
            $set: expect.objectContaining({
              active: true,
              triggeredYear: 2026,
              resolved: false,
            }),
          },
          { upsert: true }
        );
      });
    });

    describe("resolveDebtCeilingCrisis", () => {
      it("marks debt ceiling crisis as resolved", async () => {
        mockDb.updateOne.mockResolvedValue({ modifiedCount: 1 });

        await resolveDebtCeilingCrisis(mockDb as any);

        expect(mockDb.collection).toHaveBeenCalledWith("gameState");
        expect(mockDb.updateOne).toHaveBeenCalledWith(
          { _id: "debt_ceiling_crisis" },
          {
            $set: expect.objectContaining({
              active: false,
              resolved: true,
            }),
          }
        );
      });
    });

    describe("checkDebtCeilingCrisis", () => {
      it("returns active crisis when exists", async () => {
        const mockCrisis = {
          _id: "debt_ceiling_crisis",
          active: true,
          triggeredAt: new Date(),
          turnsElapsed: 5,
        };
        mockDb.findOne.mockResolvedValue(mockCrisis);

        const result = await checkDebtCeilingCrisis(mockDb as any);

        expect(result).toEqual(mockCrisis);
        expect(mockDb.findOne).toHaveBeenCalledWith({
          _id: "debt_ceiling_crisis",
          active: true,
        });
      });

      it("returns null when no active crisis", async () => {
        mockDb.findOne.mockResolvedValue(null);

        const result = await checkDebtCeilingCrisis(mockDb as any);

        expect(result).toBeNull();
      });
    });

    describe("incrementCrisisTurns", () => {
      it("increments turns elapsed and returns new value", async () => {
        mockDb.findOneAndUpdate.mockResolvedValue({
          turnsElapsed: 6,
        });

        const result = await incrementCrisisTurns(mockDb as any);

        expect(result).toBe(6);
        expect(mockDb.findOneAndUpdate).toHaveBeenCalledWith(
          { _id: "debt_ceiling_crisis", active: true },
          { $inc: { turnsElapsed: 1 } },
          { returnDocument: "after" }
        );
      });

      it("returns 0 when no active crisis", async () => {
        mockDb.findOneAndUpdate.mockResolvedValue(null);

        const result = await incrementCrisisTurns(mockDb as any);

        expect(result).toBe(0);
      });
    });
  });
});
