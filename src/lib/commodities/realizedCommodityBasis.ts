/**
 * Realized physical-unit basis shared by the commodity market leaderboards
 * (`GET /api/commodities/[type]`) and the corporation commodity detail
 * (`GET /api/corporations/[id]/commodities`, via `computeCorpCommodityFlows`).
 *
 * One basis, two surfaces:
 * - Supply for a sector is `computeSectorCommodityUnits` supply: measured
 *   `producedUnits` split across the output mix under the plants tier, falling
 *   back to the revenue nameplate only before a sector's first plants turn.
 * - Demand for a sector is `computeSectorCommodityUnits` demand: the revenue
 *   nameplate scaled by plant utilization (`producedUnits / capacityUnits`).
 * - Same turn: both surfaces read `gameState.currentTurn`.
 * - Same geographic scope: global totals sum every sector; a country slice sums
 *   the sectors whose state maps to that country.
 *
 * Revenue divided by price is never presented as realized output once measured
 * production exists. The old market path did exactly that (revenue x rate /
 * basePrice with no utilization leg), which overstated low-utilization plants
 * by 1/utilization and is kept in the regression test as a negative control.
 *
 * Genuinely different measures stay separate and labelled:
 * - Advertising-budget demand (marketingBudget x
 *   MARKETING_ADVERTISING_DEMAND_RATE / basePrice) is market-level demand, not
 *   corporation input consumption, and is reported as its own labelled row.
 * - Synthetic non-corporate demand (base stabilizer, GDP-scaled retail /
 *   construction legs, economy-wide financial demand, government healthcare
 *   expenditure) is system demand, reported under `syntheticDemandSources`.
 *
 * EXTRACTION EXCEPTION: for EXTRACTABLE_RESOURCES both display surfaces share
 * the nameplate plus state-capacity filter basis that `computeSectorCommodityUnits`
 * implements. They deliberately do NOT reconstruct the unpersisted turn factors
 * (`extractionRealizedFraction`, `extractionOutputScaleFor`, per-sector
 * deposit-capacity rationing multipliers): those are computed in-memory each
 * turn by `computeRawSupplyDemand` / `bookExtractionDepletion` and are not
 * persisted, so exact equality with the turn ledger is not claimed for
 * extraction. Do not "finish" this by adding only the cheap leg.
 *
 * Rounding: every per-corporation volume is rounded to two decimals. A
 * cross-surface comparison therefore reconciles within one cent per aggregated
 * row plus float epsilon; totals reconcile within one cent per row.
 */
import type { CommodityType, ExtractableResource } from "@/lib/constants/commodities";
import { EXTRACTABLE_RESOURCES } from "@/lib/constants/commodities";
import {
  computeSectorCommodityUnits,
  type CorpCommodityFlowContext,
  type FlowSector,
} from "@/lib/corporations/corpCommodityFlows";

/** Decimals every realized volume is rounded to before display. */
export const REALIZED_COMMODITY_ROUNDING_DECIMALS = 2;

/** One display unit step at the rounding above (one cent of volume). */
export const REALIZED_COMMODITY_ROUNDING_UNIT = 0.01;

/** Small float epsilon added on top of pure rounding headroom. */
export const REALIZED_COMMODITY_EPSILON = 1e-6;

/**
 * Maximum expected absolute gap between the same realized volume reported on
 * the market and corporation surfaces after both round to two decimals.
 */
export function realizedPerRowTolerance(): number {
  return REALIZED_COMMODITY_ROUNDING_UNIT + REALIZED_COMMODITY_EPSILON;
}

/**
 * Maximum expected absolute gap between summed totals covering `rowCount`
 * rounded rows on each surface.
 */
export function realizedTotalTolerance(rowCount: number): number {
  return Math.max(0, rowCount) * realizedPerRowTolerance() + REALIZED_COMMODITY_EPSILON;
}

/** True for commodities under the documented extraction exception. */
export function isExtractionExceptionCommodity(commodity: CommodityType): boolean {
  return (EXTRACTABLE_RESOURCES as readonly string[]).includes(commodity);
}

/** One sector plus the corporation/state routing the leaderboard needs. */
export type RealizedLeaderboardSector = FlowSector & {
  corporationId: string;
  stateId: string;
  /**
   * State-owned corp flag for this sector's owner. Overrides
   * `context.isNatcorp` per sector so one cross-corp aggregation can mix
   * natcorps and private corps without a per-corp pass.
   */
  isNatcorp?: boolean;
};

export interface RealizedLeaderboardVolumes {
  /** corpId -> realized output units for the commodity. */
  supplyByCorp: Map<string, number>;
  /** corpId -> realized input-demand units for the commodity. */
  demandByCorp: Map<string, number>;
  /** countryId -> (corpId -> output units in that country). */
  supplyByCountry: Map<string, Map<string, number>>;
  /** countryId -> (corpId -> input-demand units in that country). */
  demandByCountry: Map<string, Map<string, number>>;
}

/**
 * Aggregate one commodity's realized corporation volumes for the market
 * leaderboards through the SAME `computeSectorCommodityUnits` chain the
 * corporation tab uses, so the two surfaces cannot drift apart.
 *
 * `stateCountryOf` maps a sector's stateId to its countryId for the
 * per-country slices. Sectors whose state has no country entry contribute to
 * the global totals only.
 */
export function aggregateRealizedCommodityVolumes(
  sectors: RealizedLeaderboardSector[],
  commodity: CommodityType,
  currentTurn: number,
  context: CorpCommodityFlowContext = {},
  stateCountryOf: (stateId: string) => string | undefined = () => undefined
): RealizedLeaderboardVolumes {
  const supplyByCorp = new Map<string, number>();
  const demandByCorp = new Map<string, number>();
  const supplyByCountry = new Map<string, Map<string, number>>();
  const demandByCountry = new Map<string, Map<string, number>>();

  const add = (target: Map<string, number>, key: string, units: number): void => {
    if (!(units > 0)) return;
    target.set(key, (target.get(key) ?? 0) + units);
  };
  const addCountry = (
    target: Map<string, Map<string, number>>,
    countryId: string | undefined,
    corpId: string,
    units: number
  ): void => {
    if (!countryId || !(units > 0)) return;
    const existing = target.get(countryId) ?? new Map<string, number>();
    existing.set(corpId, (existing.get(corpId) ?? 0) + units);
    target.set(countryId, existing);
  };

  for (const sector of sectors) {
    const sectorContext =
      typeof sector.isNatcorp === "boolean" ? { ...context, isNatcorp: sector.isNatcorp } : context;
    const { supply, demand } = computeSectorCommodityUnits(sector, currentTurn, sectorContext);
    const supplyUnits = supply.get(commodity) ?? 0;
    const demandUnits = demand.get(commodity) ?? 0;
    if (supplyUnits > 0) {
      add(supplyByCorp, sector.corporationId, supplyUnits);
      addCountry(
        supplyByCountry,
        stateCountryOf(sector.stateId),
        sector.corporationId,
        supplyUnits
      );
    }
    if (demandUnits > 0) {
      add(demandByCorp, sector.corporationId, demandUnits);
      addCountry(
        demandByCountry,
        stateCountryOf(sector.stateId),
        sector.corporationId,
        demandUnits
      );
    }
  }

  return { supplyByCorp, demandByCorp, supplyByCountry, demandByCountry };
}

export type { ExtractableResource };
