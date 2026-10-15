/**
 * Income-tax policy rates. Seed records follow the budget's enacted target,
 * or its effective rate when no phase-in is pending; existing fiscal rates stay unchanged.
 */
export const INCOME_TAX_POLICY_JURISDICTIONS = [
  { countryId: "BR", stateId: "br_national", legislationTypeId: "br_income_tax_rate" },
  { countryId: "NG", stateId: "ng_national", legislationTypeId: "ng_personal_income_tax" },
] as const;

export function incomeTaxPolicyOptionId(input: {
  currentOptionId?: string;
  options: readonly { id: string; rate?: number }[];
  effectiveRate: number | undefined;
  pendingRate?: number;
}): string | undefined {
  const target = input.pendingRate ?? input.effectiveRate;
  if (typeof target !== "number" || !Number.isFinite(target) || target < 0 || target > 100)
    return undefined;
  const currentRate = input.currentOptionId?.startsWith("rate:")
    ? Number(input.currentOptionId.slice(5))
    : input.options.find((option) => option.id === input.currentOptionId)?.rate;
  // Preserve the existing option and its ideological metadata whenever it agrees.
  return currentRate === target ? input.currentOptionId : `rate:${target}`;
}

/** Exact fiscal rates retain the original ladder option for non-fiscal metric effects. */
export function incomeTaxEffectOptionId(input: {
  legislationTypeId: string;
  policyOptionId: string;
  policyOptionIndex: number;
  options: readonly { id: string }[];
}): string {
  if (
    input.policyOptionId.startsWith("rate:") &&
    INCOME_TAX_POLICY_JURISDICTIONS.some(
      (entry) => entry.legislationTypeId === input.legislationTypeId
    )
  )
    return input.options[input.policyOptionIndex]?.id ?? input.policyOptionId;
  return input.policyOptionId;
}
