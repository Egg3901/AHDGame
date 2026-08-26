import { describe, it, expect } from "vitest";
import { evaluateModifiers, applyModifiers, type ActiveModifier } from "./approvalModifiers";

describe("approvalModifiers", () => {
  describe("evaluateModifiers", () => {
    it("returns empty array when no conditions are met", () => {
      const metrics = {
        economic: {
          gdpGrowth: 1.5,
          unemploymentRate: 6,
          povertyRate: 12,
          costOfLiving: 100,
        },
      };

      const active = evaluateModifiers(metrics);
      // With mediocre stats, no modifiers should fire
      expect(active).toEqual([]);
    });

    it("assigns marginEffect and source on active modifiers", () => {
      const metrics = {
        economic: { unemploymentRate: 3.0 },
      };
      const active = evaluateModifiers(metrics);
      const mod = active.find((m) => m.id === "low_unemployment");
      expect(mod?.marginEffect).toBe(0.8);
      expect(mod?.source).toBe("metric");
    });

    it("sets marginEffect to zero for approval-only civic modifiers", () => {
      const active = evaluateModifiers({
        mediaInformation: { pressFreedom: 85 },
      });
      const mod = active.find((m) => m.id === "free_press");
      expect(mod?.effect).toBe(1);
      expect(mod?.marginEffect).toBe(0);
    });

    it("returns positive modifiers when conditions are met", () => {
      const metrics = {
        economic: {
          gdpGrowth: 4.0,
          unemploymentRate: 3.0,
          povertyRate: 5,
          costOfLiving: 85,
        },
      };

      const active = evaluateModifiers(metrics);
      const positiveModifiers = active.filter((m) => m.effect > 0);

      expect(positiveModifiers.some((m) => m.id === "economic_boom")).toBe(true);
      expect(positiveModifiers.some((m) => m.id === "low_unemployment")).toBe(true);
      expect(positiveModifiers.some((m) => m.id === "low_poverty")).toBe(true);
      expect(positiveModifiers.some((m) => m.id === "affordable_living")).toBe(true);
      expect(positiveModifiers.some((m) => m.id === "strong_growth")).toBe(true);
    });

    it("returns negative modifiers when conditions are met", () => {
      const metrics = {
        economic: {
          gdpGrowth: -1.0,
          unemploymentRate: 9,
          povertyRate: 20,
          costOfLiving: 150,
        },
      };

      const active = evaluateModifiers(metrics);
      const negativeModifiers = active.filter((m) => m.effect < 0);

      expect(negativeModifiers.some((m) => m.id === "recession")).toBe(true);
      expect(negativeModifiers.some((m) => m.id === "high_unemployment")).toBe(true);
      expect(negativeModifiers.some((m) => m.id === "high_poverty")).toBe(true);
      expect(negativeModifiers.some((m) => m.id === "cost_of_living_crisis")).toBe(true);
    });

    it("handles multi-category conditions", () => {
      const metrics = {
        healthcare: {
          lifeExpectancy: 84,
          affordabilityIndex: 80,
          uninsuredRate: 3,
          physicianRate: 3.0,
        },
        publicSafety: {
          violentCrimeRate: 280,
          publicSafetyConfidence: 75,
        },
      };

      const active = evaluateModifiers(metrics);

      expect(active.some((m) => m.id === "healthcare_excellence")).toBe(true);
      expect(active.some((m) => m.id === "universal_healthcare")).toBe(true);
      expect(active.some((m) => m.id === "high_life_expectancy")).toBe(true);
      expect(active.some((m) => m.id === "safe_streets")).toBe(true);
    });

    it("handles three-condition modifiers (infrastructure_boom)", () => {
      const metrics = {
        infrastructure: {
          roadCondition: 85,
          broadbandAccess: 95,
          waterQuality: 97,
        },
      };

      const active = evaluateModifiers(metrics);
      expect(active.some((m) => m.id === "infrastructure_boom")).toBe(true);
    });

    it("does not fire three-condition modifier when one condition fails", () => {
      const metrics = {
        infrastructure: {
          roadCondition: 85,
          broadbandAccess: 95,
          waterQuality: 70, // fails >= 95
        },
      };

      const active = evaluateModifiers(metrics);
      expect(active.some((m) => m.id === "infrastructure_boom")).toBe(false);
    });

    it("handles mixed positive and negative modifiers", () => {
      const metrics = {
        economic: {
          gdpGrowth: 3.5, // triggers strong_growth (positive)
          unemploymentRate: 8.5, // triggers high_unemployment (negative)
        },
        governance: {
          corruptionIndex: 50, // triggers corruption_concerns (negative)
          publicTrust: 65, // too low for high_public_trust, too high for low_public_trust
        },
      };

      const active = evaluateModifiers(metrics);
      const positive = active.filter((m) => m.effect > 0);
      const negative = active.filter((m) => m.effect < 0);

      expect(positive.length).toBeGreaterThan(0);
      expect(negative.length).toBeGreaterThan(0);
    });

    it("handles undefined metrics gracefully", () => {
      const metrics = {
        economic: {
          gdpGrowth: 4.0,
          // unemploymentRate is missing
        },
      };

      const active = evaluateModifiers(metrics);
      // Should not throw, just skip conditions with missing metrics
      expect(Array.isArray(active)).toBe(true);
    });

    it("handles empty metrics object", () => {
      const active = evaluateModifiers({});
      expect(active).toEqual([]);
    });

    it("fires new population growth modifiers", () => {
      const metrics = {
        population: {
          populationGrowth: 1.5,
          migrationRate: 0.35,
          medianAge: 33,
        },
        education: {
          workforceSkill: 72,
        },
      };
      const active = evaluateModifiers(metrics);
      expect(active.some((m) => m.id === "population_boom")).toBe(true);
      expect(active.some((m) => m.id === "youth_surge")).toBe(true);
      expect(active.some((m) => m.id === "brain_gain")).toBe(true);
    });
  });

  describe("prioritizeModifiers", () => {
    it("returns all modifiers when under the cap", async () => {
      const { prioritizeModifiers } = await import("./approvalModifiers");
      const mods = [
        { id: "a", label: "A", effect: 1 },
        { id: "b", label: "B", effect: -1 },
      ];
      const result = prioritizeModifiers(mods);
      expect(result.headline).toHaveLength(2);
      expect(result.remainder).toHaveLength(0);
    });

    it("splits by impact magnitude", async () => {
      const { prioritizeModifiers } = await import("./approvalModifiers");
      const mods = [
        { id: "small", label: "Small", effect: 1 },
        { id: "big", label: "Big", effect: -3 },
        { id: "mid", label: "Mid", effect: 2 },
      ];
      const result = prioritizeModifiers(mods, { max: 2 });
      expect(result.headline.map((m) => m.id)).toEqual(["big", "mid"]);
      expect(result.remainder.map((m) => m.id)).toEqual(["small"]);
    });

    /**
     * Ranking is by |marginEffect| first, so a war chip — which declares
     * marginEffect 0 precisely so it cannot touch profit margins — would sort
     * below every economic condition and fall off the end of the headline list.
     * The deepest approval swing in the game would be the one nobody sees.
     */
    it("headlines a war modifier despite its zero margin effect", async () => {
      const { prioritizeModifiers } = await import("./approvalModifiers");
      const mods = [
        { id: "m1", label: "M1", effect: 1, marginEffect: 2, source: "metric" as const },
        { id: "m2", label: "M2", effect: 1, marginEffect: 2, source: "metric" as const },
        { id: "war", label: "War", effect: -8, marginEffect: 0, source: "war" as const },
      ];
      const result = prioritizeModifiers(mods, { max: 2 });
      expect(result.headline.map((m) => m.id)).toContain("war");
    });
  });

  describe("applyModifiers", () => {
    it("returns base score when no modifiers", () => {
      expect(applyModifiers(50, [])).toBe(50);
    });

    it("adds positive modifier effects", () => {
      const modifiers: ActiveModifier[] = [
        { id: "test1", label: "Test 1", effect: 2 },
        { id: "test2", label: "Test 2", effect: 1 },
      ];
      expect(applyModifiers(50, modifiers)).toBe(53);
    });

    it("subtracts negative modifier effects", () => {
      const modifiers: ActiveModifier[] = [
        { id: "test1", label: "Test 1", effect: -3 },
        { id: "test2", label: "Test 2", effect: -1 },
      ];
      expect(applyModifiers(50, modifiers)).toBe(46);
    });

    it("clamps result to 0-100 range (upper)", () => {
      const modifiers: ActiveModifier[] = [
        { id: "test1", label: "Test 1", effect: 10 },
        { id: "test2", label: "Test 2", effect: 50 },
      ];
      // Positive net capped at 8, then 0–100 clamp: 95 + 8 = 100.
      expect(applyModifiers(95, modifiers)).toBe(100);
    });

    it("caps positive net before the 0-100 clamp", () => {
      const modifiers: ActiveModifier[] = Array.from({ length: 12 }, (_, i) => ({
        id: `p${i}`,
        label: `P${i}`,
        effect: 1,
      }));
      expect(applyModifiers(50, modifiers)).toBe(58);
    });

    it("clamps result to 0-100 range (lower)", () => {
      const modifiers: ActiveModifier[] = [
        { id: "test1", label: "Test 1", effect: -30 },
        { id: "test2", label: "Test 2", effect: -50 },
      ];
      expect(applyModifiers(50, modifiers)).toBe(0);
    });

    it("rounds to one decimal place", () => {
      const modifiers: ActiveModifier[] = [{ id: "test", label: "Test", effect: 0.15 }];
      expect(applyModifiers(50, modifiers)).toBe(50.2);
    });

    it("handles mixed positive and negative modifiers", () => {
      const modifiers: ActiveModifier[] = [
        { id: "pos1", label: "Positive 1", effect: 3 },
        { id: "neg1", label: "Negative 1", effect: -2 },
        { id: "pos2", label: "Positive 2", effect: 1 },
      ];
      expect(applyModifiers(50, modifiers)).toBe(52);
    });
  });

  describe("integration: evaluate + apply", () => {
    it("correctly evaluates and applies a realistic economic scenario", () => {
      const strongMetrics = {
        economic: {
          gdpGrowth: 3.5,
          unemploymentRate: 3.2,
          povertyRate: 7,
          costOfLiving: 88,
        },
      };

      const active = evaluateModifiers(strongMetrics);
      const baseApproval = 55;
      const finalApproval = applyModifiers(baseApproval, active);

      expect(finalApproval).toBeGreaterThan(baseApproval);
    });

    it("correctly evaluates and applies a crisis scenario", () => {
      const crisisMetrics = {
        economic: {
          gdpGrowth: -2.0,
          unemploymentRate: 10,
          povertyRate: 22,
          costOfLiving: 160,
        },
        governance: {
          corruptionIndex: 55,
          publicTrust: 25,
        },
      };

      const active = evaluateModifiers(crisisMetrics);
      const baseApproval = 55;
      const finalApproval = applyModifiers(baseApproval, active);

      expect(finalApproval).toBeLessThan(baseApproval);
    });
  });
});
