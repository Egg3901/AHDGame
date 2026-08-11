import { describe, expect, it, vi } from "vitest";
import * as costCatalog from "@/lib/era/legislationCostCatalog";
import { UK_LAWS } from "@/lib/politicalLegislation/laws/ukLaws";
import { projectLawToLegislationType } from "@/lib/politicalLegislation/project";
import type { EnactedLaw } from "@/lib/db/types/budget";
import { calculateEnactedLawAnnualCost, calculatePolicyOptionAnnualCost } from "./costs";

const UK_ROLLUP = { gdp: 19_800_000_000, population: 52_600_000 };
const CONTEXT = {
  budgetCapacity: 4_520_000_000,
  gdp: 14_400_000_000, // budget GDP — deliberately NOT the rollup
  population: 50_600_000,
  countryId: "UK",
  year: 1953,
  v2Base: UK_ROLLUP,
  incomeBandIndex: null,
};

const nhsDoc = projectLawToLegislationType(
  UK_LAWS.find((l) => l.id === "uk.health.universalCare.primary")!
);

describe("costModelV2 dual-path routing", () => {
  it("routes a v2 option to the new engine on the rollup base, never getCostClass", () => {
    const spy = vi.spyOn(costCatalog, "getCostClass");
    const cost = calculatePolicyOptionAnnualCost(nhsDoc.policyOptions![4], CONTEXT, nhsDoc._id);
    // 0.0308 × £265 × 52.6M ≈ £429M — computed on the ROLLUP, not budget GDP.
    expect(cost).toBeGreaterThan(425_000_000);
    expect(cost).toBeLessThan(434_000_000);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("prices a v2 level 0 at zero", () => {
    expect(calculatePolicyOptionAnnualCost(nhsDoc.policyOptions![0], CONTEXT, nhsDoc._id)).toBe(0);
  });

  it("a v2 option without v2Base context throws (never silently misprices)", () => {
    const { v2Base: _v2Base, ...bare } = CONTEXT;
    expect(() =>
      calculatePolicyOptionAnnualCost(nhsDoc.policyOptions![4], bare, nhsDoc._id)
    ).toThrow(/v2Base/);
  });

  it("routes a v2 EnactedLaw and returns a finite engine-equal value", () => {
    const law = {
      legislationTypeId: nhsDoc._id,
      countryId: "UK",
      budgetCost: 0,
      costModelV2: { incomeCostFraction: 0.0308 },
    } as unknown as EnactedLaw;
    const routed = calculateEnactedLawAnnualCost(law, CONTEXT);
    expect(Number.isFinite(routed)).toBe(true);
    expect(routed).toBeGreaterThan(425_000_000);
    expect(routed).toBeLessThan(434_000_000);
  });

  it("regression §10: the same law through the LEGACY path yields silent 0 under era ON", () => {
    // Strip costModelV2 — an unregistered new-generation id on the legacy path
    // classifies "none" → 0 (era year threaded). The ROUTED path above is the
    // finite, engine-equal result; this documents the fail-safe it replaces.
    const law = {
      legislationTypeId: nhsDoc._id,
      countryId: "UK",
      budgetCost: 50,
    } as unknown as EnactedLaw;
    expect(calculateEnactedLawAnnualCost(law, { ...CONTEXT, v2Base: undefined })).toBe(0);
  });

  it("legacy options are untouched: absolute per-capita path prices identically", () => {
    const legacyOption = {
      id: "opt",
      name: "Legacy",
      stance: "center" as const,
      effectDirection: 0 as const,
      economic: 0,
      social: 0,
      annualCostPerCapita: 10,
    };
    const legacyContext = {
      budgetCapacity: 1_000_000_000,
      gdp: 6_200_000_000_000,
      population: 253_000_000,
      countryId: "US",
      year: null,
    };
    const cost = calculatePolicyOptionAnnualCost(legacyOption, legacyContext, "us_legacy_law");
    // annualCostPerCapita × population × gdp-indexed scale (US scaleLow at 1991 gpc)
    expect(cost).toBeGreaterThan(0);
    expect(Number.isFinite(cost!)).toBe(true);
  });
});
