/**
 * Revenue breakdown for a region's budget page.
 *
 * Each parliamentary country funds its regions differently but persists into one
 * shared `regionalBudgets` collection, so the page needs a per-country view of
 * the same document. This used to live inline in the route as a nested ternary
 * that discriminated on which optional field a doc carried, with the UK shape as
 * the catch-all. RU regions carry only `unionGrant` and matched nothing, so a
 * Soviet republic rendered as a British council — Council Tax, Business Rates
 * and a Westminster grant, all zero — beside a balance computed from the union
 * grant the branch never read. Revenue read three UK fields; the balance read
 * the doc. Same failure shape as the UK regional-revenue bug: one document, two
 * readers, only one of them country-aware.
 *
 * Every branch now reports the document's own `totalBudget` rather than
 * re-summing country-specific fields, so the revenue card cannot disagree with
 * the balance even for a country that has no branch here yet.
 */

import type { RegionalBudget } from "@/lib/db/types/regionalBudget";

export interface RegionalRevenueShape {
  /** Revenue lines for the page, plus the total. Keys are humanized by the UI;
   *  `federalGrants` is relabelled with the country's central-government name. */
  revenue: Record<string, number>;
  /** The central transfer this region received, for the grant breakdown panel. */
  grantAmount: number;
}

export function buildRegionalRevenueShape(regionalBudget: RegionalBudget): RegionalRevenueShape {
  const total = regionalBudget.totalBudget;

  // JP prefectures: local taxation plus the Local Allocation Tax.
  if (regionalBudget.residentTaxRevenue != null) {
    const grantAmount = regionalBudget.nationalGrant ?? 0;
    return {
      revenue: {
        residentTax: regionalBudget.residentTaxRevenue ?? 0,
        fixedAssetTax: regionalBudget.fixedAssetTaxRevenue ?? 0,
        federalGrants: grantAmount,
        total,
      },
      grantAmount,
    };
  }

  // DE Länder: shares of federal income tax and VAT, plus the equalization grant.
  if (regionalBudget.incomeTaxShare != null || regionalBudget.vatShare != null) {
    const grantAmount = regionalBudget.federalEqualizationGrant ?? 0;
    return {
      revenue: {
        incomeTaxShare: regionalBudget.incomeTaxShare ?? 0,
        vatShare: regionalBudget.vatShare ?? 0,
        tradeTaxRevenue: regionalBudget.tradeTaxRevenue ?? 0,
        federalGrants: grantAmount,
        total,
      },
      grantAmount,
    };
  }

  // CN provinces: the local EIT share and standing local taxes, plus transfers.
  if (regionalBudget.eitShare != null || regionalBudget.centralTransferGrant != null) {
    const grantAmount = regionalBudget.centralTransferGrant ?? 0;
    return {
      revenue: {
        eitShare: regionalBudget.eitShare ?? 0,
        centralTransferGrant: grantAmount,
        resourceTaxRevenue: regionalBudget.resourceTaxRevenue ?? 0,
        businessTaxRevenue: regionalBudget.businessTaxRevenue ?? 0,
        total,
      },
      grantAmount,
    };
  }

  // RU republics: no local taxation at all — the whole budget is the union's
  // population-proportional share of the central grants pool.
  if (regionalBudget.unionGrant != null) {
    const grantAmount = regionalBudget.unionGrant;
    return { revenue: { federalGrants: grantAmount, total }, grantAmount };
  }

  // UK regions: council tax, business rates and the Westminster grant.
  return {
    revenue: {
      councilTax: regionalBudget.councilTaxRevenue,
      businessRates: regionalBudget.businessRatesRevenue,
      federalGrants: regionalBudget.westminsterGrant,
      total,
    },
    grantAmount: regionalBudget.westminsterGrant,
  };
}
