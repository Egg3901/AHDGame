import { describe, it, expect } from "vitest";
import { deLegislationTypes } from "./deLegislationTypes";
import { COUNTRY_POLICY_CONFIGS } from "@/lib/seeds/reference/basePolicies";

const ALL_DE_NON_TAX_TYPE_IDS = [
  // ── PR2 (Healthcare §14.1, Education §14.2, Social §14.7) ──────────────
  "de_health_insurance",
  "de_elder_care",
  "de_mental_health",
  "de_public_health",
  "de_education_funding",
  "de_university_tuition",
  "de_academic_reform",
  "de_research_science",
  "de_pension_system",
  "de_family_policy",
  "de_unemployment_welfare",
  "de_gender_equality",
  // ── PR3 (Defense §14.3, Foreign §14.11, Tech §14.12, Public Safety §14.13)
  "de_bundeswehr_funding",
  "de_defense_posture",
  "de_cybersecurity",
  "de_eu_integration",
  "de_foreign_aid_diplomacy",
  "de_trade_agreements",
  "de_robotics_ai",
  "de_digital_governance",
  "de_policing_public_safety",
  "de_criminal_justice",
  "de_constitutional_protection",
  // ── PR4 (Economic §14.4, Infra §14.5, Env §14.6, Imm §14.8, Agri §14.9,
  //         Gov §14.10, Media §14.14) — includes 3 legacy rewrites
  "de_minimum_wage",
  "de_fiscal_stimulus_act",
  "de_labor_reform",
  "de_sme_mittelstand",
  "de_rail_transport",
  "de_digital_infrastructure",
  "de_housing",
  "de_renewable_energy_target",
  "de_nuclear_energy",
  "de_carbon_pricing",
  "de_climate_targets",
  "de_immigration_policy",
  "de_asylum_policy",
  "de_integration_programs",
  "de_agricultural_subsidies",
  "de_food_security",
  "de_animal_welfare",
  "de_grundgesetz_reform",
  "de_electoral_reform",
  "de_government_ethics",
  "de_public_broadcasting",
  "de_press_freedom",
  // ── PR5 (Land-level §15) — state-scope, landtag chamber ────────────────
  "de_land_education",
  "de_land_police",
  "de_land_culture",
  "de_land_economic_development",
  "de_land_health_services",
  "de_land_municipal_grants",
] as const;

const POSTURE_ONLY_IDS = new Set<string>([
  // PR2
  "de_academic_reform",
  "de_gender_equality",
  // PR3
  "de_defense_posture",
  "de_trade_agreements",
  // PR4
  "de_labor_reform",
  "de_carbon_pricing",
  "de_grundgesetz_reform",
  "de_electoral_reform",
  "de_government_ethics",
  "de_press_freedom",
]);

const INVERTED_COST_IDS = new Set<string>(["de_bundeswehr_funding"]);
const MINIMUM_WAGE_IDS = new Set<string>(["de_minimum_wage"]);

// State-scope types use allowedScope: "state" + nationalOnly: false
// + effectTarget.scope: "state" + chamber: "landtag".
const STATE_SCOPE_IDS = new Set<string>([
  "de_land_education",
  "de_land_police",
  "de_land_culture",
  "de_land_economic_development",
  "de_land_health_services",
  "de_land_municipal_grants",
]);

const VALID_DOMAINS = new Set([
  // PR2
  "healthcare",
  "education",
  "social",
  // PR3
  "defense",
  "foreign_policy",
  "technology",
  "law_justice",
  // PR4
  "labor",
  "economic",
  "infrastructure",
  "environment",
  "agriculture",
  "governance",
  "immigration",
  "mediaInformation",
]);

describe("DE non-tax types — structural (PR2+PR3+PR4+PR5)", () => {
  for (const typeId of ALL_DE_NON_TAX_TYPE_IDS) {
    describe(typeId, () => {
      const type = deLegislationTypes.find((t) => t._id === typeId);

      it("exists in deLegislationTypes", () => {
        expect(type).toBeDefined();
      });

      it("has countryScope=de", () => {
        expect(type!.countryScope).toBe("de");
      });

      it("has 7 policy options", () => {
        expect(type!.policyOptions!).toHaveLength(7);
      });

      it("has exactly one center option at index 3", () => {
        const centers = type!.policyOptions!.filter((o) => o.stance === "center");
        expect(centers).toHaveLength(1);
        expect(type!.policyOptions![3].stance).toBe("center");
      });

      it("has valid policyDomain", () => {
        expect(VALID_DOMAINS.has(type!.policyDomain!)).toBe(true);
      });

      it("has effectTargetsWeighted with primary |weight| = 1.0", () => {
        expect(type!.effectTargetsWeighted).toBeDefined();
        expect(type!.effectTargetsWeighted!.length).toBeGreaterThan(0);
        expect(Math.abs(type!.effectTargetsWeighted![0].weight)).toBe(1.0);
      });

      it("is marked as seed and permanent", () => {
        expect(type!.source).toBe("seed");
        expect(type!.isPermanent).toBe(true);
      });

      if (STATE_SCOPE_IDS.has(typeId)) {
        it("has allowedScope=state, nationalOnly=false", () => {
          expect(type!.allowedScope).toBe("state");
          expect(type!.nationalOnly).toBe(false);
        });
        it("effectTarget.scope=state", () => {
          expect(type!.effectTarget?.scope).toBe("state");
        });
        it("positions use chamber=landtag", () => {
          expect(type!.positions).toBeDefined();
          expect(type!.positions!.length).toBeGreaterThan(0);
          for (const pos of type!.positions!) {
            expect(pos.chamber).toBe("landtag");
          }
        });
      } else {
        it("is nationalOnly", () => {
          expect(type!.nationalOnly).toBe(true);
        });
      }

      if (MINIMUM_WAGE_IDS.has(typeId)) {
        it("has minimumWageRate on every option (no annualCostPerCapita)", () => {
          for (const opt of type!.policyOptions!) {
            expect(opt.minimumWageRate).toBeDefined();
            expect(typeof opt.minimumWageRate).toBe("number");
            expect(opt.annualCostPerCapita).toBeUndefined();
          }
        });
        it("minimum wage option 0 = €0/hr (abolition), option 6 > option 0", () => {
          expect(type!.policyOptions![0].minimumWageRate).toBe(0);
          expect(type!.policyOptions![6].minimumWageRate!).toBeGreaterThan(
            type!.policyOptions![0].minimumWageRate!
          );
        });
      } else if (POSTURE_ONLY_IDS.has(typeId)) {
        it("posture-only: no annualCostPerCapita on options", () => {
          for (const opt of type!.policyOptions!) {
            expect(opt.annualCostPerCapita).toBeUndefined();
          }
        });
      } else {
        it("has annualCostPerCapita on every option", () => {
          for (const opt of type!.policyOptions!) {
            expect(opt.annualCostPerCapita).toBeDefined();
            expect(typeof opt.annualCostPerCapita).toBe("number");
          }
        });

        if (INVERTED_COST_IDS.has(typeId)) {
          it("inverted ladder: option 0 cost < option 6 cost (ascending)", () => {
            expect(type!.policyOptions![0].annualCostPerCapita!).toBeLessThan(
              type!.policyOptions![6].annualCostPerCapita!
            );
          });
        } else {
          it("rightmost option (index 6) is €0/cap (full elimination posture)", () => {
            expect(type!.policyOptions![6].annualCostPerCapita).toBe(0);
          });
        }
      }

      it("has a base policy default in COUNTRY_POLICY_CONFIGS.de.defaults", () => {
        const def = COUNTRY_POLICY_CONFIGS.de.defaults[typeId];
        expect(def).toBeDefined();
        expect(typeof def!.economic).toBe("number");
        expect(typeof def!.social).toBe("number");
      });

      it("base-default optionIndex (if set) is in [0, 6]", () => {
        const idx = COUNTRY_POLICY_CONFIGS.de.optionIndexes?.[typeId];
        if (idx !== undefined) {
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeLessThanOrEqual(6);
        }
      });
    });
  }
});
