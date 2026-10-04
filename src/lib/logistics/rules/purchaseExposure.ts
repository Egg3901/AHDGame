/**
 * Delivered buyer-use exposure. It divides each accepted purchase among the
 * modeled household, production-input, and residual demand cohorts by their
 * shares of state commodity demand.
 */
import type { CommodityType } from "@/lib/constants/commodities";

export type PurchaseUse = "householdFinal" | "productionInput" | "other";

export interface DemandUseAmounts {
  householdFinal: number;
  productionInput: number;
}

export interface PurchaseUseShares {
  householdFinal: number;
  productionInput: number;
  other: number;
}

export interface PurchaseExposure {
  domesticUnits: number;
  domesticPreDutyValue: number;
  importUnits: number;
  importPreDutyValue: number;
  /** Actual border duty, assessed on dispatched units. */
  tariffPaid: number;
  /** Duty apportioned to delivered units, for buyer absorption comparisons. */
  deliveredTariffPaid: number;
}

export type DemandUsesByState = ReadonlyMap<string, ReadonlyMap<CommodityType, DemandUseAmounts>>;

export type PurchaseExposureByCountry = Map<
  string,
  Map<CommodityType, Record<PurchaseUse, PurchaseExposure>>
>;

const positiveFinite = (value: number | undefined): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;

/** Normalize modeled demand cohorts against the final state demand balance. */
export function purchaseUseShares(
  totalDemand: number,
  modeled: DemandUseAmounts | undefined
): PurchaseUseShares {
  const total = positiveFinite(totalDemand);
  if (total <= 0) return { householdFinal: 0, productionInput: 0, other: 1 };
  const household = positiveFinite(modeled?.householdFinal);
  const production = positiveFinite(modeled?.productionInput);
  const known = household + production;
  const scale = known > total && known > 0 ? total / known : 1;
  const householdShare = (household * scale) / total;
  const productionShare = (production * scale) / total;
  return {
    householdFinal: householdShare,
    productionInput: productionShare,
    other: Math.max(0, 1 - householdShare - productionShare),
  };
}

export function emptyPurchaseExposure(): Record<PurchaseUse, PurchaseExposure> {
  const empty = (): PurchaseExposure => ({
    domesticUnits: 0,
    domesticPreDutyValue: 0,
    importUnits: 0,
    importPreDutyValue: 0,
    tariffPaid: 0,
    deliveredTariffPaid: 0,
  });
  return { householdFinal: empty(), productionInput: empty(), other: empty() };
}

/** Add an accepted purchase using the same proportional cohort split for each source. */
export function addPurchaseExposure(
  target: Record<PurchaseUse, PurchaseExposure>,
  shares: PurchaseUseShares,
  purchase: {
    units: number;
    preDutyValue: number;
    tariffPaid: number;
    deliveredTariffPaid: number;
    imported: boolean;
  }
): void {
  for (const use of ["householdFinal", "productionInput", "other"] as const) {
    const share = shares[use];
    if (!(share > 0)) continue;
    const row = target[use];
    if (purchase.imported) {
      row.importUnits += purchase.units * share;
      row.importPreDutyValue += purchase.preDutyValue * share;
      row.tariffPaid += purchase.tariffPaid * share;
      row.deliveredTariffPaid += purchase.deliveredTariffPaid * share;
    } else {
      row.domesticUnits += purchase.units * share;
      row.domesticPreDutyValue += purchase.preDutyValue * share;
    }
  }
}

/** Build stable country/commodity purchase exposure from per-destination rows. */
export function summarizePurchaseExposureByCountry(
  states: ReadonlyArray<{ stateId: string; countryId: string }>,
  perState: ReadonlyMap<string, ReadonlyMap<CommodityType, Record<PurchaseUse, PurchaseExposure>>>
): PurchaseExposureByCountry {
  const countryByState = new Map(states.map(({ stateId, countryId }) => [stateId, countryId]));
  const result: PurchaseExposureByCountry = new Map();
  for (const [stateId, byCommodity] of perState) {
    const countryId = countryByState.get(stateId);
    if (!countryId) continue;
    let country = result.get(countryId);
    if (!country) result.set(countryId, (country = new Map()));
    for (const [commodity, uses] of byCommodity) {
      let totals = country.get(commodity);
      if (!totals) country.set(commodity, (totals = emptyPurchaseExposure()));
      for (const use of ["householdFinal", "productionInput", "other"] as const) {
        const source = uses[use];
        const target = totals[use];
        target.domesticUnits += source.domesticUnits;
        target.domesticPreDutyValue += source.domesticPreDutyValue;
        target.importUnits += source.importUnits;
        target.importPreDutyValue += source.importPreDutyValue;
        target.tariffPaid += source.tariffPaid;
        target.deliveredTariffPaid += source.deliveredTariffPaid;
      }
    }
  }
  return result;
}
