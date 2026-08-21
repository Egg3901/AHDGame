import { describe, expect, it } from "vitest";
import type { RegionalBudget } from "@/lib/db/types/regionalBudget";
import { buildRegionalRevenueShape } from "./regionalRevenueShape";

/**
 * The region budget route discriminated its revenue breakdown by which optional
 * field a doc carried, and fell through to the UK shape when none matched. RU
 * regions carry only `unionGrant`, so a Soviet republic rendered as a British
 * council: Council Tax / Business Rates / Westminster grant, all zero, next to a
 * balance computed from the ₽1.5B union grant the branch never read.
 */
function doc(overrides: Partial<RegionalBudget>): RegionalBudget {
  return {
    _id: "X",
    countryId: "UK",
    turn: 1,
    councilTaxRevenue: 0,
    businessRatesRevenue: 0,
    westminsterGrant: 0,
    totalBudget: 0,
    enactedBillCosts: 0,
    surplus: 0,
    isOverBudget: false,
    turnsOverBudget: 0,
    propertyValuePerCapita: 0,
    commercialValuePerCapita: 0,
    propertyValueBaseline: 0,
    commercialValueBaseline: 0,
    chancellorAllocation: null,
    updatedAt: new Date(),
    ...overrides,
  } as RegionalBudget;
}

describe("buildRegionalRevenueShape", () => {
  it("gives an RU republic its union grant, not British council tax", () => {
    const { revenue, grantAmount } = buildRegionalRevenueShape(
      doc({ _id: "FEA", countryId: "RU", unionGrant: 1_541_879_993, totalBudget: 1_541_879_993 })
    );

    expect(grantAmount).toBe(1_541_879_993);
    expect(revenue.total).toBe(1_541_879_993);
    expect(revenue).not.toHaveProperty("councilTax");
    expect(revenue).not.toHaveProperty("businessRates");
  });

  it("keeps the UK shape for a UK region", () => {
    const { revenue, grantAmount } = buildRegionalRevenueShape(
      doc({
        _id: "LON",
        countryId: "UK",
        councilTaxRevenue: 62_300_000,
        businessRatesRevenue: 38_900_000,
        westminsterGrant: 40_000_000,
        totalBudget: 141_200_000,
      })
    );

    expect(revenue).toMatchObject({
      councilTax: 62_300_000,
      businessRates: 38_900_000,
      federalGrants: 40_000_000,
    });
    expect(grantAmount).toBe(40_000_000);
  });

  it("keeps the JP, DE and CN shapes", () => {
    const jp = buildRegionalRevenueShape(
      doc({
        countryId: "JP",
        residentTaxRevenue: 5,
        fixedAssetTaxRevenue: 3,
        nationalGrant: 2,
        totalBudget: 10,
      })
    );
    expect(jp.revenue).toMatchObject({ residentTax: 5, fixedAssetTax: 3, federalGrants: 2 });
    expect(jp.grantAmount).toBe(2);

    const de = buildRegionalRevenueShape(
      doc({
        countryId: "DE",
        incomeTaxShare: 5,
        vatShare: 3,
        federalEqualizationGrant: 2,
        totalBudget: 10,
      })
    );
    expect(de.revenue).toMatchObject({ incomeTaxShare: 5, vatShare: 3, federalGrants: 2 });
    expect(de.grantAmount).toBe(2);

    const cn = buildRegionalRevenueShape(
      doc({ countryId: "CN", eitShare: 5, centralTransferGrant: 2, totalBudget: 10 })
    );
    expect(cn.revenue).toMatchObject({ eitShare: 5, centralTransferGrant: 2 });
    expect(cn.grantAmount).toBe(2);
  });

  it("reports the doc's own total so the revenue card matches the balance", () => {
    // The old UK branch re-summed three UK fields, which reads 0 for any country
    // whose revenue lives elsewhere — the exact mismatch that put £0 revenue
    // beside a positive balance on the RU page.
    for (const d of [
      doc({ countryId: "RU", unionGrant: 900, totalBudget: 900 }),
      doc({
        countryId: "UK",
        councilTaxRevenue: 400,
        businessRatesRevenue: 300,
        westminsterGrant: 200,
        totalBudget: 900,
      }),
      doc({ countryId: "JP", residentTaxRevenue: 900, totalBudget: 900 }),
    ]) {
      expect(buildRegionalRevenueShape(d).revenue.total).toBe(900);
    }
  });
});
