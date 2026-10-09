import type { Db } from "mongodb";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { CountryId } from "@/lib/constants/countries";
import type { FederalBudget, StateBudget } from "@/lib/db/types/budget";
import type { LegislationType } from "@/lib/db/types/legislation";
import {
  resolveTaxSliderProvisionFields,
  taxSliderNpcEconomic,
  taxSliderPolicyOptionId,
  taxSliderRateLabel,
  type ResolvedTaxSliderFields,
} from "@/lib/politicalLegislation/taxSlider";
import type { ResetCountry } from "./fundingOwner";
import { resetTaxesFor, type TaxScope } from "./taxCatalog";
import { taxRateBoundsFromExistingOptions, validateExactTaxRate } from "./rules/taxRate";

/**
 * Resolve an exact-rate tax provision offered by the reviewed legislation
 * wizard. US and UK use new-generation sliders; JP and IE retain their
 * established tax legislation types, whose authored rate options define the
 * legal bounds for a continuous exact-rate proposal.
 */
export async function resolveResetTaxProvisionFields(
  db: Db,
  legislationType: LegislationType,
  proposedRate: number | undefined,
  policyOptionId: string | undefined,
  countryId: ResetCountry,
  scope: TaxScope,
  regionId?: string
): Promise<ResolvedTaxSliderFields> {
  const definition = resetTaxesFor(countryId, scope).find(
    (tax) => tax.existingLegislationTypeId === legislationType._id
  );
  if (!definition) {
    return { ok: false, error: "This tax instrument is unavailable in this jurisdiction." };
  }

  const expectedScope: "state" | "federal" = scope === "regional" ? "state" : "federal";
  if (legislationType.taxSlider) {
    if (
      legislationType.taxSlider.scope !== expectedScope ||
      legislationType.taxSlider.taxType !== definition.taxType
    ) {
      return { ok: false, error: "This tax instrument has incompatible rate metadata." };
    }
    return resolveTaxSliderProvisionFields(
      db,
      legislationType,
      proposedRate,
      policyOptionId,
      countryId,
      scope === "regional" ? regionId : undefined
    );
  }

  if (
    !legislationType.taxRateChange ||
    legislationType.taxRateChange.scope !== expectedScope ||
    legislationType.taxRateChange.taxType !== definition.taxType
  ) {
    return { ok: false, error: "This tax instrument has incompatible rate metadata." };
  }

  let bounds;
  try {
    bounds = taxRateBoundsFromExistingOptions(legislationType.policyOptions ?? []);
  } catch {
    return { ok: false, error: "This tax instrument has no valid rate range." };
  }

  const currentRate = await loadCurrentRate(db, countryId, scope, definition.taxType, regionId);
  if (currentRate === null) {
    return { ok: false, error: "The current tax rate is unavailable." };
  }
  if (proposedRate === undefined || !Number.isFinite(proposedRate)) {
    return { ok: false, error: "A proposed rate is required for tax legislation." };
  }

  const validation = validateExactTaxRate(currentRate, proposedRate, bounds);
  if (!validation.allowed) {
    return {
      ok: false,
      error:
        validation.reason === "unchanged"
          ? "The proposal must change the current tax rate."
          : `The proposed rate must be between ${bounds.min} and ${bounds.max}, in steps of ${bounds.step}.`,
    };
  }

  const sliderShape = {
    minRate: bounds.min,
    maxRate: bounds.max,
    step: bounds.step,
    baselineRate: currentRate,
    waypoints: [],
    scope: expectedScope,
    taxType: definition.taxType,
  };
  const rate = proposedRate;
  return {
    ok: true,
    fields: {
      proposedRate: rate,
      policyOptionId: taxSliderPolicyOptionId(rate),
      economic: taxSliderNpcEconomic(sliderShape, currentRate, rate),
      social: 0,
      effectDirection: rate > currentRate ? 1 : -1,
      policyOptionNameSnapshot: taxSliderRateLabel(rate),
      currentPolicyOptionNameSnapshot: taxSliderRateLabel(currentRate),
    },
  };
}

async function loadCurrentRate(
  db: Db,
  countryId: ResetCountry,
  scope: TaxScope,
  taxType: string,
  regionId?: string
): Promise<number | null> {
  if (scope === "regional") {
    const normalizedRegionId = regionId?.trim().toUpperCase();
    if (!normalizedRegionId) return null;
    const budget = await db
      .collection<StateBudget>("stateBudgets")
      .findOne(
        { _id: normalizedRegionId, countryId: countryId as StateBudget["countryId"] },
        { projection: { taxRates: 1 } }
      );
    const rate = (budget?.taxRates as unknown as Record<string, unknown> | undefined)?.[taxType];
    return typeof rate === "number" && Number.isFinite(rate) ? rate : null;
  }

  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: getNationalBudgetId(countryId as CountryId) }, { projection: { taxRates: 1 } });
  const rate = (budget?.taxRates as Record<string, unknown> | undefined)?.[taxType];
  return typeof rate === "number" && Number.isFinite(rate) ? rate : null;
}
