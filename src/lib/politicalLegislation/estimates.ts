/**
 * Live fiscal-estimate payloads for new-generation legislation (spec §8).
 * One shared attachment used by the legislation-types API (propose modal),
 * the bill-detail surface, and the metrics dashboard.
 */

import type { Db } from "mongodb";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { FederalBudget, StateBudget, StateTaxBases } from "@/lib/db/types/budget";
import type { LegislationType } from "@/lib/db/types/legislation";
import { computeLawCost, type FiscalBase } from "./costEngine";
import { countryFiscalBase, regionFiscalBase } from "./fiscalBase";
import { isNewGenerationType } from "./project";
import type { LawCountryId } from "./types";
import { taxRateBoundsFromExistingOptions } from "@/lib/resetLegislation/rules/taxRate";

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

/** State-budget taxBases keys for regional tax sliders (ticket #1106). */
export const STATE_TAX_BASE_KEY: Record<string, keyof StateTaxBases> = {
  incomeTax: "taxableIncome",
  domesticCorporateTax: "domesticCorporateProfits",
  foreignCorporateTax: "foreignCorporateProfits",
  salesTax: "taxableSales",
  propertyTax: "propertyValue",
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
  incomeBandIndexByCountry: Partial<Record<string, number>> | null,
  includeLegacyExactTaxes = false
): Promise<Array<Record<string, unknown>>> {
  const cc = (country ?? "us").toLowerCase();
  if (!NEW_GENERATION_COUNTRIES.has(cc) && !includeLegacyExactTaxes) return docs;
  const countryId = cc.toUpperCase() as LawCountryId;
  const hasNewGeneration = docs.some((d) => isNewGenerationType(d as unknown as LegislationType));
  const hasLegacyExactTax =
    includeLegacyExactTaxes &&
    docs.some((doc) => {
      const type = doc as unknown as LegislationType;
      return !type.taxSlider && Boolean(type.taxRateChange) && Boolean(type.policyOptions?.length);
    });
  if (!hasNewGeneration && !hasLegacyExactTax) return docs;

  const base: FiscalBase | null = hasNewGeneration
    ? regionId
      ? await regionFiscalBase(db, regionId)
      : await countryFiscalBase(db, countryId)
    : null;
  const bandIndex = incomeBandIndexByCountry?.[countryId] ?? null;
  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: getNationalBudgetId(countryId) }, { projection: { taxRates: 1, taxBases: 1 } });
  const hasStateSlider = docs.some((d) => {
    const lt = d as unknown as LegislationType;
    return Boolean(
      (lt.taxSlider && lt.taxSlider.scope === "state") ||
      (includeLegacyExactTaxes && lt.taxRateChange?.scope === "state")
    );
  });
  const regionKey = regionId?.trim() ? regionId.trim().toUpperCase() : null;
  const stateBudget =
    regionKey && hasStateSlider
      ? await db
          .collection<StateBudget>("stateBudgets")
          .findOne(
            { _id: regionKey, countryId: countryId as StateBudget["countryId"] },
            { projection: { taxRates: 1, taxBases: 1 } }
          )
      : null;

  return docs.map((doc) => {
    const lt = doc as unknown as LegislationType;
    if (!isNewGenerationType(lt)) {
      if (!includeLegacyExactTaxes || !lt.taxRateChange || !lt.policyOptions?.length) return doc;
      let bounds;
      try {
        bounds = taxRateBoundsFromExistingOptions(lt.policyOptions);
      } catch {
        return doc;
      }
      if (lt.taxRateChange.scope === "state" && stateBudget == null) return doc;
      const useStateBudget = lt.taxRateChange.scope === "state" && stateBudget != null;
      const rates = useStateBudget ? stateBudget.taxRates : budget?.taxRates;
      const currentRate = (rates as unknown as Record<string, unknown> | undefined)?.[
        lt.taxRateChange.taxType
      ];
      if (typeof currentRate !== "number" || !Number.isFinite(currentRate)) return doc;
      const stateBaseKey = STATE_TAX_BASE_KEY[lt.taxRateChange.taxType];
      const federalBaseKey = TAX_BASE_KEY[lt.taxRateChange.taxType];
      const taxBase = useStateBudget
        ? stateBaseKey
          ? (stateBudget.taxBases?.[stateBaseKey] ?? 0)
          : 0
        : federalBaseKey
          ? (budget?.taxBases?.[federalBaseKey] ?? 0)
          : 0;
      const estimate: TaxSliderEstimate = {
        minRate: bounds.min,
        maxRate: bounds.max,
        step: bounds.step,
        baselineRate: currentRate,
        currentRate,
        waypoints: lt.policyOptions
          .filter((option): option is typeof option & { rate: number } =>
            Number.isFinite(option.rate)
          )
          .map((option) => ({ rate: option.rate, label: option.name })),
        revenueDeltaPerPoint: taxBase / 100,
      };
      return { ...doc, taxSliderEstimate: estimate };
    }

    if (lt.taxSlider) {
      const useStateBudget = lt.taxSlider.scope === "state" && stateBudget != null;
      const currentRate = useStateBudget
        ? ((stateBudget.taxRates as unknown as Record<string, number> | undefined)?.[
            lt.taxSlider.taxType
          ] ?? lt.taxSlider.baselineRate)
        : ((budget?.taxRates as Record<string, number> | undefined)?.[lt.taxSlider.taxType] ??
          lt.taxSlider.baselineRate);
      const stateBaseKey = STATE_TAX_BASE_KEY[lt.taxSlider.taxType];
      const federalBaseKey = TAX_BASE_KEY[lt.taxSlider.taxType];
      const taxBase = useStateBudget
        ? stateBaseKey
          ? (stateBudget.taxBases?.[stateBaseKey] ?? 0)
          : 0
        : federalBaseKey
          ? (budget?.taxBases?.[federalBaseKey] ?? 0)
          : 0;
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
        base!,
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
    return { ...doc, estimates, estimatesGdp: base!.gdp };
  });
}
