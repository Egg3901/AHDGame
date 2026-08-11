import { describe, expect, it } from "vitest";
import { build1953RegistrationSeeds } from "@/lib/seeds/registration/registrationLanes1953";
import { validateSeed } from "@/lib/seeds/registration/registrationLanes";
import { TARGETS } from "@/lib/seeds/calibration/targets";
import { NATIONAL_BASELINES_1953 } from "@/lib/politicalMetrics/seeds/nationalBaselines1953";
import { getInitialNationalBudgetsForPreset } from "./budgets";

const AUDITED_COUNTRIES = ["US", "UK", "RU", "DD"] as const;

describe("1953 audited country bundles", () => {
  it("ships complete, normalized registration lanes for every political region", () => {
    const seeds = build1953RegistrationSeeds();
    const counts = Object.fromEntries(
      AUDITED_COUNTRIES.map((countryId) => [
        countryId,
        seeds.filter((seed) => seed.countryId === countryId).length,
      ])
    );
    expect(counts).toEqual({ US: 48, UK: 12, RU: 14, DD: 6 });
    expect(seeds.map((seed) => validateSeed(seed)).filter(Boolean)).toEqual([]);
  });

  it("anchors every audited sovereign to its authored starting debt regime", () => {
    const budgets = getInitialNationalBudgetsForPreset("1953-default");
    for (const countryId of AUDITED_COUNTRIES) {
      const budget = budgets.find((row) => row.countryId === countryId);
      expect(budget, countryId).toBeDefined();
      expect(budget!.sovereignRiskAnchor).toEqual({
        debtToGdpRatio: budget!.debtToGdpRatio,
        creditRating: budget!.creditRating,
        interestRate: budget!.debt.interestRate,
      });
    }
  });

  it("keeps the four authored political boards bounded and structurally complete", () => {
    expect(Object.keys(NATIONAL_BASELINES_1953).sort()).toEqual([...AUDITED_COUNTRIES].sort());
    const metricCounts = new Set<number>();
    for (const countryId of AUDITED_COUNTRIES) {
      const values = Object.values(NATIONAL_BASELINES_1953[countryId]);
      metricCounts.add(values.length);
      expect(values.every((metric) => metric.value >= 0 && metric.value <= 100)).toBe(true);
    }
    expect(metricCounts.size).toBe(1);
  });

  it("retains the intentional one-party-system lean targets", () => {
    expect(TARGETS.RU?.["1953"]?.twoAxis?.economicCenter).toBe(-2);
    expect(TARGETS.DD?.["1953"]?.twoAxis?.economicCenter).toBe(-0.6);
  });
});
