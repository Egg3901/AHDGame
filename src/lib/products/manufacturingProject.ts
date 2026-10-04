/**
 * A corporation's active manufactured product is one project allocated across owned plants.
 * ManufacturingProductProject stores paid development and the turn needed for replay-safe progress.
 */
import type { ManufacturingLifecycleStage } from "./rules/manufacturingRules";
import type { ProductPlantAllocation } from "./rules/manufacturingEligibility";

export const MANUFACTURING_PRODUCT_PROJECTS_V2 = "manufacturingProductProjectsV2";
export const MANUFACTURING_PRODUCT_ACTIVE_INDEX_V2 =
  "unique_active_manufacturing_product_per_corporation_v2";

export interface ManufacturingProductProject {
  _id: string;
  corporationId: string;
  /** Present only while a project is active; partial unique index enforces one slot. */
  activeCorporationId?: string;
  kindId: string;
  stage: ManufacturingLifecycleStage;
  stageStartedTurn: number;
  allocations: ProductPlantAllocation[];
  startedTurn: number;
  lastProcessedTurn?: number;
  developmentPaidAnchor: number;
  paidThresholdAnchor: number;
  elapsedDevelopmentTurns: number;
  elapsedThresholdTurns: number;
}

/** Durable receipt written in the same corporation update as the R&D cash debit. */
export interface ManufacturingDevelopmentCashReceiptV2 {
  projectId: string;
  turn: number;
  amountAnchor: number;
}
