import { describe, expect, it } from "vitest";
import { UK_LAWS } from "@/lib/politicalLegislation/laws/ukLaws";
import { computeLawCost } from "@/lib/politicalLegislation/costEngine";
import { computeRegionalSpendingByCategory } from "./regionalSpending";

/**
 * The region budget route used to price regional policies ONLY through
 * `annualCostPerCapita` on a legacy `legislationTypes` doc. On the v2 preset
 * those docs are unseeded, so London's page reported £0.0M of spending while
 * the turn engine was charging it £59.0M — the same doc read two ways.
 */
describe("computeRegionalSpendingByCategory", () => {
  const law = UK_LAWS.find((l) => l.id === "uk.health.prevention.primary")!;
  const LONDON = { regionGdp: 3_442_585_781, regionPopulation: 9_206_136 };

  it("prices a v2 regional law through the cost engine", () => {
    const byCategory = computeRegionalSpendingByCategory({
      policies: [{ legislationTypeId: law.id, policyOptionId: "l3", policyOptionIndex: 3 }],
      legTypes: [],
      countryId: "UK",
      ...LONDON,
    });

    const fiscal = computeLawCost(
      law.levels![3],
      { gdp: LONDON.regionGdp, population: LONDON.regionPopulation },
      "UK",
      null
    );
    // Matches the turn engine's NET burden (cost − revenue), so the page and
    // the ledger quote the same number.
    expect(Object.values(byCategory).reduce((a, b) => a + b, 0)).toBeCloseTo(
      fiscal.cost - fiscal.revenue,
      0
    );
    expect(Object.keys(byCategory)).toEqual(["health"]);
  });

  it("still prices legacy per-capita policies when their type exists", () => {
    const byCategory = computeRegionalSpendingByCategory({
      policies: [{ legislationTypeId: "uk_regional_health", policyOptionId: "opt_3" }],
      legTypes: [
        {
          _id: "uk_regional_health",
          policyDomain: "healthcare",
          policyOptions: [{ id: "opt_3", annualCostPerCapita: 10 }],
        },
      ] as never,
      countryId: "UK",
      ...LONDON,
    });

    expect(byCategory).toEqual({ Healthcare: 10 * LONDON.regionPopulation });
  });

  it("ignores a policy whose legislation type no longer exists", () => {
    const byCategory = computeRegionalSpendingByCategory({
      policies: [{ legislationTypeId: "uk_council_tax", policyOptionId: "uk_council_tax_opt_5" }],
      legTypes: [],
      countryId: "UK",
      ...LONDON,
    });

    expect(byCategory).toEqual({});
  });

  it("keeps a net-contributing law's negative burden so the page matches the ledger", () => {
    // 42 of the 2060 authored law-levels net NEGATIVE (an extraction levy earns
    // more than it costs). The turn engine sums cost − revenue for every law
    // including those, so dropping them here would push the page total above
    // the ledger — the same two-reads-disagree bug this module exists to close.
    const law = UK_LAWS.find((l) => l.id === "uk.environment.extraction.primary")!;
    const level = 4;
    const fiscal = computeLawCost(
      law.levels![level],
      { gdp: LONDON.regionGdp, population: LONDON.regionPopulation },
      "UK",
      null
    );
    expect(fiscal.cost - fiscal.revenue).toBeLessThan(0); // guard the premise

    const byCategory = computeRegionalSpendingByCategory({
      policies: [{ legislationTypeId: law.id, policyOptionId: "l4", policyOptionIndex: level }],
      legTypes: [],
      countryId: "UK",
      ...LONDON,
    });

    expect(Object.values(byCategory).reduce((a, b) => a + b, 0)).toBeCloseTo(
      fiscal.cost - fiscal.revenue,
      0
    );
  });

  it("groups several laws in the same category into one line", () => {
    const second = UK_LAWS.find((l) => l.id !== law.id && l.category === law.category && l.levels)!;
    const byCategory = computeRegionalSpendingByCategory({
      policies: [
        { legislationTypeId: law.id, policyOptionId: "l3", policyOptionIndex: 3 },
        { legislationTypeId: second.id, policyOptionId: "l3", policyOptionIndex: 3 },
      ],
      legTypes: [],
      countryId: "UK",
      ...LONDON,
    });

    expect(Object.keys(byCategory)).toEqual(["health"]);
  });
});
