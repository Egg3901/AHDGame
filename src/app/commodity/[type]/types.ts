import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";

export interface HistoryPoint {
  turn: number;
  price: number;
  supply: number;
  demand: number;
}

export interface SectorFlow {
  sectorType: CorporationType;
  label: string;
  rate: number;
}

export interface CorpVolume {
  corpId: string;
  name: string;
  type?: CorporationType;
  typeLabel?: string;
  sequentialId?: number;
  logoUrl?: string;
  units: number;
}

export interface DemandDriver {
  type: string;
  label: string;
  description: string;
  sourceLabel?: string;
  sourceUnits?: number;
  sourceShare?: number;
  consumerNote?: string;
}

export interface SyntheticDemandSource {
  name: string;
  type: "system";
  units: number;
  description: string;
}

export interface CommodityDetail {
  commodity: string;
  label: string;
  icon: string;
  colors: string;
  unit: string;
  basePrice: number;
  globalPrice: number;
  globalSupply: number;
  globalDemand: number;
  priceChange: number;
  annualPriceChange: number;
  statePrices: Record<string, number>;
  stateSupply: Record<string, number>;
  stateDemand: Record<string, number>;
  /** Authoritative per-country supply (includes federal injections not in state maps). */
  nationalSupply?: Record<string, number>;
  /** Authoritative per-country demand (includes federal injections not in state maps). */
  nationalDemand?: Record<string, number>;
  /** Authoritative per-country market prices from the turn engine. */
  nationalPrices?: Record<string, number>;
  /**
   * Per-country reachable market book for this commodity (ticket #1077): own
   * production against the demand that country's sellers can actually serve.
   * Absent until a world has run a turn on 1.1.2 or later, which hides the
   * map's Reachable lens rather than painting every market empty.
   */
  reachableBooks?: Record<
    string,
    { supply: number; demand: number; blockedSupply: number; untradedSupply: number }
  >;
  /** Maps stateId → countryId for multi-country commodity views */
  stateCountryMap?: Record<string, string>;
  /** Per-state extraction ceiling (units/turn). Only populated for extractable resources. */
  capacityByState?: Record<string, number>;
  /** Sum of `capacityByState` across enabled countries (units/turn). */
  totalCapacity?: number;
  /**
   * Latest flow-ledger row (marketSystemMode >= "ledger", audit t806 Fix 3/D0):
   * what this market actually moved last turn. undefined when the mode is off.
   */
  flows?: {
    turn: number;
    clearedUnits: number;
    unmetDemandUnits: number;
    surplusUnits: number;
    /** Shadow inventory: null for non-storable commodities. */
    stockUnits: number | null;
    coverTurns: number | null;
  };
  turn: number;
  history: HistoryPoint[];
  suppliers: SectorFlow[];
  consumers: SectorFlow[];
  topProducers: CorpVolume[];
  topConsumers: CorpVolume[];
  topProducersByCountry?: Partial<Record<CountryId, CorpVolume[]>>;
  topConsumersByCountry?: Partial<Record<CountryId, CorpVolume[]>>;
  demandDriver: DemandDriver | null;
  syntheticDemandSources: SyntheticDemandSource[];
}

export type ChartView = "price" | "supply_demand";
