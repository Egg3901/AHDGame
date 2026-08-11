import type { CommodityType, ExtractableResource } from "@/lib/constants/commodities";
import type { CorporationType } from "@/lib/constants/corporations";
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";

/** Aggregate sector slice for a sphere-macro (Tier-2) country. */
export interface MacroSectorState {
  /** Per-turn dollar-equivalent capacity (same units as sector.revenue). */
  capacity: number;
  /** Output efficiency multiplier, typically near 1. */
  productivity: number;
  /** Per-turn dollar-equivalent domestic demand pressure for this sector. */
  domesticDemand: number;
}

/** Held market contribution applied every normal turn until the next macro tick. */
export interface MacroMarketContribution {
  /** Commodity units added to the shared global supply/demand each normal turn. */
  byCommodity: Partial<Record<CommodityType, { supply: number; demand: number }>>;
  /** Sector-level output/demand used for admin diagnostics. */
  bySector: Partial<Record<CorporationType, { output: number; demand: number }>>;
  /** Turn on which this contribution was last recomputed. */
  computedOnTurn: number;
}

/**
 * Market vs planned aggregate archetype.
 * Planned economies use COMECON-style leakage into the shared world market and
 * never seed market corporations (#3719).
 */
export type MacroEconomicSystem = "market" | "planned";

/**
 * Per-country data-quality report. Fallback fields must remain empty — Tier-2
 * seeds are authored per era and must not inherit modern-preset bundles.
 */
export interface MacroCountryDataQuality {
  provenance: "authored-1953";
  economicSystem: MacroEconomicSystem;
  /** Required fields that were absent or non-positive at seed time. */
  missingFields: string[];
  /** Fields that would have inherited another era/preset (must stay empty). */
  fallbackFields: string[];
}

/**
 * Persistent sphere-macro country document.
 *
 * No firms, balance sheets, NPP corporations, or player offices live here —
 * only aggregate capacity and the held market contribution.
 */
export interface MacroCountryState {
  _id: WorldEntityId;
  entityId: WorldEntityId;
  presetId: string;
  displayName: string;
  economicSystem: MacroEconomicSystem;
  population: number;
  /** 0–1 fiscal extractive capacity relative to output. */
  fiscalCapacity: number;
  /** 0–1 political/economic stability. */
  stability: number;
  /** 0–1 share of aggregate S/D exposed to the shared world market. */
  tradeExposure: number;
  /** Optional shock multiplier applied on the next kernel tick (default 1). */
  shockModifier: number;
  resources: Partial<Record<ExtractableResource, number>>;
  sectors: Partial<Record<CorporationType, MacroSectorState>>;
  contribution: MacroMarketContribution;
  dataQuality: MacroCountryDataQuality;
  lastMacroTickTurn: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MacroCountryDiagnostics {
  entityId: WorldEntityId;
  displayName: string;
  economicSystem: MacroEconomicSystem;
  lastMacroTickTurn: number | null;
  contributionComputedOnTurn: number;
  population: number;
  fiscalCapacity: number;
  stability: number;
  tradeExposure: number;
  shockModifier: number;
  resources: Partial<Record<ExtractableResource, number>>;
  sectors: Partial<Record<CorporationType, MacroSectorState>>;
  sectorContributions: Partial<Record<CorporationType, { output: number; demand: number }>>;
  commodityContributions: Partial<Record<CommodityType, { supply: number; demand: number }>>;
  /** Loud missing/fallback report — empty arrays mean a complete authored seed. */
  dataQuality: MacroCountryDataQuality;
}
