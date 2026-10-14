import { calibrationMultiplier, type CommodityType } from "@/lib/constants/commodities";
import type { CountryLedger, GlobalLedger, StateLedger } from "../ledgerTypes";

export const GOVERNMENT_DEMAND_SUPPLY_CAP = 1.5;

/**
 * Healthcare clears in the state where care is provided. Its final-demand cap
 * must use that same book's supply, not an older world total. Otherwise a
 * hospital's reduced run lowers the next demand cap, even after production has
 * recovered, and fresh clearing feeds the artificial glut back into production.
 * Keep the existing 1.5x ceiling and household priority. Record all removed
 * demand in calibrated units so latent need remains visible. Zero-supply books
 * stay uncapped, matching the existing bootstrap behavior.
 */
export function capHealthcareDemandToLocalSupply(args: {
  global: GlobalLedger;
  byCountry: CountryLedger;
  byState: StateLedger;
  stateToCountry: ReadonlyMap<string, string>;
  householdDemandByState: Map<string, Map<CommodityType, number>>;
  truncated: Map<CommodityType, number>;
  /** Existing demand outside household and government buyers is unchanged. */
  otherDemandByState?: ReadonlyMap<string, number>;
  demandCalibration?: (commodity: CommodityType) => number;
  /** Shared ceiling multiple (default GOVERNMENT_DEMAND_SUPPLY_CAP). */
  supplyCapMultiple?: number;
}): void {
  const commodity: CommodityType = "healthcare_services";
  const capMultiple = args.supplyCapMultiple ?? GOVERNMENT_DEMAND_SUPPLY_CAP;
  const calibration = calibrationMultiplier(args.demandCalibration, commodity);
  for (const [stateId, balances] of args.byState) {
    const balance = balances.get(commodity);
    if (!balance || !(Number.isFinite(balance.supply) && balance.supply > 0)) continue;
    const cap = (balance.supply * capMultiple) / calibration;
    const otherDemand = args.otherDemandByState?.get(stateId) ?? 0;
    const finalDemand = balance.demand - otherDemand;
    if (!(finalDemand > cap)) continue;
    const removed = finalDemand - cap;
    balance.demand -= removed;
    args.global.get(commodity)!.demand -= removed;
    const countryId = args.stateToCountry.get(stateId);
    const country = countryId ? args.byCountry.get(countryId)?.get(commodity) : undefined;
    if (country) country.demand -= removed;
    const household = args.householdDemandByState.get(stateId);
    const householdUnits = household?.get(commodity);
    if (householdUnits != null && householdUnits > cap) household!.set(commodity, cap);
    args.truncated.set(commodity, (args.truncated.get(commodity) ?? 0) + removed * calibration);
  }
}

/** Healthcare's shared ceiling is applied later, against its local clearing book. */
export function globalDemandCapSupply(
  supply: ReadonlyMap<CommodityType, number>
): Map<CommodityType, number> {
  const result = new Map(supply);
  result.delete("healthcare_services");
  return result;
}
