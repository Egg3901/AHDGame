import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import type { CommodityType } from "@/lib/constants/commodities";

export type NppMarketEntryReason =
  | "entered"
  | "strategy_disallowed"
  | "unprofitable"
  | "margin_below_floor"
  | "no_enterable_market"
  | "logistics_capacity"
  | "cohort_ineligible"
  | "facility_size"
  | "cash_floor"
  | "credit_requested"
  | "credit_cooldown"
  | "credit_capacity"
  | "credit_issuance_failed"
  | "credit_rounding_shortfall"
  | "state_credit_restricted";

export interface NppMarketEntryDiagnostic {
  corporationId: string;
  countryId: CountryId;
  reason: NppMarketEntryReason;
  sectorCount: number;
  logisticsSupportedSectors: number;
  profitable: boolean;
  marginPct: number;
  marginFloorPct: number;
  cohortEligible: boolean;
  strategyAllowsExpansion: boolean;
  targetStateId?: string;
  targetSectorType?: CorporationType;
  targetHeadroomUnits?: number;
  starterUnits?: number;
  shortageScore?: number;
  foundingCostLocal?: number;
  entryCapitalLocal?: number;
  cashFloorLocal?: number;
  frontierFallback?: boolean;
  openMarketTypeFallback?: boolean;
  /** Diagnosed fragile commodity this existing entry slot was routed toward. */
  interventionTargetCommodity?: CommodityType;
}

export interface NppMarketEntryFunnel {
  _id: string;
  schemaVersion: 1;
  turn: number;
  generatedAt: Date;
  corporationsObserved: number;
  entered: number;
  rejected: number;
  reasonCounts: Partial<Record<NppMarketEntryReason, number>>;
  diagnostics: NppMarketEntryDiagnostic[];
}

export type EmptyMarketClassification =
  | "fundamental_zero"
  | "import_served"
  | "unserved"
  | "entry_gap"
  | "coordination_gap"
  | "data_zero";

export interface EmptyMarketCell {
  countryId: string;
  stateId: string;
  sectorType: CorporationType;
  classification: EmptyMarketClassification;
  classificationBasis: string;
  headroomUnits: number;
  starterUnits: number;
  facilityReady: boolean;
  localDemandValueAnchor: number | null;
  localSupplyValueAnchor: number | null;
  deliveredSupplyValueAnchor: number | null;
  inboundSupplyValueAnchor: number | null;
  targetedNppCorporations: number;
  targetedRejectionReasons: NppMarketEntryReason[];
}

export interface MarketFormationSnapshot {
  cellsObserved: number;
  activeCells: number;
  emptyCells: number;
  emptyShare: number | null;
  facilityReadyEmptyCells: number;
  facilityReadyEmptyShare: number | null;
  statesObserved: number;
  statesWithEmptyCells: number;
  classificationCounts: Record<EmptyMarketClassification, number>;
  entryFunnel: {
    corporationsObserved: number;
    entered: number;
    rejected: number;
    explainedOutcomeShare: number | null;
    reasonCounts: Partial<Record<NppMarketEntryReason, number>>;
  };
  emptyByCountry: Array<{ countryId: string; cells: number; facilityReady: number }>;
  emptyBySector: Array<{ sectorType: CorporationType; cells: number; facilityReady: number }>;
  emptyByState: Array<{ countryId: string; stateId: string; cells: number }>;
  /**
   * A bounded SAMPLE of empty cells, not the full set. The complete list ran
   * to ~1MB per turn on a persisted per-turn snapshot, and nothing outside the
   * producer ever read it: every aggregate a consumer wants (`emptyCells`,
   * `emptyShare`, `emptyByCountry`, `emptyBySector`, `emptyByState`,
   * `classificationCounts`) is already on this document. `emptyCells` remains
   * the true total; `emptyMarketCellsOmitted` says how many rows are missing
   * here so a reader is never misled into treating the sample as complete.
   */
  emptyMarketCells: EmptyMarketCell[];
  /** Rows dropped from `emptyMarketCells` by the sample cap. */
  emptyMarketCellsOmitted?: number;
  basis: string;
}
