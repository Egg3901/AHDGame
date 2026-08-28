import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";

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
  emptyMarketCells: EmptyMarketCell[];
  basis: string;
}
