import type { CorporationType } from "@/lib/constants/corporations";
import {
  COMMODITY_BASE_PRICES,
  commodityMixWeight,
  embargoSupplyFactorFor,
  plantsCapacityScaledUnits,
  type CommodityType,
} from "@/lib/constants/commodities";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";

/**
 * Sector snapshot the plants-tier supply-agreement capacity check needs.
 * Matches the projection the propose route already loads.
 */
export type SupplyAgreementCapacitySector = {
  sectorType: CorporationType;
  capitalStock?: number | null;
  strategyId?: string | null;
  transitionFromStrategyId?: string | null;
  transitionStartTurn?: number | null;
  mothballed?: boolean | null;
  productionPolicyLevel?: number | null;
  embargoSuspended?: boolean | null;
  embargoExportExposure?: number | null;
};

/**
 * Usable daily output of `commodity` across a supplier's plants, in the same
 * units `volumeCap` is denominated in. Shared by the player propose route and
 * the NPP matcher so the two cannot drift.
 *
 * Mothballed plants contribute nothing. Scaling goes through
 * `plantsCapacityScaledUnits` (production policy, natcorp, embargo) then the
 * canonical mix split, identical to clearing and the world supply ledger. The
 * capacity variant is required here because the input is NAMEPLATE capacity,
 * which has never been through `sectorTurn` and so does not yet carry the
 * production-policy output curve.
 */
export function computeSupplierCommodityCapacityUnits(args: {
  sectors: readonly SupplyAgreementCapacitySector[];
  commodity: CommodityType;
  isNatcorp: boolean;
  turn: number;
}): number {
  let capacityUnits = 0;
  for (const s of args.sectors) {
    if (s.mothballed === true) continue;
    const capacity = typeof s.capitalStock === "number" ? s.capitalStock : 0;
    if (!(capacity > 0)) continue;
    const rates = getEffectiveStrategyRates(
      s.sectorType,
      s.strategyId ?? "standard",
      s.transitionFromStrategyId,
      s.transitionStartTurn,
      args.turn
    );
    const scaled =
      plantsCapacityScaledUnits({
        capacityUnits: capacity,
        isNatcorp: args.isNatcorp,
        productionPolicyLevel: s.productionPolicyLevel,
        embargoSupplyFactor: embargoSupplyFactorFor(s),
      }) ?? 0;
    capacityUnits +=
      scaled * commodityMixWeight(rates.supply ?? {}, COMMODITY_BASE_PRICES, args.commodity);
  }
  return capacityUnits;
}
