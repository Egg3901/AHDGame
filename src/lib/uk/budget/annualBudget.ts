import type { Db } from "mongodb";
import type { BillProvision, FederalBudget } from "@/lib/db/types";
import { getCatalog, getLaw } from "@/lib/politicalLegislation/catalog";
import { getEnactedLevels } from "@/lib/politicalLegislation/enactedLevels";
import { projectLawToLegislationType } from "@/lib/politicalLegislation/project";
import { resolveTaxSliderProvisionFields } from "@/lib/politicalLegislation/taxSlider";
import { countryFiscalBase } from "@/lib/politicalLegislation/fiscalBase";
import { computeLawCost } from "@/lib/politicalLegislation/costEngine";
import { budgetKeyForLaw } from "@/lib/politicalLegislation/budgetKeys";
import { applyEraRevenueCap } from "@/lib/budget/revenue";
import { getEraContext } from "@/lib/era/context";

export interface AnnualBudgetMeasures {
  /** Political-law id to the Chancellor's target effective rate. */
  taxRates: Record<string, number>;
  /** Political-law id to the Chancellor's target statutory programme level. */
  programLevels: Record<string, number>;
}

export type AnnualBudgetProvisionResult =
  { ok: true; provisions: BillProvision[] } | { ok: false; error: string };

export type AnnualBudgetPreviewResult =
  | {
      ok: true;
      current: { revenue: number; spending: number; balance: number };
      projected: { revenue: number; spending: number; balance: number };
      categoryDeltas: Record<string, number>;
      phaseInTurns: number;
    }
  | { ok: false; error: string };

const TAX_BASE_BY_TYPE: Record<string, string> = {
  incomeTax: "taxableIncome",
  domesticCorporateTax: "domesticCorporateProfits",
  foreignCorporateTax: "foreignCorporateProfits",
  payrollTax: "wagesAndSalaries",
  tariffs: "importValue",
  salesTax: "taxableSales",
};

export type AnnualBudgetAuthority = "chancellor" | "acting_pm" | "none";

/** Resolve the one person who may author the Budget at a given moment. */
export function resolveAnnualBudgetAuthority(
  viewerId: string,
  chancellorId: string | null,
  primeMinisterId: string | null
): AnnualBudgetAuthority {
  if (chancellorId === viewerId) return "chancellor";
  if (chancellorId === null && primeMinisterId === viewerId) return "acting_pm";
  return "none";
}

/**
 * Compile a Chancellor's annual package into the same policy provisions used by
 * ordinary bills. This is the authority seam: the Budget does not write a
 * parallel tax or spending ledger, so later ordinary laws and later Budgets
 * supersede one another through the existing enactment rules.
 */
export async function buildAnnualBudgetProvisions(
  db: Db,
  measures: AnnualBudgetMeasures
): Promise<AnnualBudgetProvisionResult> {
  const ukLaws = getCatalog("UK");
  const taxLaws = new Map(ukLaws.filter((law) => law.kind === "tax").map((law) => [law.id, law]));
  const currentBudget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: "UK" }, { projection: { taxRates: 1 } });

  const provisions: BillProvision[] = [];
  for (const [lawId, targetRate] of Object.entries(measures.taxRates)) {
    const law = taxLaws.get(lawId);
    if (!law?.taxPolicy) return { ok: false, error: `Unknown UK tax measure: ${lawId}.` };
    const currentRate =
      (currentBudget?.taxRates as unknown as Record<string, number> | undefined)?.[
        law.taxPolicy.taxType
      ] ?? law.taxPolicy.baselineRate;
    if (Math.abs(targetRate - currentRate) < 1e-9) continue;

    const resolved = await resolveTaxSliderProvisionFields(
      db,
      projectLawToLegislationType(law),
      targetRate,
      undefined,
      "UK"
    );
    if (!resolved.ok) return resolved;
    provisions.push({ legislationTypeId: law.id, ...resolved.fields });
  }

  const currentLevels = await getEnactedLevels(db, "UK");
  for (const [lawId, targetLevel] of Object.entries(measures.programLevels)) {
    const law = getLaw(lawId);
    if (!law || law.countryId !== "UK" || law.kind === "tax" || law.allowedScope === "regional") {
      return { ok: false, error: `Unknown UK national programme: ${lawId}.` };
    }
    if (!Number.isInteger(targetLevel) || targetLevel < 0 || targetLevel > 4) {
      return { ok: false, error: `${law.title} level must be between 0 and 4.` };
    }
    if (currentLevels.get(lawId) === targetLevel) continue;

    const legislationType = projectLawToLegislationType(law);
    const option = legislationType.policyOptions?.[targetLevel];
    if (!option) return { ok: false, error: `${law.title} has no level ${targetLevel}.` };
    provisions.push({
      legislationTypeId: law.id,
      policyOptionId: option.id,
      policyOptionNameSnapshot: option.name,
      policyOptionExplanationSnapshot: option.explanation,
      effectDirection: option.effectDirection,
      economic: option.economic,
      social: option.social,
    });
  }

  if (provisions.length === 0) {
    return { ok: false, error: "The Budget must change at least one tax or programme." };
  }
  return { ok: true, provisions };
}

/** Forecast the exact fiscal measures compiled by `buildAnnualBudgetProvisions`. */
export async function previewAnnualBudget(
  db: Db,
  measures: AnnualBudgetMeasures
): Promise<AnnualBudgetPreviewResult> {
  const compiled = await buildAnnualBudgetProvisions(db, measures);
  if (!compiled.ok) return compiled;

  const [budget, currentLevels, fiscalBase, eraContext] = await Promise.all([
    db.collection<FederalBudget>("federalBudget").findOne({ _id: "UK" }),
    getEnactedLevels(db, "UK"),
    countryFiscalBase(db, "UK"),
    getEraContext(db).catch(() => null),
  ]);
  if (!budget) return { ok: false, error: "The UK fiscal ledger is unavailable." };

  let taxLikeDelta = 0;
  let phaseInTurns = 0;
  for (const [lawId, targetRate] of Object.entries(measures.taxRates)) {
    const law = getLaw(lawId);
    if (!law?.taxPolicy) continue;
    const currentRate =
      (budget.taxRates as unknown as Record<string, number>)[law.taxPolicy.taxType] ??
      law.taxPolicy.baselineRate;
    if (Math.abs(targetRate - currentRate) < 1e-9) continue;
    const baseKey = TAX_BASE_BY_TYPE[law.taxPolicy.taxType];
    const taxBase = baseKey
      ? ((budget.taxBases as unknown as Record<string, number> | undefined)?.[baseKey] ?? 0)
      : 0;
    taxLikeDelta += ((targetRate - currentRate) * taxBase) / 100;
    phaseInTurns = Math.max(phaseInTurns, Math.ceil(Math.abs(targetRate - currentRate)));
  }

  let spendingDelta = 0;
  let programmeRevenueDelta = 0;
  const categoryDeltas: Record<string, number> = {};
  for (const [lawId, targetLevel] of Object.entries(measures.programLevels)) {
    const law = getLaw(lawId);
    if (!law?.levels || law.kind === "tax") continue;
    const currentLevel = currentLevels.get(lawId) ?? law.baselineLevel ?? 0;
    if (currentLevel === targetLevel) continue;
    const currentFiscal = computeLawCost(law.levels[currentLevel], fiscalBase, "UK", null);
    const targetFiscal = computeLawCost(law.levels[targetLevel], fiscalBase, "UK", null);
    const costDelta = targetFiscal.cost - currentFiscal.cost;
    spendingDelta += costDelta;
    programmeRevenueDelta += targetFiscal.revenue - currentFiscal.revenue;
    const category = budgetKeyForLaw(law);
    categoryDeltas[category] = (categoryDeltas[category] ?? 0) + costDelta;
  }

  const revenue = budget.revenue as FederalBudget["revenue"] & {
    taxLikeRevenue?: number;
    taxLikeRevenueAfterCap?: number;
  };
  const taxLikeBeforeCap =
    revenue.taxLikeRevenue ??
    revenue.total - (revenue.other ?? 0) - (revenue.healthcareIncome ?? 0);
  const taxLikeAfterCap = revenue.taxLikeRevenueAfterCap ?? taxLikeBeforeCap;
  const nonTaxRevenue = revenue.total - taxLikeAfterCap;
  const projectedTaxLikeBeforeCap = taxLikeBeforeCap + taxLikeDelta + programmeRevenueDelta;
  const projectedRevenue =
    applyEraRevenueCap(projectedTaxLikeBeforeCap, budget.gdp, eraContext?.year ?? null, "UK") +
    nonTaxRevenue;
  const projectedSpending = budget.spending.total + spendingDelta;

  return {
    ok: true,
    current: {
      revenue: revenue.total,
      spending: budget.spending.total,
      balance: revenue.total - budget.spending.total,
    },
    projected: {
      revenue: projectedRevenue,
      spending: projectedSpending,
      balance: projectedRevenue - projectedSpending,
    },
    categoryDeltas,
    phaseInTurns,
  };
}
