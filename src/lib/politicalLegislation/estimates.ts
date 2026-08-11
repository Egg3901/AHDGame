/**
 * Live fiscal-estimate payloads for new-generation legislation (spec §8).
 * One shared attachment used by the legislation-types API (propose modal),
 * the bill-detail surface, and the metrics dashboard.
 */

import type { Db } from "mongodb";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { LegislationType } from "@/lib/db/types/legislation";
import { computeLawCost, type FiscalBase } from "./costEngine";
import { countryFiscalBase, regionFiscalBase } from "./fiscalBase";
import { isNewGenerationType } from "./project";
import type { LawCountryId } from "./types";

export interface LawLevelEstimate {
  level: 0 | 1 | 2 | 3 | 4;
  cost: number;
  revenue: number;
  net: number;
}

export interface TaxSliderEstimate {
  minRate: number;
  maxRate: number;
  step: number;
  baselineRate: number;
  currentRate: number;
  waypoints: Array<{ rate: number; label: string }>;
  /** Annual revenue change per +1 rate point (tax base ÷ 100), local currency. */
  revenueDeltaPerPoint: number;
}

/** FederalTaxBases key per FederalTaxRates key (revenue = rate% × base). */
export const TAX_BASE_KEY: Record<string, keyof NonNullable<FederalBudget["taxBases"]>> = {
  incomeTax: "taxableIncome",
  domesticCorporateTax: "domesticCorporateProfits",
  foreignCorporateTax: "foreignCorporateProfits",
  payrollTax: "wagesAndSalaries",
  tariffs: "importValue",
  salesTax: "taxableSales",
};

import { POLITICAL_LEGISLATION_EXCLUDED_SCOPES as NEW_GENERATION_COUNTRIES } from "@/lib/politicalMetrics/pipelinePreset";

/**
 * Attach `estimates` (program laws) / `taxSlider` (slider laws, with the live
 * current rate + per-point revenue delta) to every new-generation doc in the
 * list. Non-new-generation docs pass through untouched. `regionId` prices at
 * that region's scope (regional proposals); national rollup otherwise.
 */
export async function attachPoliticalLegislationEstimates(
  db: Db,
  docs: Array<Record<string, unknown>>,
  country: string | null | undefined,
  regionId: string | null | undefined,
  incomeBandIndexByCountry: Partial<Record<string, number>> | null
): Promise<Array<Record<string, unknown>>> {
  const cc = (country ?? "us").toLowerCase();
  if (!NEW_GENERATION_COUNTRIES.has(cc)) return docs;
  const countryId = cc.toUpperCase() as LawCountryId;
  const hasNewGeneration = docs.some((d) => isNewGenerationType(d as unknown as LegislationType));
  if (!hasNewGeneration) return docs;

  const base: FiscalBase = regionId
    ? await regionFiscalBase(db, regionId)
    : await countryFiscalBase(db, countryId);
  const bandIndex = incomeBandIndexByCountry?.[countryId] ?? null;
  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: getNationalBudgetId(countryId) }, { projection: { taxRates: 1, taxBases: 1 } });

  return docs.map((doc) => {
    const lt = doc as unknown as LegislationType;
    if (!isNewGenerationType(lt)) return doc;

    if (lt.taxSlider) {
      const currentRate =
        (budget?.taxRates as Record<string, number> | undefined)?.[lt.taxSlider.taxType] ??
        lt.taxSlider.baselineRate;
      const baseKey = TAX_BASE_KEY[lt.taxSlider.taxType];
      const taxBase = baseKey ? (budget?.taxBases?.[baseKey] ?? 0) : 0;
      const estimate: TaxSliderEstimate = {
        minRate: lt.taxSlider.minRate,
        maxRate: lt.taxSlider.maxRate,
        step: lt.taxSlider.step,
        baselineRate: lt.taxSlider.baselineRate,
        currentRate,
        waypoints: lt.taxSlider.waypoints,
        revenueDeltaPerPoint: taxBase / 100,
      };
      return { ...doc, taxSliderEstimate: estimate };
    }

    const estimates: LawLevelEstimate[] = (lt.policyOptions ?? []).map((option, index) => {
      const fiscal = computeLawCost(
        { name: "", description: "", ...(option.costModelV2 ?? {}) },
        base,
        countryId,
        bandIndex
      );
      return {
        level: index as LawLevelEstimate["level"],
        cost: fiscal.cost,
        revenue: fiscal.revenue,
        net: fiscal.net,
      };
    });
    // GDP at the priced scope, so the propose modal can annotate costs as %GDP.
    return { ...doc, estimates, estimatesGdp: base.gdp };
  });
}
