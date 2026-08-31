import type { ObjectId } from "mongodb";
import type { CorporationType } from "@/lib/constants/corporations";
import type { Corporation, CorporateSector, SectorBuildOrder } from "@/lib/db/types";
import type { CeoArchetypeModifiers } from "@/lib/turn/ceoArchetype";
import type { NppStrategyState } from "./corpStrategy";
import type { NppMarketEntryDiagnostic } from "./entryDiagnostics";

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
  shortageEntryEligible?: boolean;
  shortageEntryCreditLocal?: number;
  /** Pause new Retail entry/growth while fake supply-derived demand unwinds. */
  retailExpansionPaused?: boolean;
}

/** A composable sector write emitted by the NPP corporation decision engine. */
export type NppSectorUpdateDoc = {
  $set: Record<string, unknown>;
  $push?: Record<string, unknown>;
  $inc?: Record<string, number>;
};

export interface NppCorpDecision {
  corpId: ObjectId;
  updates: Record<string, unknown>;
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
