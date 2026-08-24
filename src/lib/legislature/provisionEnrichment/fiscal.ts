import type { Db } from "mongodb";
import type { LegislationType } from "@/lib/db/types";
import type { FederalBudget, StateBudget } from "@/lib/db/types/budget";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { countryFiscalBase, regionFiscalBase } from "@/lib/politicalLegislation/fiscalBase";
import { STATE_TAX_BASE_KEY, TAX_BASE_KEY } from "@/lib/politicalLegislation/estimates";
import { computeLawCost, type FiscalBase } from "@/lib/politicalLegislation/costEngine";
import { COST_INCOME_ANCHORS } from "@/lib/politicalLegislation/costAnchors";
import { isNewGenerationType } from "@/lib/politicalLegislation/project";
import type { LawCountryId } from "@/lib/politicalLegislation/types";
import type { FiscalScope, ProvisionFiscal } from "./types";

/**
 * A provision's fiscal profile, priced at the bill's own scope.
 *
 * Previously national-only, which is why regional bill detail showed no cost or
 * revenue at all. The scope-aware primitives it uses (regionFiscalBase,
 * STATE_TAX_BASE_KEY, the stateBudgets read) are the same ones `estimates.ts`
 * and `billEnactment.ts` already run in production.
 *
 * `bandIndex` is deliberately null, matching what enactment charges
 * (`billEnactment.ts`). The propose modal prices with the real income band and
 * so disagrees with both; reconciling that is balance-adjacent and out of scope
 * here. Do not "fix" it in passing.
 */
export async function resolveProvisionFiscal(
  db: Db,
  scope: FiscalScope,
  lt: LegislationType | null | undefined,
  prov: { proposedRate?: number },
  proposedOptionIndex: number | undefined,
  currentIndex: number | undefined
): Promise<{ fiscal?: ProvisionFiscal }> {
  if (!lt || !isNewGenerationType(lt)) return {};
  if (!(scope.countryId in COST_INCOME_ANCHORS)) return {};
  const countryId = scope.countryId as LawCountryId;
  const currencyCode = COUNTRY_CURRENCY_MAP[countryId];

  if (lt.taxSlider) {
    const proposedRate = prov.proposedRate;
    if (proposedRate === undefined) return {};

    // A state-scope slider prices against the region's own budget; a
    // national-scope slider always prices against the national one, even when
    // the slider appears on a regional bill.
    const useStateBudget = lt.taxSlider.scope === "state" && scope.scope === "region";

    let currentRate: number;
    let taxBase: number;
    if (useStateBudget && scope.scope === "region") {
      const budget = await db
        .collection<StateBudget>("stateBudgets")
        .findOne(
          { _id: scope.regionId, countryId: countryId as StateBudget["countryId"] },
          { projection: { taxRates: 1, taxBases: 1 } }
        );
      currentRate =
        (budget?.taxRates as Record<string, number> | undefined)?.[lt.taxSlider.taxType] ??
        lt.taxSlider.baselineRate;
      const baseKey = STATE_TAX_BASE_KEY[lt.taxSlider.taxType];
      taxBase = baseKey ? (budget?.taxBases?.[baseKey] ?? 0) : 0;
    } else {
      const budget = await db
        .collection<FederalBudget>("federalBudget")
        .findOne(
          { _id: getNationalBudgetId(countryId) },
          { projection: { taxRates: 1, taxBases: 1 } }
        );
      currentRate =
        (budget?.taxRates as Record<string, number> | undefined)?.[lt.taxSlider.taxType] ??
        lt.taxSlider.baselineRate;
      const baseKey = TAX_BASE_KEY[lt.taxSlider.taxType];
      taxBase = baseKey ? (budget?.taxBases?.[baseKey] ?? 0) : 0;
    }

    return {
      fiscal: {
        currencyCode,
        currentRate,
        proposedRate,
        revenueDelta: ((proposedRate - currentRate) * taxBase) / 100,
      },
    };
  }

  if (proposedOptionIndex === undefined) return {};
  const base: FiscalBase =
    scope.scope === "region"
      ? await regionFiscalBase(db, scope.regionId)
      : await countryFiscalBase(db, countryId);

  const priceLevel = (index: number) => {
    const model = lt.policyOptions?.[index]?.costModelV2 ?? {};
    const { cost, revenue, net } = computeLawCost(
      { name: "", description: "", ...model },
      base,
      countryId,
      null
    );
    return { cost, revenue, net };
  };

  const proposed = priceLevel(proposedOptionIndex);
  const current = currentIndex !== undefined ? priceLevel(currentIndex) : undefined;
  return {
    fiscal: {
      currencyCode,
      proposed,
      ...(current && { current }),
      netDelta: proposed.net - (current?.net ?? 0),
    },
  };
}
