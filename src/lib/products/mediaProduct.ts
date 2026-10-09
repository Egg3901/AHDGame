/**
 * A media product project is one named title in an existing operating model.
 * It attributes the sector's real output and never creates extra commodity units.
 */
import type { ProductLifecycleStage } from "./rules/productLifecycle";
import type { CommodityType } from "@/lib/constants/commodities";

export const MEDIA_PRODUCT_PROJECTS = "mediaProductProjectsV1";
export const MEDIA_PRODUCT_ACTIVE_INDEX =
  "unique_active_media_product_development_per_corporation_v1";
export const MEDIA_PRODUCT_STAGE_INDEX = "media_product_stage_corporation_v1";
export const MEDIA_PRODUCT_CORPORATION_INDEX = "media_product_corporation_stage_v1";

export interface MediaProductProject {
  _id: string;
  corporationId: string;
  /** Present during development only. The unique partial index bounds each slate. */
  activeDevelopmentCorporationId?: string;
  sectorId: string;
  operatingSectorType?: "media" | "media_entertainment";
  kindId: string;
  title: string;
  allocationShare: number;
  stage: ProductLifecycleStage;
  startedTurn: number;
  stageStartedTurn: number;
  lastProcessedTurn?: number;
  developmentPaidAnchor: number;
  paidThresholdAnchor: number;
  elapsedDevelopmentTurns: number;
  elapsedThresholdTurns: number;
  developmentAdvertisingAnchor: number;
  developmentAdvertisingTurns: number;
  launchQuality?: number;
  qualityBonus?: number;
  productBrand?: number;
  lastDeliveredOutputTurn?: number;
  lastTurnDeliveredUnitsByCommodity?: Partial<Record<CommodityType, number>>;
  lastTurnDeliveredRevenueAnchorByCommodity?: Partial<Record<CommodityType, number>>;
  lifetimeDeliveredUnitsByCommodity?: Partial<Record<CommodityType, number>>;
  lifetimeDeliveredRevenueAnchorByCommodity?: Partial<Record<CommodityType, number>>;
}

/** Settled R&D and commercial advertising attribution written with the payer debit. */
export interface MediaProductDevelopmentReceipt {
  projectId: string;
  turn: number;
  amountAnchor: number;
  deliveredAdvertisingAnchor: number;
}

/** Written in the same corporate cash update as the funded commercial ad debit. */
export interface MediaProductAdvertisingReceipt {
  projectId: string;
  turn: number;
  amountAnchor: number;
  /** Seller cash targets refreshed by an interrupted same-turn settlement retry. */
  sellerCorporationIds?: string[];
}
