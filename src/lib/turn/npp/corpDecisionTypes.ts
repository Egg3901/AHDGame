import type { ObjectId } from "mongodb";
import type { CorporationType } from "@/lib/constants/corporations";
import type { Corporation, CorporateSector, SectorBuildOrder } from "@/lib/db/types";
import type { NppAutonomyLevel } from "@/lib/db/types/gameState";
import type { CorporationProduct } from "@/lib/products/types";
import type { CeoArchetypeModifiers } from "@/lib/turn/ceoArchetype";
import type { NppProductAction } from "./nppProductDecision";
import type { NppStrategyState } from "./corpStrategy";
import type { NppMarketEntryDiagnostic } from "./entryDiagnostics";
import type { FrontierEntryTurnState } from "./frontierEntryCandidate";
import type { CapacityDecisionObservation } from "@/lib/corporations/capacityDecisionTelemetry/rules";
import type { NppOperatorObservation } from "@/lib/corporations/nppOperatorTelemetry/rules";

export interface NppCorpDecisionContext {
  corp: Corporation;
  sectors: CorporateSector[];
  turn: number;
  now: Date;
  /** Behavior modifiers derived from the CEO NPP personality. */
  modifiers: CeoArchetypeModifiers;
  /** Local units per anchor unit for the corporation liquid currency. */
  fxRate?: number;
  /** Live local-per-anchor rates used to restate host-currency sector revenue. */
  fxByCurrency?: ReadonlyMap<string, number>;
  /** Whether the labour system permits wage-level writes. */
  labourWagesEnabled?: boolean;
  currentYear?: number;
  techTreesEnabled?: boolean;
  /** Net per-turn debt service in anchor currency; positive is a drag. */
  debtServiceAnchor?: number;
  /** Persisted strategy memory; absent adopts the legacy expand behavior. */
  strategy?: NppStrategyState;
  strategyEligible?: boolean;
  ordinaryEntryEligible?: boolean;
  strategyLoopEnabled?: boolean;
  /**
   * Capped frontier-entry experiment state (issue #991), supplied by the turn
   * shell only when `frontierEntryExperimentEnabled` resolves true. The sets
   * are shared across the whole NPP cohort for the turn and enforce at most
   * one entrant per state-country cohort and one per controlling entity.
   * Absent (or disabled) reads as off and the decision is byte-identical to
   * the legacy path.
   */
  frontierEntry?: FrontierEntryTurnState;
  shortageEntryEligible?: boolean;
  shortageEntryCreditLocal?: number;
  /** Pause new Retail entry/growth while fake supply-derived demand unwinds. */
  retailExpansionPaused?: boolean;
  /**
   * In-memory rival count per (state, sectorType) bucket, excluding the
   * deciding corporation itself. Supplied by the turn shell from data it
   * already holds; absent reads as 0 so pure unit tests stay db-free.
   */
  competitorCountOf?: (stateId: string, sectorType: string, ownCorporationId: string) => number;
  /** Player-appointed caretaker mandate. NPP-owned corporations are always active. */
  caretakerMandate?: "active" | "passive";
  /**
   * Corporation-products gate (`corporationProductsEnabled` on gameConfig).
   * Absent reads as off: no product action.
   */
  productsEnabled?: boolean;
  /**
   * Effective NPP autonomy level for this corp's country. Absent reads as
   * below V4: no product action, so callers that do not thread it get the
   * pre-products brain byte-identically.
   */
  autonomyLevel?: NppAutonomyLevel;
  /**
   * Owned media operating models. Absent reads as none (the decision may
   * recommend acquiring the first legal model).
   */
  operatingModels?: readonly string[];
  /**
   * Current non-retired product, when the shell has loaded it. Absent reads
   * as no active product.
   */
  activeProduct?: CorporationProduct | null;
  /**
   * Sustained-failure evidence for the active product, in turns. Absent reads
   * as healthy: the product continues and is never retired.
   */
  productFailingTurns?: number;
}

/** A composable sector write emitted by the NPP corporation decision engine. */
export type NppSectorUpdateDoc = {
  $set: Record<string, unknown>;
  $push?: Record<string, unknown>;
  $inc?: Record<string, number>;
};

export interface NppCorpDecision {
  corpId: ObjectId;
  /**
   * Non-cash field writes only. `liquidCapital` MUST NOT appear here — the NPP
   * ops are appended to the corporation bulkWrite AFTER this turn's income
   * `$inc`, so an absolute write of the balance overwrites the credit. See
   * `liquidCapitalDelta` and `nppCashWrite.ts` (ticket #1260).
   */
  updates: Record<string, unknown>;
  /**
   * Net change to `liquidCapital` this decision causes, in the corp's own
   * currency: negative for spending, 0 when the corp spent nothing. Emitted as
   * `$inc` so it composes with the income credit instead of racing it.
   */
  liquidCapitalDelta: number;
  /** Local-currency cash floor that later NPP operator passes must preserve. */
  cashFloorLocal: number;
  sectorUpdates: Array<{
    filter: { _id: ObjectId };
    update: NppSectorUpdateDoc;
  }>;
  newSectors?: Array<{
    stateId: string;
    countryId: string;
    sectorType: CorporationType;
    revenue: number;
    profitMargin: number;
    strategyId?: string;
    starterOrder?: SectorBuildOrder;
  }>;
  divestedSectorIds?: ObjectId[];
  unownedDraws?: Array<{
    stateId: string;
    sectorType: CorporationType;
    units: number;
    countryId: string;
  }>;
  strategy?: NppStrategyState;
  reinvestments?: Array<{
    sectorId: ObjectId;
    sectorType: CorporationType;
    units: number;
    costAnchor: number;
    costLocal: number;
    onlineTurn: number;
  }>;
  shortageCreditRequest?: {
    amountLocal: number;
    sectorType: CorporationType;
  };
  entryDiagnostic?: NppMarketEntryDiagnostic;
  /**
   * Product-system intent for the turn orchestration layer to execute later
   * through the product persistence commands (issues #2236/#2238). Present
   * only when actionable; absent means no product action, which is what keeps
   * pre-V4 and flag-off brains byte-identical. Never executed here and never
   * written to the corporation document by this decision.
   */
  productDecision?: NppProductAction;
  /**
   * Capacity-decision telemetry for this corp this turn: one founding
   * observation plus one per evaluated reinvestment candidate, in that order.
   * Aggregated and flushed by the turn shell in a single bulk write.
   */
  capacityObservations?: CapacityDecisionObservation[];
  /** Aggregate-safe summary of this turn's full NPP operator decision. */
  operatorObservation?: NppOperatorObservation;
}

/** World facts needed to price founding builds through the player-equivalent path. */
export interface NppPlantsContext {
  enabled: boolean;
  year: number;
  eraUnitScale: number;
  preset: string | undefined;
  primeRateOf: (countryId: string) => number;
  costOfLivingOf: (stateId: string) => number | null;
}
