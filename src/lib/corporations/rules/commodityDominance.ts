/**
 * Commodity-level dominance: the build toll and the dumping guard.
 *
 * The per-(state, sectorType) dominance toll in `corporations.ts` measures
 * share of a local headroom pool, discounted by rival density. A conglomerate
 * can sit at a tiny local share of one cell while owning several times the
 * whole world's demand for a commodity, and pays an affordable surcharge to
 * keep building. This module measures the other thing: a firm's potential
 * output of a commodity (owned operating capacity plus queued builds, in
 * commodity units) over what the world actually wants of it.
 *
 * Rules only: plain data in, plain data out. The shell loads documents and
 * demand, this module prices them.
 */
import type { CommodityType } from "@/lib/constants/commodities";
import {
  DUMPING_GUARD_SOLD_SHARE,
  commodityDominanceMultiplier,
} from "@/lib/corporations/rules/commodityDominanceRamp";
import {
  computeSupplierCommodityCapacityUnits,
  type SupplyAgreementCapacitySector,
} from "@/lib/corporations/supplyAgreementCapacity";

export * from "@/lib/corporations/rules/commodityDominanceRamp";

/** A firm's sector for dominance purposes: capacity inputs plus its queue. */
export type CommodityDominanceSector = SupplyAgreementCapacitySector & {
  _id?: { toString(): string } | string | null;
  /** Capacity units still under construction (queued, not yet delivered). */
  queuedUnits?: number | null;
};

export interface CommodityDominanceResult {
  /** Worst potential-output / world-demand ratio across the target's commodities. */
  ratio: number;
  /** The commodity that set the ratio, or null when nothing was measurable. */
  commodity: CommodityType | null;
}

/**
 * Worst potential/demand ratio over `commodities` (the commodities the
 * building sector makes). Potential output of a commodity is the firm's owned
 * operating capacity plus every queued unit, across all its sectors, converted
 * to commodity units through the same chain production uses; `extraUnits` of
 * new capacity are added to `targetSectorId` so one oversized order cannot slip
 * under the ramp. Commodities with no known positive demand are skipped.
 */
export function commodityDominanceRatio(args: {
  sectors: readonly CommodityDominanceSector[];
  commodities: readonly CommodityType[];
  demandOf: (commodity: CommodityType) => number | null | undefined;
  targetSectorId: string;
  extraUnits: number;
  isNatcorp: boolean;
  turn: number;
  currentYear?: number | null;
  commandEconomyEnabled?: boolean | null;
}): CommodityDominanceResult {
  const extra = Number.isFinite(args.extraUnits) ? Math.max(0, args.extraUnits) : 0;
  const withQueue: SupplyAgreementCapacitySector[] = args.sectors.map((s) => {
    const queued = Number.isFinite(s.queuedUnits) ? Math.max(0, s.queuedUnits as number) : 0;
    const isTarget = s._id != null && String(s._id) === args.targetSectorId;
    return { ...s, capitalStock: (s.capitalStock ?? 0) + queued + (isTarget ? extra : 0) };
  });
  let worst: CommodityDominanceResult = { ratio: 0, commodity: null };
  for (const commodity of args.commodities) {
    const demand = args.demandOf(commodity);
    if (typeof demand !== "number" || !Number.isFinite(demand) || !(demand > 0)) continue;
    const potential = computeSupplierCommodityCapacityUnits({
      sectors: withQueue,
      commodity,
      isNatcorp: args.isNatcorp,
      turn: args.turn,
      currentYear: args.currentYear,
      commandEconomyEnabled: args.commandEconomyEnabled,
    });
    const ratio = potential / demand;
    if (ratio > worst.ratio) worst = { ratio, commodity };
  }
  return worst;
}

/** True when `soldUnits` is above {@link DUMPING_GUARD_SOLD_SHARE} of `worldSupply`. */
export function isDumpingGuarded(soldUnits: number, worldSupply: number): boolean {
  if (!(worldSupply > 0) || !Number.isFinite(soldUnits) || !(soldUnits > 0)) return false;
  return soldUnits / worldSupply > DUMPING_GUARD_SOLD_SHARE;
}

/** Posture after the dumping guard: a guarded firm cannot undercut the market. */
export function guardedPricingPosture(posture: number, guarded: boolean): number {
  return guarded ? Math.max(0, posture) : posture;
}
