/**
 * Tariff CPI exposure uses settled import duties over matched domestic and
 * imported purchases for household and production-input demand cohorts.
 */

export const TARIFF_INFLATION_BASELINE = 3;

export interface TariffPurchaseUseExposure {
  domesticPreDutyValue: number;
  importPreDutyValue: number;
  /** Duty settled at the border, including units lost in transit. */
  tariffPaid: number;
  /** Duty apportioned to delivered units after route loss. */
  deliveredTariffPaid: number;
}

export interface TariffPurchaseExposure {
  householdFinal: TariffPurchaseUseExposure;
  productionInput: TariffPurchaseUseExposure;
}

export interface TariffInflationExposureResult {
  /** Legacy-compatible rate input: baseline plus observed duty incidence. */
  tariffRate: number;
  /** True means the current turn's sourcing pass produced a measured record. */
  available: boolean;
  householdAbsorptionValue: number;
  householdImportValue: number;
  householdTariffPaid: number;
  householdDeliveredTariffPaid: number;
  productionInputAbsorptionValue: number;
  productionInputImportValue: number;
  productionInputTariffPaid: number;
  productionInputDeliveredTariffPaid: number;
  importShare: number;
  productionInputImportShare: number;
}

export type TariffExposureMode = "active_delivered" | "shadow_simulated" | "unavailable";

export interface PersistedTariffUseExposure extends TariffPurchaseUseExposure {
  domesticUnits: number;
  importUnits: number;
}

export interface TariffExposureSourceRow {
  turn: number;
  commodity: string;
  purchaseExposureBasis?: string;
  purchaseExposureMode?: "active_delivered" | "shadow_simulated";
  purchaseExposureCoverageCountries?: string[];
  purchaseExposureByCountry?: Record<
    string,
    Partial<Record<"householdFinal" | "productionInput", PersistedTariffUseExposure>>
  >;
}

export interface CountryTariffInflationExposure extends TariffInflationExposureResult {
  coveredCommodities: string[];
  mode: TariffExposureMode;
}

export interface TurnTariffInflationExposure {
  turn: number;
  available: boolean;
  mode: TariffExposureMode;
  byCountry: Map<string, CountryTariffInflationExposure>;
}

const finiteNonnegative = (value: number | undefined): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;

const validAmount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const validPurchaseUse = (value: TariffPurchaseUseExposure): boolean =>
  validAmount(value.domesticPreDutyValue) &&
  validAmount(value.importPreDutyValue) &&
  validAmount(value.tariffPaid) &&
  validAmount(value.deliveredTariffPaid);

const validPersistedUse = (value: unknown): value is PersistedTariffUseExposure => {
  if (!value || typeof value !== "object") return false;
  const use = value as Record<string, unknown>;
  return (
    validAmount(use.domesticUnits) &&
    validAmount(use.importUnits) &&
    validAmount(use.domesticPreDutyValue) &&
    validAmount(use.importPreDutyValue) &&
    validAmount(use.tariffPaid) &&
    validAmount(use.deliveredTariffPaid)
  );
};

/** Sum bounded commodity purchase summaries without treating missing values as data. */
export function combineTariffPurchaseExposure(
  rows: readonly TariffPurchaseExposure[]
): TariffPurchaseExposure {
  const total = (): TariffPurchaseUseExposure => ({
    domesticPreDutyValue: 0,
    importPreDutyValue: 0,
    tariffPaid: 0,
    deliveredTariffPaid: 0,
  });
  const combined: TariffPurchaseExposure = {
    householdFinal: total(),
    productionInput: total(),
  };
  for (const row of rows) {
    for (const use of ["householdFinal", "productionInput"] as const) {
      combined[use].domesticPreDutyValue += finiteNonnegative(row[use].domesticPreDutyValue);
      combined[use].importPreDutyValue += finiteNonnegative(row[use].importPreDutyValue);
      combined[use].tariffPaid += finiteNonnegative(row[use].tariffPaid);
      combined[use].deliveredTariffPaid += finiteNonnegative(row[use].deliveredTariffPaid);
    }
  }
  return combined;
}

/**
 * Preserve the authored 3% no-change baseline on exposed imports. Only the
 * delivered-duty difference from baseline contributes to household CPI.
 */
export function tariffInflationExposure(
  exposure: TariffPurchaseExposure | undefined,
  available: boolean
): TariffInflationExposureResult {
  const measured =
    available &&
    exposure != null &&
    validPurchaseUse(exposure.householdFinal) &&
    validPurchaseUse(exposure.productionInput);
  let householdAbsorptionValue = 0;
  let householdImportValue = 0;
  let householdTariffPaid = 0;
  let householdDeliveredTariffPaid = 0;
  let productionInputAbsorptionValue = 0;
  let productionInputImportValue = 0;
  let productionInputTariffPaid = 0;
  let productionInputDeliveredTariffPaid = 0;
  if (measured && exposure) {
    const household = exposure.householdFinal;
    const production = exposure.productionInput;
    householdAbsorptionValue =
      finiteNonnegative(household.domesticPreDutyValue) +
      finiteNonnegative(household.importPreDutyValue);
    householdImportValue = finiteNonnegative(household.importPreDutyValue);
    householdTariffPaid = finiteNonnegative(household.tariffPaid);
    householdDeliveredTariffPaid = finiteNonnegative(household.deliveredTariffPaid);
    productionInputAbsorptionValue =
      finiteNonnegative(production.domesticPreDutyValue) +
      finiteNonnegative(production.importPreDutyValue);
    productionInputImportValue = finiteNonnegative(production.importPreDutyValue);
    productionInputTariffPaid = finiteNonnegative(production.tariffPaid);
    productionInputDeliveredTariffPaid = finiteNonnegative(production.deliveredTariffPaid);
  }
  const importShare =
    householdAbsorptionValue > 0 ? householdImportValue / householdAbsorptionValue : 0;
  const productionInputImportShare =
    productionInputAbsorptionValue > 0
      ? productionInputImportValue / productionInputAbsorptionValue
      : 0;
  const netBurdenRate =
    householdAbsorptionValue > 0
      ? ((householdDeliveredTariffPaid - (householdImportValue * TARIFF_INFLATION_BASELINE) / 100) /
          householdAbsorptionValue) *
        100
      : 0;
  return {
    tariffRate: Number.isFinite(netBurdenRate)
      ? TARIFF_INFLATION_BASELINE + netBurdenRate
      : TARIFF_INFLATION_BASELINE,
    available: measured,
    householdAbsorptionValue,
    householdImportValue,
    householdTariffPaid,
    householdDeliveredTariffPaid,
    productionInputAbsorptionValue,
    productionInputImportValue,
    productionInputTariffPaid,
    productionInputDeliveredTariffPaid,
    importShare: Number.isFinite(importShare) ? importShare : 0,
    productionInputImportShare: Number.isFinite(productionInputImportShare)
      ? productionInputImportShare
      : 0,
  };
}

/**
 * Qualify a projected same-turn sourcing roster and aggregate only complete,
 * finite country records. This portable rule performs no reads or writes.
 */
export function qualifyTariffExposureRows(
  rows: readonly TariffExposureSourceRow[],
  requestedTurn: number,
  expectedCommodityRoster: readonly string[]
): TurnTariffInflationExposure {
  const unavailable = (mode: TariffExposureMode = "unavailable"): TurnTariffInflationExposure => ({
    turn: requestedTurn,
    available: false,
    mode,
    byCountry: new Map(),
  });
  const allShadow =
    rows.length > 0 && rows.every((row) => row.purchaseExposureMode === "shadow_simulated");
  const allActive =
    rows.length > 0 && rows.every((row) => row.purchaseExposureMode === "active_delivered");
  const mode: TariffExposureMode = allShadow
    ? "shadow_simulated"
    : allActive
      ? "active_delivered"
      : "unavailable";
  if (mode === "unavailable") return unavailable();

  const expected = new Set(expectedCommodityRoster);
  const observed = new Set(rows.map((row) => row.commodity));
  const completeRoster =
    expected.size > 0 &&
    expected.size === expectedCommodityRoster.length &&
    rows.length === expected.size &&
    observed.size === expected.size &&
    rows.every(
      (row) =>
        row.turn === requestedTurn &&
        expected.has(row.commodity) &&
        row.purchaseExposureBasis === "proportional_modeled_demand_uses_v1" &&
        Array.isArray(row.purchaseExposureCoverageCountries) &&
        row.purchaseExposureCoverageCountries.every(
          (countryId) => typeof countryId === "string" && countryId.length > 0
        ) &&
        new Set(row.purchaseExposureCoverageCountries).size ===
          row.purchaseExposureCoverageCountries.length &&
        row.purchaseExposureByCountry != null
    );
  if (!completeRoster) return unavailable();
  if (mode === "shadow_simulated") return unavailable(mode);

  const countryIds = new Set(rows.flatMap((row) => row.purchaseExposureCoverageCountries ?? []));
  const byCountry = new Map<string, CountryTariffInflationExposure>();
  for (const countryId of countryIds) {
    const purchaseRows: TariffPurchaseExposure[] = [];
    const countryComplete = rows.every((row) => {
      if (!row.purchaseExposureCoverageCountries?.includes(countryId)) return false;
      const uses = row.purchaseExposureByCountry?.[countryId];
      if (
        !uses ||
        !validPersistedUse(uses.householdFinal) ||
        !validPersistedUse(uses.productionInput)
      ) {
        return false;
      }
      purchaseRows.push({
        householdFinal: uses.householdFinal,
        productionInput: uses.productionInput,
      });
      return true;
    });
    if (!countryComplete || purchaseRows.length !== expected.size) continue;
    const incidence = tariffInflationExposure(combineTariffPurchaseExposure(purchaseRows), true);
    if (!incidence.available) continue;
    byCountry.set(countryId, {
      ...incidence,
      coveredCommodities: [...expected].sort(),
      mode,
    });
  }
  if (byCountry.size === 0) return unavailable();
  return { turn: requestedTurn, available: true, mode, byCountry };
}

/** Resolve a country from a qualified snapshot while preserving measured zero. */
export function countryTurnTariffInflationExposure(
  snapshot: TurnTariffInflationExposure,
  countryId: string
): CountryTariffInflationExposure {
  return (
    snapshot.byCountry.get(countryId) ?? {
      ...tariffInflationExposure(undefined, false),
      coveredCommodities: [],
      mode: snapshot.mode === "shadow_simulated" ? "shadow_simulated" : "unavailable",
    }
  );
}

/**
 * CPI tariff input for one country. Only a measured sourcing record overrides
 * the legacy tariff, sector and FTA calculation. Unavailable and shadow
 * exposure carry a baseline placeholder rate, so they return undefined and the
 * inflation model keeps its own tariff pressure.
 */
export function measuredTariffInflationRate(
  exposure: Pick<TariffInflationExposureResult, "available" | "tariffRate">
): number | undefined {
  return exposure.available ? exposure.tariffRate : undefined;
}
