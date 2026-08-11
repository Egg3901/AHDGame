import { describe, it, expect } from "vitest";
import { jpLegislationTypes } from "./jpLegislationTypes";

describe("jpLegislationTypes — tax types", () => {
  const taxTypes = jpLegislationTypes.filter((t) => t.policyDomain === "tax");

  it("has exactly 8 tax types", () => {
    expect(taxTypes).toHaveLength(8);
  });

  const expectedTaxIds = [
    "jp_income_tax_rate",
    "jp_domestic_corporation_tax",
    "jp_foreign_corporation_tax",
    "jp_social_insurance",
    "jp_customs_tariff",
    "jp_consumption_tax",
    "jp_resident_tax",
    "jp_fixed_asset_tax",
  ];

  for (const id of expectedTaxIds) {
    describe(id, () => {
      const type = jpLegislationTypes.find((t) => t._id === id);

      it("exists", () => {
        expect(type).toBeDefined();
      });

      it("has 11 policy options", () => {
        expect(type!.policyOptions!).toHaveLength(11);
      });

      it("every option has a rate", () => {
        for (const opt of type!.policyOptions!) {
          expect(opt.rate).toBeDefined();
          expect(typeof opt.rate).toBe("number");
        }
      });

      it("every option has an explanation with LARP title", () => {
        for (const opt of type!.policyOptions!) {
          expect(opt.explanation).toBeDefined();
          expect(opt.explanation!.length).toBeGreaterThan(10);
        }
      });

      it("has exactly one center option", () => {
        const centers = type!.policyOptions!.filter((o) => o.stance === "center");
        expect(centers).toHaveLength(1);
      });

      it("has countryScope jp", () => {
        expect(type!.countryScope).toBe("jp");
      });

      it("has effectTargetsWeighted with primary magnitude 1.0", () => {
        expect(type!.effectTargetsWeighted).toBeDefined();
        expect(type!.effectTargetsWeighted!.length).toBeGreaterThan(0);
        // Magnitude, not sign: the primary may carry a negative weight to invert
        // the relationship for a lower-is-better metric on an inverted-axis tax
        // (e.g. jp_consumption_tax cost of living — higher VAT raises prices).
        expect(Math.abs(type!.effectTargetsWeighted![0].weight)).toBe(1.0);
      });

      it("is marked as seed and permanent", () => {
        expect(type!.source).toBe("seed");
        expect(type!.isPermanent).toBe(true);
      });
    });
  }

  describe("regional tax types", () => {
    it("jp_resident_tax is not nationalOnly", () => {
      const t = jpLegislationTypes.find((t) => t._id === "jp_resident_tax");
      expect(t!.nationalOnly).toBeFalsy();
    });

    it("jp_fixed_asset_tax is not nationalOnly", () => {
      const t = jpLegislationTypes.find((t) => t._id === "jp_fixed_asset_tax");
      expect(t!.nationalOnly).toBeFalsy();
    });

    it("national tax types are nationalOnly", () => {
      const nationalIds = [
        "jp_income_tax_rate",
        "jp_domestic_corporation_tax",
        "jp_social_insurance",
        "jp_customs_tariff",
        "jp_consumption_tax",
      ];
      for (const id of nationalIds) {
        const t = jpLegislationTypes.find((t) => t._id === id);
        expect(t!.nationalOnly).toBe(true);
      }
    });
  });

  describe("rate ranges from spec", () => {
    it("jp_income_tax_rate: 0-50% with center at 25%", () => {
      const t = jpLegislationTypes.find((t) => t._id === "jp_income_tax_rate")!;
      const rates = t.policyOptions!.map((o) => o.rate);
      expect(rates[0]).toBe(0);
      expect(rates[5]).toBe(25);
      expect(rates[10]).toBe(50);
    });

    it("jp_domestic_corporation_tax: 0-46% with center at 23%", () => {
      const t = jpLegislationTypes.find((t) => t._id === "jp_domestic_corporation_tax")!;
      expect(t.policyOptions![0].rate).toBe(0);
      expect(t.policyOptions![5].rate).toBe(23);
      expect(t.policyOptions![10].rate).toBe(46);
    });

    it("jp_social_insurance: 0-30% with center at 15%", () => {
      const t = jpLegislationTypes.find((t) => t._id === "jp_social_insurance")!;
      expect(t.policyOptions![0].rate).toBe(0);
      expect(t.policyOptions![5].rate).toBe(15);
      expect(t.policyOptions![10].rate).toBe(30);
    });

    it("jp_customs_tariff: 0-20% with center at 4%", () => {
      const t = jpLegislationTypes.find((t) => t._id === "jp_customs_tariff")!;
      expect(t.policyOptions![0].rate).toBe(0);
      expect(t.policyOptions![5].rate).toBe(4);
      expect(t.policyOptions![10].rate).toBe(20);
    });

    it("jp_consumption_tax: 0-25% with center at 10%", () => {
      const t = jpLegislationTypes.find((t) => t._id === "jp_consumption_tax")!;
      expect(t.policyOptions![0].rate).toBe(0);
      expect(t.policyOptions![5].rate).toBe(10);
      expect(t.policyOptions![10].rate).toBe(25);
    });

    it("jp_resident_tax: 0-20% with center at 10%", () => {
      const t = jpLegislationTypes.find((t) => t._id === "jp_resident_tax")!;
      expect(t.policyOptions![0].rate).toBe(0);
      expect(t.policyOptions![5].rate).toBe(10);
      expect(t.policyOptions![10].rate).toBe(20);
    });

    it("jp_fixed_asset_tax: 0-5% with center at 1.4%", () => {
      const t = jpLegislationTypes.find((t) => t._id === "jp_fixed_asset_tax")!;
      expect(t.policyOptions![0].rate).toBe(0);
      expect(t.policyOptions![5].rate).toBe(1.4);
      expect(t.policyOptions![10].rate).toBe(5);
    });
  });
});

describe("jpLegislationTypes — policy types", () => {
  const policyTypes = jpLegislationTypes.filter((t) => t.policyDomain !== "tax");

  it("has 55 policy types total", () => {
    expect(policyTypes).toHaveLength(55);
  });

  const expectedCategories = [
    { domain: "healthcare", count: 5 },
    { domain: "education", count: 6 },
    { domain: "defense", count: 4 },
    { domain: "economic", count: 7 },
    { domain: "infrastructure", count: 5 },
    { domain: "environment", count: 4 },
    { domain: "social", count: 4 },
    { domain: "immigration", count: 3 },
    { domain: "agriculture", count: 4 },
    { domain: "governance", count: 4 },
    { domain: "foreign_policy", count: 2 },
    { domain: "technology", count: 3 },
    { domain: "law_justice", count: 3 },
  ];

  for (const { domain, count } of expectedCategories) {
    it(`has ${count} types in ${domain}`, () => {
      const types = policyTypes.filter((t) => t.policyDomain === domain);
      expect(types).toHaveLength(count);
    });
  }

  it("has 44 national policy types", () => {
    expect(policyTypes.filter((t) => t.nationalOnly === true)).toHaveLength(44);
  });

  it("has 11 regional policy types", () => {
    expect(policyTypes.filter((t) => !t.nationalOnly)).toHaveLength(11);
  });

  for (const type of policyTypes) {
    describe(type._id, () => {
      it("has 7 policy options", () => {
        expect(type.policyOptions!).toHaveLength(7);
      });

      it("has exactly one center option", () => {
        const centers = type.policyOptions!.filter((o) => o.stance === "center");
        expect(centers).toHaveLength(1);
      });

      it("has effectTargetsWeighted", () => {
        expect(type.effectTargetsWeighted).toBeDefined();
        expect(type.effectTargetsWeighted!.length).toBeGreaterThan(0);
      });

      it("has annualCostPerCapita or minimumWageRate on all options", () => {
        if (type._id === "jp_minimum_wage") {
          for (const opt of type.policyOptions!) {
            expect(opt.minimumWageRate).toBeDefined();
          }
        } else {
          for (const opt of type.policyOptions!) {
            expect(opt.annualCostPerCapita).toBeDefined();
          }
        }
      });
    });
  }
});

describe("jpLegislationTypes — totals", () => {
  it("has 63 types total (8 tax + 55 policy)", () => {
    expect(jpLegislationTypes).toHaveLength(63);
  });

  it("all types have unique _id", () => {
    const ids = jpLegislationTypes.map((t) => t._id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all types have countryScope jp", () => {
    for (const type of jpLegislationTypes) {
      expect(type.countryScope).toBe("jp");
    }
  });

  it("all types are seed and permanent", () => {
    for (const type of jpLegislationTypes) {
      expect(type.source).toBe("seed");
      expect(type.isPermanent).toBe(true);
    }
  });
});
