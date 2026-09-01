import type { EnactedLaw } from "@/lib/db/types/budget";
import type { Bill, LegislationPolicyOption, LegislationType } from "@/lib/db/types/legislation";
import { isPolicyProvision } from "@/lib/db/types/legislation";
import type { CountryId } from "@/lib/constants/countries";
import { getCostClass, resolveEraSpendingCost } from "@/lib/era/legislationCostCatalog";
import { computeLawCost } from "@/lib/politicalLegislation/costEngine";
import { COST_INCOME_ANCHORS } from "@/lib/politicalLegislation/costAnchors";
import type { LawCountryId } from "@/lib/politicalLegislation/types";

export interface BudgetCostContext {
  budgetCapacity: number;
  gdp: number;
  population: number;
  countryId?: CountryId | string;
  /** National GDP-per-capita for the cost-scale ramp. Falls back to gdp/population. */
  nationalGdpPerCapita?: number;
  /**
   * Live national median income (local currency) — the era perCapita charge
   * base. Absent ⇒ resolveEraSpendingCost falls back to a share-of-GDP form.
   */
  nationalMedianIncome?: number;
  /**
   * Live era year (Spec B). Non-null ⇒ the era cost forms apply (flag on); null /
   * undefined ⇒ the legacy COST_SCALE_ANCHORS path, byte-identical to pre-Spec-B.
   */
  year?: number | null;
  /**
   * Political-legislation v2 fiscal base (spec §5.1): the REGIONAL-ROLLUP gdp +
   * population for the pricing scope (national = Σ state.gdp via
   * countryFiscalBase; regional = that region's figures). Required whenever a
   * costModelV2 option/law is priced — the plain `gdp` above is the budget-seed
   * GDP, which for the UK diverges from the rollup by ~37% (§4.2 basis note).
   */
  v2Base?: { gdp: number; population: number };
  /** Era income-band index for the v2 income term. Null/absent ⇒ 1.0. */
  incomeBandIndex?: number | null;
}

/**
 * §5.1 dual-path: price a costModelV2 model through the political-legislation
 * cost engine. Throws when the v2 context is missing — a v2 law must never
 * silently misprice through legacy fallbacks.
 */
function v2AnnualCost(
  model: NonNullable<LegislationPolicyOption["costModelV2"]>,
  context: BudgetCostContext
): number {
  const countryId = context.countryId as LawCountryId | undefined;
  if (!context.v2Base || !countryId || !(countryId in COST_INCOME_ANCHORS)) {
    throw new Error(
      `costModelV2 pricing requires v2Base and a political-legislation countryId (got ${String(
        context.countryId
      )})`
    );
  }
  return computeLawCost(
    { name: "", description: "", ...model },
    context.v2Base,
    countryId,
    context.incomeBandIndex
  ).cost;
}

/**
 * Era-B flag-on cost for a spending option/law. Returns undefined when the era
 * path does not apply (flag off, or no typeId threaded) so the caller falls back
 * to the legacy branch. A `none`-class type returns 0 (budget-neutral).
 */
function eraSpendingCost(
  typeId: string | undefined,
  fields: { gdpCostFraction?: number; incomeCostFraction?: number },
  context: BudgetCostContext
): number | undefined {
  if (context.year == null || !Number.isFinite(context.year) || !typeId) return undefined;
  const cls = getCostClass(typeId);
  if (cls === "none") return 0;
  return resolveEraSpendingCost(typeId, fields, {
    countryId: String(context.countryId ?? ""),
    year: context.year,
    gdp: context.gdp,
    population: context.population,
    nationalMedianIncome: context.nationalMedianIncome,
  });
}

interface CostScaleAnchor {
  /** 1991-era seed GDP & population (where scaleLow is calibrated). */
  gdpLow: number;
  popLow: number;
  scaleLow: number;
  /** 2020/2023-era seed GDP & population (where scaleHigh is calibrated). */
  gdpHigh: number;
  popHigh: number;
  scaleHigh: number;
}

/**
 * Per-country cost-scale anchors. Absolute per-capita / per-USD spending-law costs
 * are scaled by a factor that ramps with the in-game economy: at the 1991-era
 * GDP-per-capita the scale equals scaleLow (the old PRE_2000 value), at the
 * 2020/2023-era GDP-per-capita it equals scaleHigh (the old MODERN value), and it
 * interpolates linearly (clamped) in between. This removes the year-2000 step
 * discontinuity and self-corrects to the game's actual nominal-GDP trajectory.
 *
 * gdpLow/popLow/gdpHigh/popHigh are copied from the 1991 and 2020/2023 national
 * budget seed configs in src/lib/seeds/reference/budgets.ts (kept in sync by
 * anchorConsistency.test.ts; costs.ts cannot import budgets.ts — circular). A
 * missing PRE or MOD value in the original tables is represented as scale 1.0
 * (US/UK/DE had both; JP had only MODERN; IE/CN had only PRE_2000; BR had neither).
 */
export const COST_SCALE_ANCHORS: Partial<Record<CountryId, CostScaleAnchor>> = {
  US: {
    gdpLow: 6_200_000_000_000,
    popLow: 252_177_000,
    scaleLow: 0.3,
    gdpHigh: 27_000_000_000_000,
    popHigh: 333_000_000,
    scaleHigh: 1.27,
  },
  UK: {
    gdpLow: 600_000_000_000,
    popLow: 57_500_000,
    scaleLow: 0.31,
    gdpHigh: 2_900_000_000_000,
    popHigh: 68_000_000,
    scaleHigh: 1.05,
  },
  JP: {
    gdpLow: 470_000_000_000_000,
    popLow: 124_000_000,
    scaleLow: 1.0,
    gdpHigh: 550_000_000_000_000,
    popHigh: 126_000_000,
    scaleHigh: 1.09,
  },
  DE: {
    gdpLow: 1_600_000_000_000,
    popLow: 80_000_000,
    scaleLow: 0.65,
    gdpHigh: 4_500_000_000_000,
    popHigh: 84_400_000,
    scaleHigh: 1.97,
  },
  IE: {
    // 24B IEP (own currency, not EUR-converted) — matches the corrected 1991
    // budget seed (src/lib/seeds/reference/budgets.ts), refs #3591.
    gdpLow: 24_000_000_000,
    popLow: 3_525_000,
    scaleLow: 0.2,
    gdpHigh: 500_000_000_000,
    popHigh: 5_100_000,
    scaleHigh: 1.0,
  },
  CN: {
    gdpLow: 2_178_000_000_000,
    popLow: 1_158_000_000,
    scaleLow: 0.02,
    gdpHigh: 126_000_000_000_000,
    popHigh: 1_412_000_000,
    scaleHigh: 1.0,
  },
  // BR had no legacy PRE_2000/MODERN scale entries, which used to be encoded as
  // scaleLow 1.0 — full modern-authored absolute costs charged against the 1991
  // PPP-normalized R$900B economy. scaleLow = gpcLow/gpcHigh ≈ 6,040/50,698 ≈ 0.12
  // shrinks absolute costs to the same proportion of the economy they were
  // authored at; scaleHigh 1.0 matches the other modern-calibrated sides (IE/CN/NG).
  BR: {
    gdpLow: 900_000_000_000,
    popLow: 149_000_000,
    scaleLow: 0.12,
    gdpHigh: 10_900_000_000_000,
    popHigh: 215_000_000,
    scaleHigh: 1.0,
  },
  // NG spending-law per-capita costs are calibrated in 2019 naira (scaleHigh=1).
  // 1991 nominal GDP-per-capita was ~1/27 of 2019 (₦1.8T/95M vs ₦144T/200M, pre-
  // SAP-devaluation naira), so scaleLow tames the absolute costs for the SAP-era
  // budget rather than over-stating a ₦1.8T-GDP economy. gdp/pop mirror the NG
  // 1991 + 2019 seed configs (enforced by anchorConsistency.test.ts).
  NG: {
    gdpLow: 1_800_000_000_000,
    popLow: 95_000_000,
    scaleLow: 0.04,
    gdpHigh: 144_000_000_000_000,
    popHigh: 200_000_000,
    scaleHigh: 1.0,
  },
};

/**
 * GDP-indexed absolute-cost scale. Ramps scaleLow -> scaleHigh as the country's
 * current national GDP-per-capita moves from its 1991-era anchor to its modern
 * anchor, clamped to scaleHigh above the modern anchor. BELOW the 1991 anchor
 * the scale keeps shrinking proportionally with GDP-per-capita (holding the
 * 1991 share of the economy) instead of clamping at scaleLow — clamping charged
 * modern-absolute per-capita costs at the 1991 floor against pre-1991 era
 * economies whose nominal GDP-per-capita is 10-100x smaller, exploding seed
 * spending to 1418% of GDP (UK 1953) / 2638% (IE 1953) / 149% (US 1953)
 * (fiscal audit F-03). At gpc == the 1991 anchor the two forms agree
 * (scaleLow), so 1991+ seeds are unchanged. Returns 1 for countries with no
 * anchor; returns scaleLow when the GDP-per-capita is unavailable.
 */
export function getGdpIndexedCostScale(
  countryId: CountryId | string | null | undefined,
  nationalGdpPerCapita: number | null | undefined
): number {
  if (!countryId) return 1;
  const anchor = COST_SCALE_ANCHORS[countryId as CountryId];
  if (!anchor) return 1;
  if (
    typeof nationalGdpPerCapita !== "number" ||
    !Number.isFinite(nationalGdpPerCapita) ||
    nationalGdpPerCapita <= 0
  ) {
    return anchor.scaleLow;
  }
  const gpcLow = anchor.gdpLow / anchor.popLow;
  const gpcHigh = anchor.gdpHigh / anchor.popHigh;
  if (gpcHigh <= gpcLow) return anchor.scaleLow;
  if (nationalGdpPerCapita < gpcLow) {
    // Pre-1991-era economy: a per-capita cost stays the same SHARE of the
    // economy it was calibrated to at the 1991 anchor (cost/GDP is invariant:
    // cpc x pop x scale / gdp == cpc x scaleLow / gpcLow).
    return anchor.scaleLow * (nationalGdpPerCapita / gpcLow);
  }
  const t = Math.max(0, Math.min(1, (nationalGdpPerCapita - gpcLow) / (gpcHigh - gpcLow)));
  return anchor.scaleLow + t * (anchor.scaleHigh - anchor.scaleLow);
}

/**
 * Resolve the national GDP-per-capita used for the cost-scale ramp. Prefers an
 * explicit context.nationalGdpPerCapita; otherwise falls back to gdp/population
 * (correct for national callers, which pass national gdp + national population).
 */
function resolveCostScaleGpc(context: BudgetCostContext): number | undefined {
  if (typeof context.nationalGdpPerCapita === "number") return context.nationalGdpPerCapita;
  if (context.population > 0 && Number.isFinite(context.gdp))
    return context.gdp / context.population;
  return undefined;
}

function scaleAbsoluteCost(amount: number, context: BudgetCostContext): number {
  return amount * getGdpIndexedCostScale(context.countryId, resolveCostScaleGpc(context));
}

export function calculatePolicyOptionAnnualCost(
  policyOption: LegislationPolicyOption | undefined,
  context: BudgetCostContext,
  typeId?: string
): number | undefined {
  if (!policyOption) return undefined;
  if (policyOption.costModelV2) {
    const prefix = typeId?.split(".")[0]?.toUpperCase();
    const anchorCountryId =
      prefix && prefix in COST_INCOME_ANCHORS ? (prefix as LawCountryId) : undefined;
    return v2AnnualCost(policyOption.costModelV2, {
      ...context,
      countryId: anchorCountryId ?? context.countryId,
    });
  }
  const era = eraSpendingCost(
    typeId,
    {
      gdpCostFraction: policyOption.gdpCostFraction,
      incomeCostFraction: policyOption.incomeCostFraction,
    },
    context
  );
  if (era !== undefined) return era;
  if (policyOption.gdpPerCapitaMultiplier !== undefined) {
    return policyOption.gdpPerCapitaMultiplier * context.gdp;
  }
  if (policyOption.annualCostPerCapita !== undefined) {
    return scaleAbsoluteCost(policyOption.annualCostPerCapita * context.population, context);
  }
  return undefined;
}

export function calculateEnactedLawAnnualCost(law: EnactedLaw, context: BudgetCostContext): number {
  if (law.costModelV2) {
    const prefix = law.legislationTypeId?.split(".")[0]?.toUpperCase();
    const anchorCountryId =
      prefix && prefix in COST_INCOME_ANCHORS ? (prefix as LawCountryId) : undefined;
    return v2AnnualCost(law.costModelV2, {
      ...context,
      countryId: anchorCountryId ?? context.countryId ?? law.countryId,
    });
  }
  const era = eraSpendingCost(
    law.legislationTypeId,
    { gdpCostFraction: law.gdpCostFraction, incomeCostFraction: law.incomeCostFraction },
    { ...context, countryId: context.countryId ?? law.countryId }
  );
  if (era !== undefined) return era;
  if (law.gdpPerCapitaMultiplier !== undefined) {
    return law.gdpPerCapitaMultiplier * context.gdp;
  }
  if (law.annualCostPerCapita !== undefined) {
    return scaleAbsoluteCost(law.annualCostPerCapita * context.population, {
      ...context,
      countryId: context.countryId ?? law.countryId,
    });
  }
  if (law.annualCostUsd !== undefined) {
    return scaleAbsoluteCost(law.annualCostUsd, {
      ...context,
      countryId: context.countryId ?? law.countryId,
    });
  }
  return (law.budgetCost / 100) * context.budgetCapacity;
}

function isBillSelection(
  selection:
    | Pick<Bill, "legislationTypeId" | "effectDirection" | "provisions">
    | {
        legislationTypeId: string;
        policyOptionId?: string;
        effectDirection: number;
      }
): selection is Pick<Bill, "legislationTypeId" | "effectDirection" | "provisions"> {
  return "provisions" in selection;
}

export function getSelectedPolicyOption(
  legislationType: LegislationType,
  selection:
    | Pick<Bill, "legislationTypeId" | "effectDirection" | "provisions">
    | {
        legislationTypeId: string;
        policyOptionId?: string;
        effectDirection: number;
      }
): LegislationPolicyOption | undefined {
  const policyOptions = legislationType.policyOptions ?? [];
  if (policyOptions.length === 0) return undefined;

  const matchingProvision = isBillSelection(selection)
    ? selection.provisions
        ?.filter(isPolicyProvision)
        .find((provision) => provision.legislationTypeId === legislationType._id)
    : undefined;
  let policyOptionId: string | undefined;
  let effectDirection: number | undefined;

  if (isBillSelection(selection)) {
    policyOptionId = matchingProvision?.policyOptionId;
    effectDirection = matchingProvision?.effectDirection;
  } else {
    policyOptionId = selection.policyOptionId;
    effectDirection = selection.effectDirection;
  }

  if (policyOptionId) {
    const selectedById = policyOptions.find((opt) => opt.id === policyOptionId);
    if (selectedById) return selectedById;
  }

  // §10 duplicate-direction guard: the new-generation effectDirection ladder
  // (−1,−1,0,+1,+1) makes direction-only matching ambiguous (levels 0/1 and
  // 3/4 collide). New-generation provisions ALWAYS carry an explicit
  // policyOptionId (validated at propose time) — reaching this fallback for
  // one is an invariant violation; fail loud, never silently mis-select.
  if (policyOptions.some((opt) => opt.costModelV2 !== undefined)) {
    throw new Error(
      `new-generation bill provision for ${legislationType._id} is missing an explicit policyOptionId`
    );
  }

  if (effectDirection === undefined) return undefined;
  return policyOptions.find((opt) => opt.effectDirection === effectDirection);
}
