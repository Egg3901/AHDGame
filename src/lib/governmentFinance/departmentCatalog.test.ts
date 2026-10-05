import { describe, expect, it } from "vitest";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { getDepartmentAccountPolicy } from "./accountPolicies";
import {
  DEPARTMENT_DEFINITIONS,
  getDepartmentDefinitions,
  resolveDepartmentDefinitionName,
  resolvePortfolioDepartment,
  type DepartmentCountryId,
  type PortfolioId,
} from "./departmentCatalog";

const countries: DepartmentCountryId[] = ["US", "UK", "JP"];
const requiredPortfolios: PortfolioId[] = [
  "finance",
  "foreign_affairs",
  "defense",
  "justice",
  "interior_local_government",
  "economy_industry",
  "labor_social_protection",
  "health",
  "education_research",
  "transport_infrastructure",
  "agriculture_rural_affairs",
  "environment_energy",
  "housing",
  "intelligence",
];

describe("department catalog", () => {
  it("uses unique durable department ids", () => {
    const ids = DEPARTMENT_DEFINITIONS.map((definition) => definition.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("maps every controlling office to a real Cabinet position", () => {
    for (const countryId of countries) {
      const positions = new Set(getCabinetPositions(countryId).map((position) => position.id));
      for (const department of DEPARTMENT_DEFINITIONS.filter(
        (definition) => definition.countryId === countryId
      )) {
        for (const positionId of department.controllingPositionIds) {
          expect(positions.has(positionId), `${department.id} -> ${positionId}`).toBe(true);
        }
      }
    }
  });

  it("resolves capability parity across the three initial countries", () => {
    const educationSplit = new Set(["secretary_of_education"]);
    for (const countryId of countries) {
      for (const portfolioId of requiredPortfolios) {
        expect(
          resolvePortfolioDepartment(countryId, portfolioId, 2027, educationSplit),
          `${countryId}.${portfolioId}`
        ).toBeDefined();
      }
    }
  });

  it("keeps US education in HEW until the department split is enacted", () => {
    expect(resolvePortfolioDepartment("US", "education_research", 2027)?.id).toBe(
      "us_health_department"
    );
    expect(
      resolvePortfolioDepartment(
        "US",
        "education_research",
        2027,
        new Set(["secretary_of_education"])
      )?.id
    ).toBe("us_education_department");
  });

  it("switches the UK agriculture portfolio at the 2001 machinery change", () => {
    expect(resolvePortfolioDepartment("UK", "agriculture_rural_affairs", 2000)?.id).toBe(
      "uk_agriculture_department"
    );
    expect(resolvePortfolioDepartment("UK", "agriculture_rural_affairs", 2001)?.id).toBe(
      "uk_environment_department"
    );
  });

  it("resolves era names from Cabinet mechanics without renaming special agencies", () => {
    const health = getDepartmentDefinitions("US", 1953).find(
      (department) => department.id === "us_health_department"
    );
    const intelligence = getDepartmentDefinitions("JP", 2027).find(
      (department) => department.id === "jp_intelligence_agency"
    );
    expect(health && resolveDepartmentDefinitionName(health, 1953)).toBe(
      "U.S. Department of Health, Education, and Welfare"
    );
    expect(intelligence && resolveDepartmentDefinitionName(intelligence, 2027)).toBe(
      "Cabinet Intelligence and Research Office"
    );
  });

  it("assigns a known account policy to every spending institution", () => {
    for (const definition of DEPARTMENT_DEFINITIONS) {
      expect(() => getDepartmentAccountPolicy(definition.accountPolicyId ?? "")).not.toThrow();
    }
  });
});
