/**
 * Sector investment: new expansion costs less and heavy construction completes
 * sooner. Partial mothballing preserves owned plants while reducing active
 * capacity; forecasts account for construction, observed sales and cash costs.
 */

export const COLD_CAPACITY_UPKEEP_FRACTION = 0.05;

export interface SectorInvestmentPolicy {
  expansionCostMultiplier: number;
  heavyBuildTimeMultiplier: number;
}

export const SECTOR_INVESTMENT_POLICY: Readonly<SectorInvestmentPolicy> = {
  expansionCostMultiplier: 0.8,
  heavyBuildTimeMultiplier: 0.5,
};

export function expansionCostMultiplier(
  founding: boolean,
  policy: Readonly<SectorInvestmentPolicy> = SECTOR_INVESTMENT_POLICY
): number {
  return founding ? 1 : policy.expansionCostMultiplier;
}

export function investmentBuildTurns(
  baseTurns: number,
  founding = false,
  policy: Readonly<SectorInvestmentPolicy> = SECTOR_INVESTMENT_POLICY
): number {
  // Founders keep their existing half-duration schedule.
  const multiplier = founding ? 0.5 : baseTurns >= 72 ? policy.heavyBuildTimeMultiplier : 1;
  return Math.max(1, Math.ceil(baseTurns * multiplier));
}

/** Absent fields preserve existing sectors. A full mothball overrides the share. */
export function activeCapacityFraction(sector: {
  mothballed?: boolean;
  activeCapacityPercent?: number;
}): number {
  if (sector.mothballed === true) return 0;
  const percent = sector.activeCapacityPercent;
  return typeof percent === "number" && Number.isFinite(percent)
    ? Math.max(0, Math.min(100, percent)) / 100
    : 1;
}

/** Preserve active physical capacity when a partial plant is folded into another. */
export function mergedActiveCapacityPercent(
  sectors: readonly {
    capitalStock?: number | null;
    mothballed?: boolean | null;
    activeCapacityPercent?: number | null;
  }[]
): number | undefined {
  // Legacy all-or-nothing transfers retain their existing behavior.
  if (!sectors.some((sector) => sector.activeCapacityPercent != null)) return undefined;
  let capacity = 0;
  let active = 0;
  for (const sector of sectors) {
    const units = Number.isFinite(sector.capitalStock) ? Math.max(0, sector.capitalStock ?? 0) : 0;
    capacity += units;
    active +=
      units *
      activeCapacityFraction({
        mothballed: sector.mothballed ?? false,
        activeCapacityPercent: sector.activeCapacityPercent ?? undefined,
      });
  }
  return capacity > 0 ? (active / capacity) * 100 : 100;
}

/** Cold capacity is maintained separately from owner-idle active capacity. */
export function capacityUpkeepUnits(input: {
  capacity: number;
  activeFraction: number;
  ownerIdleActiveUnits: number;
  idleFraction: number;
  coldFraction: number;
  ramp: number;
}): number {
  const capacity = Math.max(0, input.capacity);
  const active = Math.max(0, Math.min(1, input.activeFraction));
  return (
    capacity * (1 - active) * input.coldFraction +
    Math.min(capacity * active, Math.max(0, input.ownerIdleActiveUnits)) *
      input.idleFraction *
      Math.max(0, Math.min(1, input.ramp))
  );
}

export interface InvestmentForecastInput {
  units: number;
  constructionPerUnitAnchor: number;
  chargedPerUnitAnchor: number;
  buildTurns: number;
  depreciationPerTurn: number;
  turnsPerDay: number;
  capacityUnits: number;
  activeFraction: number;
  producedUnits: number;
  soldUnits: number;
  demandGapUnits: number;
  revenueDailyAnchor: number;
  operatingCostDailyAnchor: number;
  overheadDailyAnchor: number;
  upkeepDailyAnchor: number;
  taxRatePercent: number;
}

export interface InvestmentHorizon {
  turns: number;
  deliveredUnits: number;
  soldUnitsDaily: number;
  operatingCashAnchor: number;
  overheadAnchor: number;
  taxAnchor: number;
  replacementReserveAnchor: number;
  availableCashAnchor: number;
  cashReturnPercent: number;
  unreturnedCashAnchor: number;
  remainingPaidBasisAnchor: number;
}

/**
 * Fixed-price, fixed-demand scenario, not a prediction of future clearing.
 * Revenue already includes observed unsold output. Never apply fill twice.
 * Replacement is a cash reserve, not a second purchase or saleable asset.
 */
export function forecastSectorInvestment(
  input: InvestmentForecastInput
): InvestmentHorizon[] | null {
  if (
    !Object.values(input).every(Number.isFinite) ||
    input.units <= 0 ||
    input.chargedPerUnitAnchor <= 0 ||
    input.buildTurns < 1 ||
    input.turnsPerDay <= 0 ||
    input.producedUnits <= 0 ||
    input.capacityUnits <= 0 ||
    input.activeFraction <= 0
  )
    return null;

  const cost = input.units * input.chargedPerUnitAnchor;
  const utilization = input.producedUnits / input.capacityUnits;
  const upkeepPerCapacityUnit = Math.max(0, input.upkeepDailyAnchor) / input.capacityUnits;
  const fill = Math.max(0, Math.min(1, input.soldUnits / input.producedUnits));
  const receiptPerProduced = input.revenueDailyAnchor / input.producedUnits;
  const operatingPerProduced = input.operatingCostDailyAnchor / input.producedUnits;
  const overheadPerProduced = Math.max(0, input.overheadDailyAnchor) / input.producedUnits;
  const taxRate = Math.max(0, Math.min(100, input.taxRatePercent)) / 100;
  const depreciation = Math.max(0, Math.min(1, input.depreciationPerTurn));
  const horizons: InvestmentHorizon[] = [];
  let capacity = 0;
  let operatingCashAnchor = 0;
  let overheadAnchor = 0;
  let taxAnchor = 0;
  let replacementReserveAnchor = 0;
  for (let turn = 1; turn <= 192; turn++) {
    const deliveredFraction = Math.min(1, turn / input.buildTurns);
    const priorFraction = Math.min(1, (turn - 1) / input.buildTurns);
    capacity = (capacity + input.units * (deliveredFraction - priorFraction)) * (1 - depreciation);
    // Keep the observed production pace and bill all of it, including unsold
    // output. Extra buyers cap receipts, never make unwanted output free.
    const produced = capacity * utilization;
    const saleableProduction = Math.min(produced, Math.max(0, input.demandGapUnits));
    const operating =
      (saleableProduction * receiptPerProduced -
        produced * operatingPerProduced -
        capacity * upkeepPerCapacityUnit) /
      input.turnsPerDay;
    const overhead = (produced * overheadPerProduced) / input.turnsPerDay;
    operatingCashAnchor += operating;
    overheadAnchor += overhead;
    taxAnchor += Math.max(0, operating - overhead) * taxRate;
    replacementReserveAnchor += capacity * depreciation * input.chargedPerUnitAnchor;
    if (turn === 48 || turn === 96 || turn === 192) {
      const availableCashAnchor =
        operatingCashAnchor - overheadAnchor - taxAnchor - replacementReserveAnchor;
      horizons.push({
        turns: turn,
        deliveredUnits: capacity,
        soldUnitsDaily: saleableProduction * fill,
        operatingCashAnchor,
        overheadAnchor,
        taxAnchor,
        replacementReserveAnchor,
        availableCashAnchor,
        cashReturnPercent: (availableCashAnchor / cost) * 100,
        unreturnedCashAnchor: cost - availableCashAnchor,
        remainingPaidBasisAnchor:
          (capacity + input.units * (1 - deliveredFraction)) * input.constructionPerUnitAnchor,
      });
    }
  }
  return horizons;
}
