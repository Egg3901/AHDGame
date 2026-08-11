import { describe, expect, it } from "vitest";
import { ieLegislationTypes } from "./ieLegislationTypes";
import { COUNTRY_POLICY_CONFIGS } from "@/lib/seeds/reference/basePolicies";

const IE_TAX_TYPES = [
  {
    id: "ie_corporate_tax_rate",
    expectedCenter: 3,
    expectedRate: 12.5,
    taxType: "domesticCorporateTax",
  },
  {
    id: "ie_foreign_corporate_tax_rate",
    expectedCenter: 3,
    expectedRate: 12.5,
    taxType: "foreignCorporateTax",
  },
  { id: "ie_income_tax_rate", expectedCenter: 7, expectedRate: 40, taxType: "incomeTax" },
  { id: "ie_usc", expectedCenter: 5, expectedRate: 8, taxType: "universalSocialCharge" },
  { id: "ie_prsi", expectedCenter: 5, expectedRate: 11, taxType: "payrollTax" },
  { id: "ie_vat_rate", expectedCenter: 6, expectedRate: 23, taxType: "salesTax" },
  { id: "ie_customs_tariff_rate", expectedCenter: 0, expectedRate: 0, taxType: "tariffs" },
  {
    id: "ie_local_property_tax",
    expectedCenter: 4,
    expectedRate: 0.18,
    taxType: "propertyTax",
  },
  { id: "ie_stamp_duty", expectedCenter: 3, expectedRate: 2, taxType: "stampDuty" },
  { id: "ie_capital_gains_tax", expectedCenter: 6, expectedRate: 33, taxType: "capitalGainsTax" },
  { id: "ie_excise_duty", expectedCenter: 4, expectedRate: 100, taxType: "exciseDuty" },
] as const;

const IE_NON_TAX_EXISTING = [
  "ie_housing_policy",
  "ie_healthcare_policy",
  "ie_minimum_wage",
  "ie_climate_policy",
];

// PR2 — Health & Education (7 net new types)
const IE_PR2_NEW = [
  "ie_public_health",
  "ie_mental_health",
  "ie_elder_care",
  "ie_education_funding",
  "ie_higher_education",
  "ie_research_science",
  "ie_curriculum_reform",
];

// PR3 — Welfare, Family, Social (7 net new types)
const IE_PR3_NEW = [
  "ie_state_pensions",
  "ie_unemployment_benefits",
  "ie_working_family_payment",
  "ie_parental_leave",
  "ie_childcare_policy",
  "ie_gender_equality",
  "ie_drug_policy",
];

// PR4 — Economy, Labour, Infra (7 net new types; housing + minwage rewritten)
const IE_PR4_NEW = [
  "ie_workers_rights",
  "ie_workforce_development",
  "ie_sme_support",
  "ie_fiscal_stimulus",
  "ie_transport_rail",
  "ie_digital_infrastructure",
  "ie_regional_economic_development",
];

// PR5 — Environment, Agriculture, Rural (5 net new types; climate rewritten)
const IE_PR5_NEW = [
  "ie_renewable_energy_target",
  "ie_agricultural_subsidies",
  "ie_food_security",
  "ie_rural_development",
  "ie_peat_bog_policy",
];

// PR6 — Defence, Foreign Affairs, Justice, Governance (8 net new types)
const IE_PR6_NEW = [
  "ie_defence_spending",
  "ie_neutrality_posture",
  "ie_foreign_aid_diplomacy",
  "ie_cybersecurity",
  "ie_garda_policing",
  "ie_criminal_justice",
  "ie_government_ethics",
  "ie_electoral_reform",
];

// PR7 — Immigration (3 net new types)
const IE_PR7_NEW = ["ie_immigration_asylum", "ie_work_visas", "ie_integration_programs"];

// PR8 — Regional NUTS-III (4 net new state-scoped types)
const IE_PR8_NEW = [
  "ie_regional_health",
  "ie_regional_housing",
  "ie_regional_transport",
  "ie_regional_skills",
];

describe("ieLegislationTypes — PR1 (taxation phase)", () => {
  it("includes all 11 tax + 4 carry-over + 7 PR2 + 7 PR3 + 7 PR4 + 5 PR5 + 8 PR6 + 3 PR7 + 4 PR8 + 2 P6a types", () => {
    const ids = ieLegislationTypes.map((t) => t._id).sort();
    const expected = [
      ...IE_TAX_TYPES.map((t) => t.id),
      ...IE_NON_TAX_EXISTING,
      ...IE_PR2_NEW,
      ...IE_PR3_NEW,
      ...IE_PR4_NEW,
      ...IE_PR5_NEW,
      ...IE_PR6_NEW,
      ...IE_PR7_NEW,
      ...IE_PR8_NEW,
      // P6a axis-metric law homes.
      "ie_defence_recruitment",
      "ie_media_press",
    ].sort();
    expect(ids).toEqual(expected);
  });

  for (const [phase, ids] of [
    ["PR2", IE_PR2_NEW],
    ["PR3", IE_PR3_NEW],
    ["PR4", IE_PR4_NEW],
    ["PR5", IE_PR5_NEW],
    ["PR6", IE_PR6_NEW],
    ["PR7", IE_PR7_NEW],
    ["PR8", IE_PR8_NEW],
  ] as const) {
    describe(`${phase} non-tax types`, () => {
      for (const id of ids) {
        describe(id, () => {
          const t = ieLegislationTypes.find((x) => x._id === id);

          it("exists with countryScope ie", () => {
            expect(t?.countryScope).toBe("ie");
          });

          it("has 7-option policy array", () => {
            expect(t?.policyOptions).toHaveLength(7);
          });

          it("uses dail committee positions only", () => {
            for (const pos of t?.positions ?? []) {
              expect(pos.chamber).toBe("dail");
            }
          });

          it("center option (idx 3) has stance=center", () => {
            expect(t?.policyOptions?.[3]?.stance).toBe("center");
          });
        });
      }
    });
  }

  describe("tax types", () => {
    for (const tax of IE_TAX_TYPES) {
      describe(tax.id, () => {
        const t = ieLegislationTypes.find((x) => x._id === tax.id);

        it("exists", () => {
          expect(t).toBeDefined();
        });

        it("has exactly 11 brackets", () => {
          expect(t?.policyOptions).toHaveLength(11);
        });

        it("has taxRateChange.taxType matching the union", () => {
          expect(t?.taxRateChange?.taxType).toBe(tax.taxType);
          expect(t?.taxRateChange?.scope).toBe("federal");
        });

        it("center option resolves to expected baseline rate", () => {
          const opt = t?.policyOptions?.[tax.expectedCenter];
          expect(opt?.rate).toBe(tax.expectedRate);
        });

        it("countryScope is ie", () => {
          expect(t?.countryScope).toBe("ie");
        });

        it("uses dail committee positions only", () => {
          for (const pos of t?.positions ?? []) {
            expect(pos.chamber).toBe("dail");
          }
        });
      });
    }
  });

  describe("COUNTRY_POLICY_CONFIGS.ie", () => {
    const ieConfig = COUNTRY_POLICY_CONFIGS.ie;

    it("nationalStateId is ie_national", () => {
      expect(ieConfig.nationalStateId).toBe("ie_national");
    });

    it("regions are wired to ieRegions (non-empty)", () => {
      expect(ieConfig.regions.length).toBeGreaterThan(0);
    });

    it("defaults cover all PR1-PR8 type IDs", () => {
      const expectedIds = [
        ...IE_TAX_TYPES.map((t) => t.id),
        ...IE_NON_TAX_EXISTING,
        ...IE_PR2_NEW,
        ...IE_PR3_NEW,
        ...IE_PR4_NEW,
        ...IE_PR5_NEW,
        ...IE_PR6_NEW,
        ...IE_PR7_NEW,
        ...IE_PR8_NEW,
      ];
      for (const id of expectedIds) {
        expect(ieConfig.defaults[id], `defaults missing ${id}`).toBeDefined();
      }
    });

    it("optionIndexes cover all PR2-PR8 non-tax types at idx 3 (center)", () => {
      for (const id of [
        ...IE_PR2_NEW,
        ...IE_PR3_NEW,
        ...IE_PR4_NEW,
        ...IE_PR5_NEW,
        ...IE_PR6_NEW,
        ...IE_PR7_NEW,
        ...IE_PR8_NEW,
      ]) {
        expect(ieConfig.optionIndexes[id]).toBe(3);
      }
      // Rewrites pinned to idx 3 (PR2 healthcare; PR4 housing + minwage; PR5 climate)
      expect(ieConfig.optionIndexes.ie_healthcare_policy).toBe(3);
      expect(ieConfig.optionIndexes.ie_housing_policy).toBe(3);
      expect(ieConfig.optionIndexes.ie_minimum_wage).toBe(3);
      expect(ieConfig.optionIndexes.ie_climate_policy).toBe(3);
    });

    it("optionIndexes for tax types point to in-range option indexes", () => {
      for (const tax of IE_TAX_TYPES) {
        const idx = ieConfig.optionIndexes[tax.id];
        expect(idx).toBe(tax.expectedCenter);
        const t = ieLegislationTypes.find((x) => x._id === tax.id);
        expect(t?.policyOptions?.[idx]).toBeDefined();
      }
    });
  });
});
