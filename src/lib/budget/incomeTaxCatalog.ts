/**
 * Income-tax provisions. Each existing income-tax law supplies three independently
 * adjustable provisions; the historical law remains available for old bills.
 */
import type { LegislationType } from "@/lib/db/types/legislation";
import { INCOME_TIERS, INCOME_TAX_KEYS, INCOME_TIER_LABELS } from "./rules/incomeTaxTiers";
export const INCOME_TAX_SUFFIX = "__income_";
export function legacyIncomeTaxId(id: string): string {
  return id.split(INCOME_TAX_SUFFIX)[0];
}
export function isLegacyIncomeTax(
  type: Pick<LegislationType, "taxRateChange" | "taxSlider">
): boolean {
  return (type.taxSlider ?? type.taxRateChange)?.taxType === "incomeTax";
}
export function expandIncomeTaxTypes(types: readonly LegislationType[]): LegislationType[] {
  const ids = new Set(types.map((type) => type._id));
  return types.flatMap((type) => {
    if (!isLegacyIncomeTax(type)) return [type];
    const change = type.taxSlider ?? type.taxRateChange!;
    return [
      type,
      ...INCOME_TIERS.filter((tier) => !ids.has(type._id + INCOME_TAX_SUFFIX + tier)).map(
        (tier) => ({
          ...type,
          _id: type._id + INCOME_TAX_SUFFIX + tier,
          name: INCOME_TIER_LABELS[tier] + " Tax",
          description:
            "Adjust the income-tax rate for the " +
            INCOME_TIER_LABELS[tier].toLowerCase() +
            " group separately.",
          taxRateChange: { scope: change.scope, taxType: INCOME_TAX_KEYS[tier] },
          taxSlider: type.taxSlider
            ? { ...type.taxSlider, taxType: INCOME_TAX_KEYS[tier] }
            : undefined,
          // Keep the old policy as the legacy metric baseline. Tier changes affect revenue
          // without tripling the old law's economic, spending, or demographic effects.
          effectTarget: undefined,
          effectTargets: undefined,
          effectTargetsWeighted: undefined,
          demographicEffects: undefined,
          demographicTargeting: undefined,
          policyOptions: type.policyOptions?.map((option) => ({ ...option, budgetCost: 0 })),
        })
      ),
    ];
  });
}
