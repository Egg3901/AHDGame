import { describe, expect, it } from "vitest";
import { ngLegislationTypes } from "./ngLegislationTypes";
import { COUNTRY_POLICY_CONFIGS } from "@/lib/seeds/reference/basePolicies";

// Sub-phase 5a — Nigeria tax dials. Each maps to a real `taxRateChange.taxType`
// union member (verified against src/lib/db/types/legislation.ts).
const NG_TAX_TYPES = [
  { id: "ng_vat_rate", taxType: "salesTax" },
  { id: "ng_companies_income_tax", taxType: "domesticCorporateTax" },
  { id: "ng_personal_income_tax", taxType: "incomeTax" },
  { id: "ng_petroleum_profit_tax", taxType: "foreignCorporateTax" },
  { id: "ng_customs_tariff", taxType: "tariffs" },
  { id: "ng_capital_gains_tax", taxType: "capitalGainsTax" },
  { id: "ng_stamp_duty", taxType: "stampDuty" },
  { id: "ng_excise_duty", taxType: "exciseDuty" },
  { id: "ng_paye", taxType: "payrollTax" },
] as const;

describe("ngLegislationTypes — structure", () => {
  it("every entry is scoped to ng with a unique ng_ id", () => {
    const ids = new Set<string>();
    for (const t of ngLegislationTypes) {
      expect(t.countryScope).toBe("ng");
      expect(t._id.startsWith("ng_")).toBe(true);
      expect(ids.has(t._id), `duplicate id ${t._id}`).toBe(false);
      ids.add(t._id);
    }
  });

  it("every tax bill maps to the expected taxRateChange.taxType", () => {
    for (const tax of NG_TAX_TYPES) {
      const lt = ngLegislationTypes.find((t) => t._id === tax.id);
      expect(lt, `missing ${tax.id}`).toBeTruthy();
      expect(lt!.taxRateChange?.taxType).toBe(tax.taxType);
    }
  });

  it("every tax bill has a single center (baseline) option", () => {
    for (const tax of NG_TAX_TYPES) {
      const lt = ngLegislationTypes.find((t) => t._id === tax.id)!;
      const centers = (lt.policyOptions ?? []).filter((o) => o.stance === "center");
      expect(centers.length, `${tax.id} should have exactly one center option`).toBe(1);
    }
  });

  it("includes the 5b economic/infrastructure/energy bills with weighted effects", () => {
    const NG_5B_IDS = [
      "ng_petroleum_sector_reform",
      "ng_power_sector_reform",
      "ng_minimum_wage",
      "ng_industrial_policy",
      "ng_infrastructure_investment",
      "ng_agriculture_policy",
      "ng_renewable_energy",
      "ng_fiscal_framework",
    ];
    for (const id of NG_5B_IDS) {
      const lt = ngLegislationTypes.find((t) => t._id === id);
      expect(lt, `missing ${id}`).toBeTruthy();
      expect(lt!.countryScope).toBe("ng");
      expect((lt!.effectTargetsWeighted ?? []).length).toBeGreaterThan(0);
      expect((lt!.policyOptions ?? []).some((o) => o.stance === "center")).toBe(true);
    }
  });

  it("ng basePolicies supplies defaults + optionIndexes for every authored ng_ type", () => {
    const ng = COUNTRY_POLICY_CONFIGS.ng;
    expect(ng).toBeTruthy();
    for (const t of ngLegislationTypes) {
      expect(ng.defaults[t._id], `basePolicies.ng.defaults missing ${t._id}`).toBeDefined();
      expect(
        ng.optionIndexes[t._id],
        `basePolicies.ng.optionIndexes missing ${t._id}`
      ).toBeDefined();
    }
  });

  it("includes the 5c social/health/security/foreign bills", () => {
    const NG_5C_IDS = [
      "ng_health_insurance",
      "ng_basic_education",
      "ng_social_safety_net",
      "ng_pension_system",
      "ng_anti_corruption",
      "ng_policing_reform",
      "ng_counterinsurgency",
      "ng_foreign_policy",
      "ng_electoral_reform",
      "ng_press_freedom",
    ];
    for (const id of NG_5C_IDS) {
      expect(
        ngLegislationTypes.find((t) => t._id === id),
        `missing ${id}`
      ).toBeTruthy();
    }
  });

  it("NG legislation set reaches parity scale (>= 40 types)", () => {
    expect(ngLegislationTypes.length).toBeGreaterThanOrEqual(40);
  });

  it("each optionIndex points at that type's center option", () => {
    const ng = COUNTRY_POLICY_CONFIGS.ng;
    for (const t of ngLegislationTypes) {
      const idx = ng.optionIndexes[t._id];
      const opt = (t.policyOptions ?? [])[idx];
      expect(opt, `${t._id} optionIndex ${idx} out of range`).toBeTruthy();
      expect(opt.stance, `${t._id} optionIndex should point at the center option`).toBe("center");
    }
  });
});
