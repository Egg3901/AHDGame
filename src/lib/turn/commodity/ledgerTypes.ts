import type { CommodityType } from "@/lib/constants/commodities";
import type { CorporateSector } from "@/lib/db/types";

/** Mutable supply/demand balance for one commodity in one scope. */
export interface CommodityBalance {
  supply: number;
  demand: number;
}

/** Commodity -> balance, for the world aggregate. */
export type GlobalLedger = Map<CommodityType, CommodityBalance>;
/** State id -> per-commodity balances. */
export type StateLedger = Map<string, Map<CommodityType, CommodityBalance>>;
/** Country id -> per-commodity balances. */
export type CountryLedger = Map<string, Map<CommodityType, CommodityBalance>>;

/**
 * One owned sector's contribution to the world supply/demand ledger.
 * The base shape is exactly what `computeRawSupplyDemand` consumes; the
 * turn-local extras (`corporationId`, `soldUnits`, `capacityUnits`,
 * `mothballed`, `embargoSupplyFactor`) feed the extraction, plants-inventory,
 * and pricing legs downstream in the same turn.
 */
export interface SectorLedgerRow {
  sectorType: string;
  industryModel?: string | null;
  revenue: number;
  stateId: string;
  sectorId: string;
  corporationId: CorporateSector["corporationId"];
  isNatcorp: boolean;
  strategyId?: string;
  transitionFromStrategyId?: string | null;
  transitionStartTurn?: number | null;
  productionPolicyLevel?: number;
  countryId?: string;
  plannedEconomy?: boolean;
  producedUnits?: number | null;
  /** Exact product output units before NatCorp and embargo market scaling. */
  outputUnitsByCommodity?: Partial<Record<CommodityType, number>>;
  /** Nominal output anchor by commodity, used to value exact inventory units. */
  outputAnchorByCommodity?: Partial<Record<CommodityType, number>>;
  /** Current bounded product quality by output commodity. */
  productQualityByCommodity?: Partial<Record<CommodityType, number>>;
  /** Exact per-commodity clearing fractions for the same output map. */
  soldByCommodity?: Partial<Record<string, number>>;
  militaryDivertedFraction?: number;
  soldUnits?: number | null;
  capacityUnits?: number | null;
  mothballed?: boolean;
  embargoSupplyFactor?: number | null;
  extractionRealizedFraction?: number | null;
}

/** Produced/sold unit totals per commodity for the plants inventory advance. */
export interface PlantsUnits {
  produced: number;
  sold: number;
}
