/**
 * Manufacturing product lines redirect recipe value into modeled goods and add a bounded quality
 * contribution from paid development. The portable rules are allocateManufacturedOutput and
 * productQualityForCommodity.
 */
import { commodityMixWeight, type CommodityType } from "@/lib/constants/commodities";
import { validateProductAllocations, type ProductPlantAllocation } from "./plantAllocations";
import { advanceProductLifecycle, type ProductLifecycleStage } from "./productLifecycle";

export type ManufacturingLifecycleStage = ProductLifecycleStage;

export interface PaidDevelopmentProgress {
  currentPaidAnchor: number;
  additionalPaidAnchor: number;
  elapsedTurns: number;
  paidThresholdAnchor: number;
  elapsedThresholdTurns: number;
}

export interface PaidDevelopmentState {
  paidAnchor: number;
  elapsedTurns: number;
  ready: boolean;
}

export interface ManufacturingProjectProgress {
  stage: ManufacturingLifecycleStage;
  stageStartedTurn: number;
  lastProcessedTurn: number;
  developmentPaidAnchor: number;
  elapsedDevelopmentTurns: number;
  active: boolean;
}

export interface ManufacturingResearchSpendAllocation {
  productDevelopmentAnchor: number;
  genericResearchAnchor: number;
}

export interface ManufacturedOutputAllocationInput {
  /** Nameplate revenue basis in anchor currency per day, derived from real plant capacity. */
  outputAnchor: number;
  /** Current strategy's nominal output coefficients, not unit counts. */
  supplyRates: Partial<Record<CommodityType, number>>;
  /** Share of this plant's capacity assigned to the active product line. */
  allocationShare: number;
  stage: ManufacturingLifecycleStage;
  outputCommodity: CommodityType;
  /** Commodity base prices in the same anchor basis as outputAnchor. */
  basePrices: Partial<Record<CommodityType, number>>;
  /** Legacy recipe value by commodity, derived from measured units and mix weights. */
  baseOutputAnchorByCommodity?: Partial<Record<CommodityType, number>>;
}

export interface ManufacturedOutputAllocation {
  nominalOutputAnchorByCommodity: Partial<Record<CommodityType, number>>;
  outputUnitsByCommodity: Partial<Record<CommodityType, number>>;
  /** Only the redirected product portion, excluding the legacy recipe baseline. */
  projectOutputUnitsByCommodity: Partial<Record<CommodityType, number>>;
  /** Recipe input demand follows assigned plant capacity once, not output item count. */
  inputThroughputShare: number;
}

export interface ManufacturedSectorOutput {
  outputAnchorByCommodity: Partial<Record<CommodityType, number>>;
  outputUnitsByCommodity: Partial<Record<CommodityType, number>>;
  projectOutputUnitsByCommodity: Partial<Record<CommodityType, number>>;
  productQualityByCommodity: Partial<Record<CommodityType, number>>;
}

/** Applies a physical output haircut equally to commodity units and nominal value. */
export function scaleManufacturedSectorOutput(
  output: ManufacturedSectorOutput,
  productionFactor: number
): ManufacturedSectorOutput {
  const factor = finiteNonNegative(productionFactor);
  return {
    outputAnchorByCommodity: Object.fromEntries(
      Object.entries(output.outputAnchorByCommodity).map(([commodity, anchor]) => [
        commodity,
        finiteNonNegative(anchor ?? 0) * factor,
      ])
    ),
    outputUnitsByCommodity: Object.fromEntries(
      Object.entries(output.outputUnitsByCommodity).map(([commodity, units]) => [
        commodity,
        finiteNonNegative(units ?? 0) * factor,
      ])
    ),
    projectOutputUnitsByCommodity: Object.fromEntries(
      Object.entries(output.projectOutputUnitsByCommodity).map(([commodity, units]) => [
        commodity,
        finiteNonNegative(units ?? 0) * factor,
      ])
    ),
    productQualityByCommodity: output.productQualityByCommodity,
  };
}

/** Keeps the last realized throughput ratio while moving it to today's plant basis. */
export function resizeMeasuredManufacturedUnits(input: {
  producedUnits: number;
  currentCapacityUnits: number;
  snapshotCapacityUnits: number;
}): number {
  const producedUnits = finiteNonNegative(input.producedUnits);
  const currentCapacityUnits = finiteNonNegative(input.currentCapacityUnits);
  const snapshotCapacityUnits = finiteNonNegative(input.snapshotCapacityUnits);
  if (snapshotCapacityUnits <= 0) return producedUnits;
  return producedUnits * (currentCapacityUnits / snapshotCapacityUnits);
}

const OUTPUT_REDIRECT_BY_STAGE: Record<ManufacturingLifecycleStage, number> = {
  development: 0,
  launch: 0.15,
  growth: 0.4,
  mature: 0.7,
  decline: 0.4,
  retired: 0,
};

const QUALITY_STAGE_FACTOR: Record<ManufacturingLifecycleStage, number> = {
  development: 0,
  launch: 0.25,
  growth: 0.6,
  mature: 1,
  decline: 0.6,
  retired: 0,
};

const MAX_PAID_DEVELOPMENT_QUALITY = 10;
export const MANUFACTURING_DEVELOPMENT_ELAPSED_TURNS = 12;

/** Allocates monetary plant capital without treating physical capacity as currency. */
export function allocatedManufacturingCapitalAnchor(
  plants: readonly { sectorId: string; developmentCapitalAnchor: number }[],
  allocations: readonly ProductPlantAllocation[]
): number {
  if (!validateProductAllocations(allocations)) return 0;
  const capitalById = new Map(
    plants.map((plant) => [plant.sectorId, plant.developmentCapitalAnchor])
  );
  return allocations.reduce(
    (sum, allocation) =>
      sum + finiteNonNegative(capitalById.get(allocation.sectorId) ?? 0) * allocation.share,
    0
  );
}

/** Five percent of allocated monetary plant capital, with a one-anchor minimum. */
export function manufacturingDevelopmentThresholdAnchor(allocatedCapitalAnchor: number): number {
  return Math.max(1, finiteNonNegative(allocatedCapitalAnchor) * 0.05);
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Advances development only from paid cash and elapsed turns. */
export function advancePaidDevelopment(input: PaidDevelopmentProgress): PaidDevelopmentState {
  const paidAnchor =
    finiteNonNegative(input.currentPaidAnchor) + finiteNonNegative(input.additionalPaidAnchor);
  const elapsedTurns = Math.floor(finiteNonNegative(input.elapsedTurns));
  const paidThresholdAnchor = finiteNonNegative(input.paidThresholdAnchor);
  const elapsedThresholdTurns = Math.floor(finiteNonNegative(input.elapsedThresholdTurns));
  return {
    paidAnchor,
    elapsedTurns,
    ready: paidAnchor >= paidThresholdAnchor && elapsedTurns >= elapsedThresholdTurns,
  };
}

/** Applies one durable paid-development receipt exactly once to its active project. */
export function advanceManufacturingProject(input: {
  project: {
    _id: string;
    stage: ManufacturingLifecycleStage;
    stageStartedTurn: number;
    startedTurn: number;
    lastProcessedTurn?: number;
    developmentPaidAnchor: number;
    paidThresholdAnchor: number;
    elapsedDevelopmentTurns: number;
    elapsedThresholdTurns: number;
  };
  receipt: { projectId: string; turn: number; amountAnchor: number };
}): ManufacturingProjectProgress | null {
  const { project, receipt } = input;
  const progress = advanceProductLifecycle({
    product: {
      id: project._id,
      stage: project.stage,
      stageStartedTurn: project.stageStartedTurn,
      startedTurn: project.startedTurn,
      lastProcessedTurn: project.lastProcessedTurn,
      developmentPaidAnchor: project.developmentPaidAnchor,
      paidThresholdAnchor: project.paidThresholdAnchor,
      elapsedDevelopmentTurns: project.elapsedDevelopmentTurns,
      elapsedThresholdTurns: project.elapsedThresholdTurns,
    },
    receipt: {
      productId: receipt.projectId,
      turn: receipt.turn,
      paidDevelopmentAnchor: receipt.amountAnchor,
    },
  });
  if (!progress) return null;

  return {
    stage: progress.stage,
    stageStartedTurn: progress.stageStartedTurn,
    lastProcessedTurn: progress.lastProcessedTurn,
    developmentPaidAnchor: progress.developmentPaidAnchor,
    elapsedDevelopmentTurns: progress.elapsedDevelopmentTurns,
    active: progress.active,
  };
}

/** Advances the completed-turn clock independently from once-only paid cash evidence. */
export function tickManufacturingProject(input: {
  project: Parameters<typeof advanceManufacturingProject>[0]["project"] & {
    lastDevelopmentReceiptTurn?: number;
  };
  receipt?: { projectId: string; turn: number; amountAnchor: number };
  completedTurn: number;
}): (ManufacturingProjectProgress & { lastDevelopmentReceiptTurn: number }) | null {
  const project = input.project;
  // Before a separate cash watermark exists, the old clock was written only
  // when a cash receipt was consumed. Retain that legacy acknowledgment.
  const cashWatermark = project.lastDevelopmentReceiptTurn ?? project.lastProcessedTurn ?? 0;
  if (!Number.isSafeInteger(cashWatermark) || cashWatermark < 0) return null;
  const receipt = input.receipt;
  const payableReceipt =
    receipt &&
    receipt.projectId === project._id &&
    Number.isSafeInteger(receipt.turn) &&
    receipt.turn >= project.startedTurn &&
    receipt.turn <= input.completedTurn &&
    receipt.turn > cashWatermark &&
    Number.isFinite(receipt.amountAnchor) &&
    receipt.amountAnchor >= 0
      ? receipt
      : undefined;
  const progress = advanceManufacturingProject({
    project,
    receipt: {
      projectId: project._id,
      turn: input.completedTurn,
      amountAnchor: payableReceipt?.amountAnchor ?? 0,
    },
  });
  return progress
    ? {
        ...progress,
        lastDevelopmentReceiptTurn: payableReceipt?.turn ?? cashWatermark,
      }
    : null;
}

/** Redirects paid R&D to one active project's remaining development cost first. */
export function allocateManufacturingResearchSpend(input: {
  paidResearchAnchor: number;
  projectPaidAnchor: number;
  projectCostAnchor: number;
  stage: ManufacturingLifecycleStage | null | undefined;
}): ManufacturingResearchSpendAllocation {
  const paidResearchAnchor = finiteNonNegative(input.paidResearchAnchor);
  const remaining = Math.max(
    0,
    finiteNonNegative(input.projectCostAnchor) - finiteNonNegative(input.projectPaidAnchor)
  );
  const productDevelopmentAnchor =
    input.stage === "development" ? Math.min(paidResearchAnchor, remaining) : 0;
  return {
    productDevelopmentAnchor,
    genericResearchAnchor: paidResearchAnchor - productDevelopmentAnchor,
  };
}

/**
 * A development allocation can only consume cash that remains after the rest
 * of the corporation's planned P&L. The caller still performs an atomic live
 * balance check before recording the payment receipt.
 */
export function capManufacturingDevelopmentSpendToCash(input: {
  proposedDevelopmentAnchor: number;
  liquidCapitalAnchor: number;
  incomeBeforeDevelopmentAnchor: number;
}): number {
  const proposed = Number.isFinite(input.proposedDevelopmentAnchor)
    ? Math.max(0, input.proposedDevelopmentAnchor)
    : 0;
  if (proposed === 0) return 0;
  const cashAvailable =
    (Number.isFinite(input.liquidCapitalAnchor) ? input.liquidCapitalAnchor : 0) +
    (Number.isFinite(input.incomeBeforeDevelopmentAnchor)
      ? input.incomeBeforeDevelopmentAnchor
      : 0);
  return Math.min(proposed, Math.max(0, cashAvailable));
}

/**
 * Redirects part of a plant's existing nominal recipe value to the product output. Quantity is
 * computed only after value is conserved, so a costly output cannot multiply recipe value.
 */
export function allocateManufacturedOutput(
  input: ManufacturedOutputAllocationInput
): ManufacturedOutputAllocation {
  const outputAnchor = finiteNonNegative(input.outputAnchor);
  const allocationShare = clamp(finiteNonNegative(input.allocationShare), 0, 1);
  const outputRates = Object.entries(input.supplyRates ?? {}) as Array<[CommodityType, number]>;
  const baseOutputAnchorByCommodity =
    input.baseOutputAnchorByCommodity ??
    Object.fromEntries(
      outputRates.map(([commodity]) => [
        commodity,
        outputAnchor *
          commodityMixWeight(
            input.supplyRates,
            input.basePrices as Record<CommodityType, number>,
            commodity
          ),
      ])
    );
  const totalBaselineAnchor = Object.values(baseOutputAnchorByCommodity).reduce(
    (sum, anchor) => sum + finiteNonNegative(anchor ?? 0),
    0
  );
  const redirectedShare = OUTPUT_REDIRECT_BY_STAGE[input.stage];
  const allocatedRecipeAnchor = totalBaselineAnchor * allocationShare;
  const redirectedAnchor = allocatedRecipeAnchor * redirectedShare;
  const nominalOutputAnchorByCommodity: Partial<Record<CommodityType, number>> = {};

  for (const [commodity, baseAnchorRaw] of Object.entries(baseOutputAnchorByCommodity) as Array<
    [CommodityType, number]
  >) {
    const baseAnchor = finiteNonNegative(baseAnchorRaw);
    if (baseAnchor <= 0) continue;
    const weight = totalBaselineAnchor > 0 ? baseAnchor / totalBaselineAnchor : 0;
    const allocatedBaseAnchor = baseAnchor * allocationShare;
    const allocatedRemainingAnchor = allocatedBaseAnchor - redirectedAnchor * weight;
    nominalOutputAnchorByCommodity[commodity] = Math.max(0, allocatedRemainingAnchor);
  }
  if (redirectedAnchor > 0) {
    nominalOutputAnchorByCommodity[input.outputCommodity] =
      (nominalOutputAnchorByCommodity[input.outputCommodity] ?? 0) + redirectedAnchor;
  }

  const productBasePrice = input.basePrices[input.outputCommodity] ?? 0;
  const projectOutputUnitsByCommodity: Partial<Record<CommodityType, number>> =
    productBasePrice > 0 ? { [input.outputCommodity]: redirectedAnchor / productBasePrice } : {};

  const outputUnitsByCommodity: Partial<Record<CommodityType, number>> = {};
  for (const [commodity, nominalAnchor] of Object.entries(nominalOutputAnchorByCommodity) as Array<
    [CommodityType, number]
  >) {
    const basePrice = input.basePrices[commodity] ?? 0;
    if (basePrice > 0 && nominalAnchor > 0) {
      outputUnitsByCommodity[commodity] = nominalAnchor / basePrice;
    }
  }

  return {
    nominalOutputAnchorByCommodity,
    outputUnitsByCommodity,
    projectOutputUnitsByCommodity,
    inputThroughputShare: allocationShare,
  };
}

/** Builds a full sector output map, retaining unallocated strategy output. */
export function buildManufacturedSectorOutput(input: {
  outputAnchor: number;
  supplyRates: Partial<Record<CommodityType, number>>;
  allocationShare: number;
  stage: ManufacturingLifecycleStage;
  outputCommodity: CommodityType;
  basePrices: Partial<Record<CommodityType, number>>;
  currentSectorQualityByCommodity?: Partial<Record<CommodityType, number>>;
  baseOutputAnchorByCommodity?: Partial<Record<CommodityType, number>>;
  paidDevelopmentAnchor: number;
  paidThresholdAnchor: number;
}): ManufacturedSectorOutput {
  const allocation = allocateManufacturedOutput(input);
  const share = clamp(finiteNonNegative(input.allocationShare), 0, 1);
  const outputAnchorByCommodity = { ...allocation.nominalOutputAnchorByCommodity };
  const baseline =
    input.baseOutputAnchorByCommodity ??
    Object.fromEntries(
      Object.keys(input.supplyRates).map((commodity) => [
        commodity,
        finiteNonNegative(input.outputAnchor) *
          commodityMixWeight(
            input.supplyRates,
            input.basePrices as Record<CommodityType, number>,
            commodity as CommodityType
          ),
      ])
    );
  for (const [commodity, baseAnchor] of Object.entries(baseline) as Array<
    [CommodityType, number]
  >) {
    const unallocatedAnchor = finiteNonNegative(baseAnchor) * (1 - share);
    if (unallocatedAnchor > 0) {
      outputAnchorByCommodity[commodity] =
        (outputAnchorByCommodity[commodity] ?? 0) + unallocatedAnchor;
    }
  }

  const outputUnitsByCommodity: Partial<Record<CommodityType, number>> = {};
  for (const [commodity, anchor] of Object.entries(outputAnchorByCommodity) as Array<
    [CommodityType, number]
  >) {
    const basePrice = input.basePrices[commodity] ?? 0;
    if (basePrice > 0 && anchor > 0) outputUnitsByCommodity[commodity] = anchor / basePrice;
  }

  const productQualityByCommodity: Partial<Record<CommodityType, number>> = {};
  for (const commodity of new Set([
    ...(Object.keys(outputAnchorByCommodity) as CommodityType[]),
    input.outputCommodity,
  ])) {
    const currentQuality = input.currentSectorQualityByCommodity?.[commodity];
    if (typeof currentQuality !== "number" || !Number.isFinite(currentQuality)) continue;
    productQualityByCommodity[commodity] = productQualityForCommodity({
      currentSectorQuality: currentQuality,
      paidDevelopmentAnchor: commodity === input.outputCommodity ? input.paidDevelopmentAnchor : 0,
      paidThresholdAnchor: input.paidThresholdAnchor,
      stage: commodity === input.outputCommodity ? input.stage : "development",
    });
  }

  return {
    outputAnchorByCommodity,
    outputUnitsByCommodity,
    projectOutputUnitsByCommodity: allocation.projectOutputUnitsByCommodity,
    productQualityByCommodity,
  };
}

/** Uses live per-commodity sector quality plus a bounded contribution from paid development. */
export function productQualityForCommodity(input: {
  currentSectorQuality: number | null | undefined;
  paidDevelopmentAnchor: number;
  paidThresholdAnchor: number;
  stage: ManufacturingLifecycleStage;
}): number {
  const liveQuality = clamp(
    typeof input.currentSectorQuality === "number" && Number.isFinite(input.currentSectorQuality)
      ? input.currentSectorQuality
      : 0,
    0,
    100
  );
  const threshold = finiteNonNegative(input.paidThresholdAnchor);
  const paidRatio =
    threshold > 0 ? clamp(finiteNonNegative(input.paidDevelopmentAnchor) / threshold, 0, 1) : 0;
  const paidContribution = MAX_PAID_DEVELOPMENT_QUALITY * paidRatio;
  return clamp(liveQuality + paidContribution * QUALITY_STAGE_FACTOR[input.stage], 0, 100);
}
