import { describe, expect, it } from "vitest";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";
import { resolvePortfolioDepartment, type DepartmentCountryId } from "./departmentCatalog";
import { buildLawAdministration, resolvePrimaryPortfolio } from "./lawAdministrationCatalog";

const countryIdByScope: Record<string, DepartmentCountryId> = {
  us: "US",
  uk: "UK",
  jp: "JP",
};

const initialCatalog = legislationTypes.filter(
  (type) => type.countryScope && type.countryScope in countryIdByScope
);

function hasCost(type: (typeof legislationTypes)[number]): boolean {
  return (
    type.policyOptions?.some(
      (option) =>
        (option.annualCostPerCapita ?? 0) > 0 ||
        (option.gdpPerCapitaMultiplier ?? 0) > 0 ||
        (option.gdpCostFraction ?? 0) > 0 ||
        (option.incomeCostFraction ?? 0) > 0 ||
        (option.costModelV2?.gdpCostFraction ?? 0) > 0 ||
        (option.costModelV2?.incomeCostFraction ?? 0) > 0
    ) === true
  );
}

describe("law administration catalog", () => {
  it("classifies every US, UK, and Japan law", () => {
    expect(initialCatalog).toHaveLength(195);
    for (const type of initialCatalog) {
      expect(type.allowedScope, type._id).toMatch(/^(national|state|both)$/);
      expect(type.administration, type._id).toBeDefined();
      expect(type.administration?.policyFamilyId, type._id).toBeTruthy();
      expect(type.administration?.allowedJurisdictionModes.length, type._id).toBeGreaterThan(0);
    }
  });

  it("resolves every law portfolio to an active country institution", () => {
    const enabledSeats = new Set(["secretary_of_education"]);
    for (const type of initialCatalog) {
      const countryId = countryIdByScope[type.countryScope!];
      expect(
        resolvePortfolioDepartment(
          countryId,
          type.administration!.primaryPortfolioId as never,
          2027,
          enabledSeats
        ),
        type._id
      ).toBeDefined();
    }
  });

  it("turns regional laws into automatic regional-discretion programs", () => {
    for (const type of initialCatalog.filter((candidate) => candidate.allowedScope === "state")) {
      expect(type.administration?.defaultJurisdictionMode, type._id).toBe("regional_discretion");
      expect(type.administration?.allowedJurisdictionModes, type._id).toEqual([
        "regional_discretion",
      ]);
    }
  });

  it("offers jurisdiction independently of policy stance on eligible national subjects", () => {
    const publicHealth = legislationTypes.find((type) => type._id === "us_public_health")!;
    expect(publicHealth.administration?.allowedJurisdictionModes).toContain("regional_discretion");
    expect(publicHealth.policyOptions?.map((option) => option.stance)).toEqual([
      "left",
      "left",
      "left",
      "center",
      "right",
      "right",
      "right",
    ]);
  });

  it("creates delivery metadata for cost-bearing laws but not tax-rate regimes", () => {
    for (const type of initialCatalog) {
      if (hasCost(type)) {
        expect(
          type.policyOptions?.every((option) => option.implementation),
          type._id
        ).toBe(true);
      }
    }
    const tax = legislationTypes.find((type) => type._id === "us_federal_income_tax_rate")!;
    expect(tax.administration?.lawKind).toBe("revenue");
    expect(tax.policyOptions?.every((option) => option.implementation === undefined)).toBe(true);
  });

  it("preserves the verified public-health slice identifiers", () => {
    const type = legislationTypes.find((candidate) => candidate._id === "us_public_health")!;
    const option = type.policyOptions?.find((candidate) => candidate.id === "public_health_opt_1");
    expect(type.administration).toMatchObject({
      primaryPortfolioId: "health",
      primaryDepartmentId: "us_health_department",
      policyFamilyId: "us_public_health",
    });
    expect(option?.implementation).toMatchObject({
      programId: "us_public_health_workforce",
      capacityType: "public_health_operations",
    });
  });

  it("derives conflicts from mechanisms, never stance labels", () => {
    for (const type of initialCatalog) {
      expect(Object.keys(type.administration ?? {}), type._id).not.toContain("stance");
    }
  });

  it("keeps classification helpers deterministic for an unmaterialized record", () => {
    const raw = {
      _id: "fixture_housing",
      countryScope: "us" as const,
      name: "Fixture",
      description: "Fixture",
      policyDomain: "social",
      subCategory: "Housing",
      positions: [],
    };
    expect(resolvePrimaryPortfolio(raw)).toBe("housing");
    expect(buildLawAdministration(raw)).toMatchObject({
      primaryPortfolioId: "housing",
      lawKind: "regulation",
      defaultJurisdictionMode: "national_direct",
    });
  });
});
