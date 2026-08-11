import { describe, it, expect } from "vitest";
import { ideologyVote } from "./billVoteLogic";
import type { NPP, Bill } from "@/lib/db/types";

describe("ideologyVote", () => {
  const createNPP = (overrides?: Partial<NPP>): NPP =>
    ({
      _id: "npp-1" as any,
      name: "Test NPP",
      ideology: 0,
      personality: {
        loyalty: 50,
        ambition: 50,
        stubbornness: 50,
      },
      policies: {
        economic: 0,
        social: 0,
      },
      ...overrides,
    }) as NPP;

  const createBill = (overrides?: Partial<Bill>): Bill =>
    ({
      _id: "bill-1" as any,
      title: "Test Bill",
      sponsorId: "char-1",
      legislationTypeId: undefined,
      effectDirection: undefined,
      status: "pending",
      countryId: "US",
      ...overrides,
    }) as Bill;

  describe("abstain behavior", () => {
    it("abstains with low loyalty", () => {
      const npp = createNPP({ personality: { loyalty: 10, ambition: 0, stubbornness: 50 } });
      const bill = createBill();
      // Run multiple times to check abstain rate
      let abstainCount = 0;
      for (let i = 0; i < 100; i++) {
        if (ideologyVote(npp, bill, () => Math.random()) === "abstain") {
          abstainCount++;
        }
      }
      // Low loyalty should produce abstains ~25% of the time
      expect(abstainCount).toBeGreaterThan(10);
    });

    it("rarely abstains with high loyalty", () => {
      const npp = createNPP({ personality: { loyalty: 90, ambition: 0, stubbornness: 50 } });
      const bill = createBill();
      let abstainCount = 0;
      for (let i = 0; i < 100; i++) {
        if (ideologyVote(npp, bill, () => Math.random()) === "abstain") {
          abstainCount++;
        }
      }
      // High loyalty should produce abstains ~5% of the time
      expect(abstainCount).toBeLessThan(20);
    });

    it("ambition slightly reduces abstain chance", () => {
      const lowAmbitionNpp = createNPP({
        personality: { loyalty: 50, ambition: 0, stubbornness: 50 },
      });
      const highAmbitionNpp = createNPP({
        personality: { loyalty: 50, ambition: 90, stubbornness: 50 },
      });
      const bill = createBill();

      let lowAmbitionAbstains = 0;
      let highAmbitionAbstains = 0;

      // Use a seeded PRNG to eliminate flakiness — the effect of ambition
      // on abstain rate is small, so we need deterministic runs.
      let seed = 42;
      const seededRandom = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };

      for (let i = 0; i < 1000; i++) {
        if (ideologyVote(lowAmbitionNpp, bill, seededRandom) === "abstain") {
          lowAmbitionAbstains++;
        }
        if (ideologyVote(highAmbitionNpp, bill, seededRandom) === "abstain") {
          highAmbitionAbstains++;
        }
      }

      expect(highAmbitionAbstains).toBeLessThanOrEqual(lowAmbitionAbstains);
    });
  });

  describe("support probability", () => {
    it("returns for or against when not abstaining", () => {
      const npp = createNPP({ personality: { loyalty: 80, ambition: 50, stubbornness: 50 } });
      const bill = createBill();
      const result = ideologyVote(npp, bill, () => 0.5); // Mid-range random
      expect(["for", "against"]).toContain(result);
    });

    it("high loyalty increases support chance", () => {
      const highLoyaltyNpp = createNPP({
        personality: { loyalty: 90, ambition: 0, stubbornness: 50 },
      });
      const _lowLoyaltyNpp = createNPP({
        personality: { loyalty: 20, ambition: 0, stubbornness: 50 },
      });
      const bill = createBill();

      // Use same random value that would be "for" for high loyalty
      // Support chance: 55% + (loyalty * 0.1) = 55% + 9% = 64% for high loyalty
      // Support chance: 55% + 2% = 57% for low loyalty
      const result = ideologyVote(highLoyaltyNpp, bill, () => 0.6);
      expect(result).toBe("for");
    });
  });

  describe("ideology alignment with policy positions", () => {
    it("supports bill when NPP position aligns with effect direction", () => {
      // NPP strongly supports economic policy (+5), bill has positive effect (+1)
      const npp = createNPP({
        policies: {
          economic: 5,
          social: 0,
          domainPositions: { economic: 5 },
        },
        personality: { loyalty: 80, ambition: 0, stubbornness: 50 },
      });
      const bill = createBill({
        legislationTypeId: "economic",
        effectDirection: 1,
      });

      // Alignment = (5/5) * 1 = 1, supportChance = 0.63 + 0.25 = 0.88
      // Random 0.7 should result in "for"
      const result = ideologyVote(npp, bill, () => 0.7);
      expect(result).toBe("for");
    });

    it("opposes bill when NPP position opposes effect direction", () => {
      // NPP opposes economic policy (-5), bill has positive effect (+1)
      const npp = createNPP({
        policies: {
          economic: -5,
          social: 0,
          domainPositions: { economic: -5 },
        },
        personality: { loyalty: 80, ambition: 0, stubbornness: 50 },
      });
      const bill = createBill({
        legislationTypeId: "economic",
        effectDirection: 1,
      });

      // Alignment = (-5/5) * 1 = -1, supportChance = 0.63 - 0.25 = 0.38
      // Random 0.5 should result in "against"
      const result = ideologyVote(npp, bill, () => 0.5);
      expect(result).toBe("against");
    });

    it("supports bill when NPP opposes negative-effect bill", () => {
      // NPP opposes economic policy (-5), bill has negative effect (-1)
      // Negative effect on something NPP opposes = good for NPP
      const npp = createNPP({
        policies: {
          economic: -5,
          social: 0,
          domainPositions: { economic: -5 },
        },
        personality: { loyalty: 80, ambition: 0, stubbornness: 50 },
      });
      const bill = createBill({
        legislationTypeId: "economic",
        effectDirection: -1,
      });

      // Alignment = (-5/5) * -1 = 1, supportChance = 0.63 + 0.25 = 0.88
      const result = ideologyVote(npp, bill, () => 0.7);
      expect(result).toBe("for");
    });

    it("clamps supportChance to 0.2-0.9 range", () => {
      // Perfect alignment would give > 0.9, but should be clamped
      const npp = createNPP({
        policies: {
          economic: 5,
          social: 0,
        },
        personality: { loyalty: 90, ambition: 0, stubbornness: 50 },
      });
      const bill = createBill({
        legislationTypeId: "economic",
        effectDirection: 1,
      });

      // Base: 0.55 + 0.09 = 0.64, + 0.25 alignment = 0.89 (within range)
      // With max loyalty 100: 0.55 + 0.10 + 0.25 = 0.90 (at upper bound)
      const result = ideologyVote(npp, bill, () => 0.95);
      expect(result).toBe("against");
    });

    it("ignores missing domain position", () => {
      const npp = createNPP({
        policies: {
          economic: 0,
          social: 0,
        },
        personality: { loyalty: 80, ambition: 0, stubbornness: 50 },
      });
      const bill = createBill({
        legislationTypeId: "economic",
        effectDirection: 1,
      });

      // No alignment bonus, base support chance only
      const result = ideologyVote(npp, bill, () => 0.7);
      // Base: 0.63, random 0.7 > 0.63, so "against"
      expect(result).toBe("against");
    });

    it("ignores undefined effect direction", () => {
      const npp = createNPP({
        policies: {
          economic: 5,
          social: 0,
        },
        personality: { loyalty: 80, ambition: 0, stubbornness: 50 },
      });
      const bill = createBill({
        legislationTypeId: "economic",
        effectDirection: undefined,
      });

      const result = ideologyVote(npp, bill, () => 0.7);
      // No alignment bonus applied
      expect(result).toBe("against");
    });

    it("ignores zero effect direction", () => {
      const npp = createNPP({
        policies: {
          economic: 5,
          social: 0,
        },
        personality: { loyalty: 80, ambition: 0, stubbornness: 50 },
      });
      const bill = createBill({
        legislationTypeId: "economic",
        effectDirection: 0,
      });

      const result = ideologyVote(npp, bill, () => 0.7);
      // Zero effect direction means no alignment bonus
      expect(result).toBe("against");
    });
  });

  describe("deterministic testing with custom random", () => {
    it("produces consistent results with fixed random", () => {
      const npp = createNPP();
      const bill = createBill();
      const fixedRandom = () => 0.3;

      const result1 = ideologyVote(npp, bill, fixedRandom);
      const result2 = ideologyVote(npp, bill, fixedRandom);

      expect(result1).toBe(result2);
    });

    it("can force abstain with low random value", () => {
      const npp = createNPP({ personality: { loyalty: 20, ambition: 0, stubbornness: 50 } });
      const bill = createBill();
      // Abstain chance for loyalty=20: max(0.05, min(0.25, 0.8*0.3 - 0)) = 0.24
      // Random 0.1 < 0.24, so abstain
      const result = ideologyVote(npp, bill, () => 0.1);
      expect(result).toBe("abstain");
    });

    it("can force vote with high random value", () => {
      const npp = createNPP({ personality: { loyalty: 80, ambition: 0, stubbornness: 50 } });
      const bill = createBill();
      // Abstain chance: max(0.05, min(0.25, 0.2*0.3)) = 0.06
      // Random 0.9 > 0.06, so vote (not abstain)
      // Support chance: 0.55 + 0.08 = 0.63
      // After abstain: (0.9 - 0.06) / 0.94 = 0.89 > 0.63, so "against"
      const result = ideologyVote(npp, bill, () => 0.9);
      expect(result).toBe("against");
    });
  });
});
