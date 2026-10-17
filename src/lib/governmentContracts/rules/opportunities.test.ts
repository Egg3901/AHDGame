import { describe, it, expect } from "vitest";
import { hasTenderOpportunity } from "./opportunities";
import type { TenderTerms } from "../types";
const extraction = {
  type: "extraction",
  stateId: "TX",
  minimumSigningFeeAnchor: 100,
} as TenderTerms;
const base: Parameters<typeof hasTenderOpportunity>[0] = {
  terms: extraction,
  countryId: "US",
  corporation: { type: "extraction", countryId: "US" },
  sectors: [{ stateId: "TX", sectorType: "extraction", revenue: 100, strategyId: "standard" }],
  year: 1994,
  maximumGrade: 3,
  anchor: 1000,
  ratios: new Map(),
  procurementNotional: 1e6,
  supplierAmount: 0,
  stateOwned: false,
};
describe("tender discovery eligibility", () => {
  it("requires an extraction company operating in the concession state", () => {
    expect(hasTenderOpportunity(base)).toBe(true);
    expect(hasTenderOpportunity({ ...base, sectors: [] })).toBe(false);
    expect(
      hasTenderOpportunity({ ...base, sectors: [{ ...base.sectors[0], stateId: "CA" }] })
    ).toBe(false);
    expect(
      hasTenderOpportunity({ ...base, corporation: { type: "financial", countryId: "US" } })
    ).toBe(false);
  });
  it("uses the existing domestic defence plant, grade, price and supplier limits", () => {
    const input: Parameters<typeof hasTenderOpportunity>[0] = {
      ...base,
      terms: {
        type: "defence",
        component: "ground",
        lots: 1,
        grade: 0,
        maximumPricePerLot: 1000,
      } as TenderTerms,
      corporation: { type: "defense", countryId: "US", liquidCurrencyCode: "USD" },
      sectors: [{ ...base.sectors[0], sectorType: "defense" }],
    };
    expect(hasTenderOpportunity(input)).toBe(true);
    expect(
      hasTenderOpportunity({ ...input, corporation: { ...input.corporation, countryId: "JP" } })
    ).toBe(false);
    expect(
      hasTenderOpportunity({
        ...input,
        corporation: { ...input.corporation, liquidCurrencyCode: "JPY" },
      })
    ).toBe(false);
    expect(hasTenderOpportunity({ ...input, supplierAmount: 1e6 })).toBe(false);
    expect(hasTenderOpportunity({ ...input, anchor: null })).toBe(false);
    expect(
      hasTenderOpportunity({
        ...input,
        terms: { ...input.terms, maximumPricePerLot: 1 } as TenderTerms,
      })
    ).toBe(false);
    expect(
      hasTenderOpportunity({
        ...input,
        terms: { ...input.terms, grade: 3 } as TenderTerms,
        maximumGrade: 0,
      })
    ).toBe(false);
  });
});
