import type { MarketContext } from "@/lib/market/marketContext";
import type {
  AutomationIndexAccumulator,
  LabourContext,
  WageIndexAccumulator,
} from "@/lib/labour/laborCost";
import type { LabourDemandByState } from "@/lib/labour/labourMarket";
import type { CorporationLookups, SectorCalculationsResult, SectorUpdateOp } from "./types";

/** Read-only turn inputs plus collectors owned by processSectors. */
export interface SectorTurnEnv {
  lookups: CorporationLookups;
  turn: number | undefined;
  currentTurn: number;
  now: Date;
  techTreesEnabled: boolean;
  currentYear?: number;
  commandEconomyEnabled?: boolean;
  labour: LabourContext;
  market: MarketContext;
  wageIndexByState: Map<string, WageIndexAccumulator>;
  automationIndexByState: Map<string, AutomationIndexAccumulator>;
  /**
   * Phase 1 labour market telemetry: per-state sum of every sector's
   * revenue-implied headcount. Accumulated unconditionally (not behind
   * `labour.wagesEnabled`) because desired headcount exists whether or not the
   * wage system is on. The persisted reading feeds the next turn's labour
   * allocation and workforce response.
   */
  labourDemandByState: LabourDemandByState;
  /** Desired-worker-weighted wage bids, kept separate from actual-worker wage telemetry. */
  labourDemandWageIndexByState?: Map<string, WageIndexAccumulator>;
  pendingStrikeEvents: SectorCalculationsResult["strikeEvents"];
  pendingCapacityBindingEvents: SectorCalculationsResult["capacityBindingEvents"];
  sectorOps: SectorUpdateOp[];
  /** gameConfig.privateBankingEnabled — gates branch/commodity capacity split. */
  privateBankingEnabled?: boolean;
}

/** Per-sector contributions accumulated by processSectors. */
export interface SectorTurnResult {
  hourlyRevenue: number;
  newCurrentGrowthRate: number;
  effectiveMargin: number;
  /** Operating, upkeep, growth, and regulatory costs for the turn. */
  costs: number;
  /** Idle-capacity or mothball upkeep already included in costs. */
  plantsUpkeepCost: number;
  /** Paid construction value still in the outstanding build queue. */
  constructionInProgressAnchor: number;
  /** Capital book value in capital mode, otherwise sector NPV. */
  npvContribution: number;
  commodityMod: number;
  surplusMod: number;
  exportPremiumMod: number;
  macroMod: number;
  stateMetricsCappedTotal: number;
  stateMetricsLegacyTotal: number;
  hourlyGrowthCost: number;
  growthInvestmentAnchor: number;
  stateId: string;
  countryId: string;
}
