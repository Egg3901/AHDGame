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

/** Existing sector types eligible for the gated product iteration. */
export function productFamilyForCorporationType(type: string): ProductFamily | null {
  if (type === "media" || type === "entertainment") return "media_entertainment";
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
