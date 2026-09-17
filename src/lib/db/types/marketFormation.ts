import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import type { CommodityType } from "@/lib/constants/commodities";

export type NppMarketEntryReason =
  | "entered"
  | "strategy_disallowed"
  | "unprofitable"
  | "margin_below_floor"
  | "no_enterable_market"
  | "state_controlled"
  | "logistics_capacity"
  | "cohort_ineligible"
  | "retail_paused"
  | "glutted_market"
  | "entry_cap"
  | "facility_size"
  | "cash_floor"
  | "founding_cost"
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
  /**
   * Set only when this entry was placed by the capped frontier-entry
   * experiment (issue #991) rather than the ordinary founding path. The
   * reason reads `entered` either way; this marker attributes the entrant to
   * the trial and names the expectational gate the experiment relaxed. Absent
   * on every diagnostic while the experiment flag is off.
   */
  frontierExperiment?: {
    cohortKey: string;
    controllerKey: string;
    relaxedReason: NppMarketEntryReason;
  };
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
  /** Non-mothballed sectors operating in this cell. Zero by construction here. */
  activeFirms: number;
  /** Distinct corporations operating in this cell. Zero by construction here. */
  activeCorps: number;
  localDemandValueAnchor: number | null;
  localSupplyValueAnchor: number | null;
  deliveredSupplyValueAnchor: number | null;
  inboundSupplyValueAnchor: number | null;
  /**
   * Gross local use minus inbound-delivered supply: the demand contestable by
   * a local entrant. Null without demand observations. Derived from the
   * engine's calibrated state books, never from firm counts.
   */
  localProducerDemandValueAnchor: number | null;
  /**
   * Local output that found a buyer (own-state fill plus freight-carried
   * outbound), base-price-weighted. Null without demand observations.
   */
  outputValueAnchor: number | null;
  targetedNppCorporations: number;
  targetedRejectionReasons: NppMarketEntryReason[];
}

export interface StateSectorCoverage {
  countryId: string;
  stateId: string;
  /** State-sector cells in the universe (active plus empty). */
  cells: number;
  activeCells: number;
  emptyCells: number;
  facilityReadyEmptyCells: number;
  activeFirms: number;
  activeCorps: number;
  openHeadroomUnits: number;
  residentDemandValue: number;
  localProducerDemandValue: number;
  inboundSupplyValue: number;
  outputValue: number;
}

export interface CountrySectorCoverage {
  countryId: string;
  states: number;
  cells: number;
  activeCells: number;
  emptyCells: number;
  facilityReadyEmptyCells: number;
  activeFirms: number;
  activeCorps: number;
  openHeadroomUnits: number;
  residentDemandValue: number;
  localProducerDemandValue: number;
  inboundSupplyValue: number;
  outputValue: number;
}

export interface CommoditySupplyBreadth {
  commodity: string;
  sellerStates: number;
  buyerStates: number;
  /** Largest single state supply share of world supply, null when unmeasured. */
  topSellerShare: number | null;
  globalDemandUnits: number;
  globalSupplyUnits: number;
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
   * Full state-sector coverage: every observed state with active firms,
   * headroom, resident demand, local-producer demand, inbound supply, and
   * output. Sorted by empty cells descending, then state id.
   */
  coverageByState: StateSectorCoverage[];
  /** Coverage rolled up by country. Sorted by empty cells descending. */
  coverageByCountry: CountrySectorCoverage[];
  /**
   * Per-commodity seller/buyer breadth from the state books: how many states
   * sell, how many buy, and the largest single-state supply share. Sorted by
   * commodity name.
   */
  commodityBreadth: CommoditySupplyBreadth[];
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
