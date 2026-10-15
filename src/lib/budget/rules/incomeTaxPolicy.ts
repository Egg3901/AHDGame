/**
 * Income-tax policy rates. Seed records follow the budget's enacted target,
 * or its effective rate when no phase-in is pending: see incomeTaxPolicyOptionId.
 * incomeTaxEffectOptionId preserves the retained option's non-fiscal effects.
 */
export const INCOME_TAX_POLICY_JURISDICTIONS = [
  { countryId: "BR", stateId: "br_national", legislationTypeId: "br_income_tax_rate" },
  { countryId: "NG", stateId: "ng_national", legislationTypeId: "ng_personal_income_tax" },
] as const;

/** Only finite base-ten percentage ids are fiscal rates, including JS notation for tiny rates. */
export function readTaxPolicyRate(id: unknown): number | undefined {
  if (typeof id !== "string" || id.trim() !== id || !/^rate:\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(id))
    return undefined;
  const rate = Number(id.slice(5));
  return Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : undefined;
}

/** Resolve the original effects by id first, then a valid retained ladder position. */
export function incomeTaxEffectOptionIndex(input: {
  policyOptionId?: string | null;
  policyOptionIndex?: number;
  options: readonly { id: string }[];
}): number | undefined {
  const byId = input.options.findIndex((option) => option.id === input.policyOptionId);
  if (byId >= 0) return byId;
  const index = input.policyOptionIndex;
  return typeof index === "number" &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < input.options.length
    ? index
    : undefined;
}

export function incomeTaxPolicyOptionId(input: {
  currentOptionId?: string;
  options: readonly { id: string; rate?: number }[];
  effectiveRate: number | undefined;
  pendingRate?: number;
}): string | undefined {
  const target = input.pendingRate ?? input.effectiveRate;
  if (typeof target !== "number" || !Number.isFinite(target) || target < 0 || target > 100)
    return undefined;
  const currentRate =
    readTaxPolicyRate(input.currentOptionId) ??
    input.options.find((option) => option.id === input.currentOptionId)?.rate;
  // Preserve the existing option and its ideological metadata whenever it agrees.
  return currentRate === target ? input.currentOptionId : `rate:${target}`;
}

/** Exact fiscal rates retain the original ladder option for non-fiscal metric effects. */
export function incomeTaxEffectOptionId(input: {
  legislationTypeId: string;
  policyOptionId?: string | null;
  policyOptionIndex?: number;
  options: readonly { id: string }[];
}): string | undefined {
  if (
    readTaxPolicyRate(input.policyOptionId) !== undefined &&
    INCOME_TAX_POLICY_JURISDICTIONS.some(
      (entry) => entry.legislationTypeId === input.legislationTypeId
    )
  )
    return (
      input.options[incomeTaxEffectOptionIndex(input) ?? -1]?.id ??
      input.policyOptionId ??
      undefined
    );
  return input.policyOptionId ?? undefined;
}

/** Seed-only rate alignment, shared by authored presets and standalone reseeding. */
export function alignIncomeTaxPolicyRecords<
  T extends {
    scope: string;
    stateId?: string;
    legislationTypeId: string;
    policyOptionId?: string;
  },
>(
  records: readonly T[],
  budgets: readonly {
    countryId?: string;
    taxRates?: { incomeTax?: number };
    taxRatePhaseIn?: { incomeTax?: number };
  }[],
  types: readonly { _id: string; policyOptions?: readonly { id: string; rate?: number }[] }[]
): T[] {
  return records.map((record) => {
    const jurisdiction = INCOME_TAX_POLICY_JURISDICTIONS.find(
      (entry) =>
        record.scope === "national" &&
        record.stateId === entry.stateId &&
        record.legislationTypeId === entry.legislationTypeId
    );
    if (!jurisdiction) return record;
    const budget = budgets.find((entry) => entry.countryId === jurisdiction.countryId);
    const type = types.find((entry) => entry._id === jurisdiction.legislationTypeId);
    if (!budget || !type) return record;
    const policyOptionId = incomeTaxPolicyOptionId({
      currentOptionId: record.policyOptionId,
      options: type.policyOptions ?? [],
      effectiveRate: budget.taxRates?.incomeTax,
      pendingRate: budget.taxRatePhaseIn?.incomeTax,
    });
    return policyOptionId ? { ...record, policyOptionId } : record;
  });
}
