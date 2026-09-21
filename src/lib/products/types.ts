import type { CommodityType } from "@/lib/constants/commodities";

export const MEDIA_OPERATING_MODELS = [
  "newspaper",
  "publishing_house",
  "television_network",
  "radio_network",
  "film_studio",
  "music_label",
  "streaming_platform",
  "live_entertainment",
] as const;

export type MediaOperatingModel = (typeof MEDIA_OPERATING_MODELS)[number];

export const PRODUCT_LIFECYCLE_STAGES = [
  "development",
  "launch",
  "growth",
  "mature",
  "decline",
  "retired",
] as const;

export type ProductLifecycleStage = (typeof PRODUCT_LIFECYCLE_STAGES)[number];

export type ProductFamily = "media_entertainment" | "industrial_manufacturing";

/**
 * Canonical Media & Entertainment sector type for issue #2234. This is the
 * sole runtime type for the domain: new writes persist it, and the legacy
 * `media` / `entertainment` labels survive only at the input boundary.
 */
export const CANONICAL_MEDIA_SECTOR_TYPE = "media_entertainment";

/** Legacy sector types retired by the canonical Media & Entertainment sector. */
export const LEGACY_MEDIA_SECTOR_TYPES = ["media", "entertainment"] as const;

/** Existing sector types eligible for the gated product iteration. */
export function productFamilyForCorporationType(type: string): ProductFamily | null {
  if (type === "media" || type === "entertainment" || type === CANONICAL_MEDIA_SECTOR_TYPE) {
    return "media_entertainment";
  }
  if (type === "manufacturing" || type === "automobiles") {
    return "industrial_manufacturing";
  }
  return null;
}

export interface ProductKindDefinition {
  id: string;
  family: ProductFamily;
  label: string;
  outputCommodity: CommodityType;
  operatingModels?: readonly MediaOperatingModel[];
  requiredTechnologyIds?: readonly string[];
  /**
   * Era floor for catalog filtering (minimum over the kind's operating
   * models). Finer per-model gates live in the media rules module; absent
   * means producible in any era.
   */
  minDecade?: string;
}

export interface CorporationProduct {
  id: string;
  corporationId: string;
  kindId: string;
  name: string;
  stage: ProductLifecycleStage;
  startedTurn: number;
  lastProcessedTurn?: number;
  launchedTurn?: number;
  retiredTurn?: number;
  /** Accumulated product-specific R&D spend on the anchor-currency basis. */
  developmentSpendAnchor: number;
  /** Effective delivered advertising accumulated during development. */
  developmentAdvertisingAnchor: number;
  /** Number of turns contributing to the development advertising average. */
  developmentAdvertisingTurns: number;
  /** Frozen at launch; the lifecycle never replaces corporation brand loyalty. */
  productBrand?: number;
  /** Frozen at launch from the existing quality system plus product investment. */
  launchQuality?: number;
}

export interface ProductDraft {
  id: string;
  corporationId: string;
  kindId: string;
  name: string;
  startedTurn: number;
}
