/**
 * Shared product lifecycle progression for industries that fund product work.
 * Callers supply an already-settled, replay-safe receipt; this module owns the
 * common stage clock and never performs cash or persistence operations.
 */
export type ProductLifecycleStage =
  "development" | "launch" | "growth" | "mature" | "decline" | "retired";

export const PRODUCT_LIFECYCLE_STAGE_TURNS: Partial<Record<ProductLifecycleStage, number>> = {
  launch: 24,
  growth: 48,
  mature: 120,
  decline: 60,
};

const PRODUCT_LIFECYCLE_STAGES = new Set<ProductLifecycleStage>([
  "development",
  "launch",
  "growth",
  "mature",
  "decline",
  "retired",
]);

const NEXT_STAGE: Partial<Record<ProductLifecycleStage, ProductLifecycleStage>> = {
  launch: "growth",
  growth: "mature",
  mature: "decline",
  decline: "retired",
};

export interface ProductLifecycleReceipt {
  productId: string;
  turn: number;
  /** Realized, already-debited development cash for this product and turn. */
  paidDevelopmentAnchor: number;
}

export interface PaidProductBrandProgress {
  paidAdvertisingAnchor: number;
  advertisingTurns: number;
  averagePaidAdvertisingAnchor: number;
}

const MAX_PAID_PRODUCT_ADVERTISING_ANCHOR = 1e15;

export function averagePaidProductBrandAnchor(input: {
  paidAdvertisingAnchor: number;
  advertisingTurns: number;
}): number {
  const paid = Number.isFinite(input.paidAdvertisingAnchor)
    ? Math.min(MAX_PAID_PRODUCT_ADVERTISING_ANCHOR, Math.max(0, input.paidAdvertisingAnchor))
    : 0;
  const turns = Number.isSafeInteger(input.advertisingTurns)
    ? Math.max(0, input.advertisingTurns)
    : 0;
  return turns > 0 ? paid / turns : 0;
}

/** Average only settled, positive advertising receipts across the product's development turns. */
export function accumulatePaidProductBrand(input: {
  priorPaidAdvertisingAnchor: number;
  priorAdvertisingTurns: number;
  paidAdvertisingAnchor: number;
}): PaidProductBrandProgress {
  const priorPaid = Number.isFinite(input.priorPaidAdvertisingAnchor)
    ? Math.min(MAX_PAID_PRODUCT_ADVERTISING_ANCHOR, Math.max(0, input.priorPaidAdvertisingAnchor))
    : 0;
  const priorTurns = Number.isSafeInteger(input.priorAdvertisingTurns)
    ? Math.max(0, input.priorAdvertisingTurns)
    : 0;
  const paidThisTurn = Number.isFinite(input.paidAdvertisingAnchor)
    ? Math.min(MAX_PAID_PRODUCT_ADVERTISING_ANCHOR, Math.max(0, input.paidAdvertisingAnchor))
    : 0;
  const paidAdvertisingAnchor = Math.min(
    MAX_PAID_PRODUCT_ADVERTISING_ANCHOR,
    priorPaid + paidThisTurn
  );
  const advertisingTurns = Math.min(Number.MAX_SAFE_INTEGER, priorTurns + 1);
  return {
    paidAdvertisingAnchor,
    advertisingTurns,
    averagePaidAdvertisingAnchor: averagePaidProductBrandAnchor({
      paidAdvertisingAnchor,
      advertisingTurns,
    }),
  };
}

/** Convert paid promotion into bounded brand quality with its monetary scale explicit. */
export function paidProductBrandQualityBonus(input: {
  averagePaidAdvertisingAnchor: number;
  referenceAnchor: number;
  maximumBonus: number;
  coverage: number;
}): number {
  const reference = Number.isFinite(input.referenceAnchor) ? Math.max(0, input.referenceAnchor) : 0;
  const maximum = Number.isFinite(input.maximumBonus) ? Math.max(0, input.maximumBonus) : 0;
  const paid =
    Number.isFinite(input.averagePaidAdvertisingAnchor) && input.averagePaidAdvertisingAnchor > 0
      ? input.averagePaidAdvertisingAnchor
      : 0;
  const audience = Number.isFinite(input.coverage) ? Math.max(0, Math.min(1, input.coverage)) : 0;
  if (paid <= 0 || reference <= 0 || maximum <= 0) return 0;
  return Math.round(Math.min(maximum, (maximum * paid) / (paid + reference)) * audience * 10) / 10;
}

/** Add paid product evidence to live four-pillar quality once, with hard game bounds. */
export function productQualityForPriceDefense(input: {
  baseQuality: number | null | undefined;
  paidQualityBonus: number;
  brandBonus: number;
}): number {
  const base = Number.isFinite(input.baseQuality) ? (input.baseQuality as number) : 50;
  const paidQuality = Number.isFinite(input.paidQualityBonus)
    ? Math.max(0, input.paidQualityBonus)
    : 0;
  const brand = Number.isFinite(input.brandBonus) ? Math.max(0, input.brandBonus) : 0;
  return Math.round(Math.max(0, Math.min(100, base + paidQuality + brand)) * 10) / 10;
}

export type ProductLifecycleDurations = Partial<Record<ProductLifecycleStage, number>>;

export interface ProductLifecycleProgress {
  stage: ProductLifecycleStage;
  stageStartedTurn: number;
  lastProcessedTurn: number;
  developmentPaidAnchor: number;
  elapsedDevelopmentTurns: number;
  active: boolean;
}

/**
 * Advance a product from one settled per-turn receipt. A zero-cash receipt
 * advances elapsed time only; it cannot satisfy an unpaid development cost.
 * The turn stamp and product id make replay and stale-project inputs no-ops.
 */
export function advanceProductLifecycle(input: {
  product: {
    id: string;
    stage: ProductLifecycleStage;
    stageStartedTurn: number;
    startedTurn: number;
    lastProcessedTurn?: number;
    developmentPaidAnchor: number;
    paidThresholdAnchor: number;
    elapsedDevelopmentTurns: number;
    elapsedThresholdTurns: number;
  };
  receipt: ProductLifecycleReceipt;
  /** Optional product-kind cadence. Omitted values preserve industrial defaults. */
  durations?: ProductLifecycleDurations;
}): ProductLifecycleProgress | null {
  const { product, receipt } = input;
  const safeNonNegativeInteger = (value: number): boolean =>
    Number.isSafeInteger(value) && value >= 0;
  if (
    !PRODUCT_LIFECYCLE_STAGES.has(product.stage) ||
    !safeNonNegativeInteger(product.startedTurn) ||
    !safeNonNegativeInteger(product.stageStartedTurn) ||
    product.stageStartedTurn < product.startedTurn ||
    !Number.isFinite(product.developmentPaidAnchor) ||
    product.developmentPaidAnchor < 0 ||
    !Number.isFinite(product.paidThresholdAnchor) ||
    product.paidThresholdAnchor <= 0 ||
    !safeNonNegativeInteger(product.elapsedDevelopmentTurns) ||
    !safeNonNegativeInteger(product.elapsedThresholdTurns) ||
    (product.lastProcessedTurn !== undefined &&
      !safeNonNegativeInteger(product.lastProcessedTurn)) ||
    !safeNonNegativeInteger(receipt.turn) ||
    !Number.isFinite(receipt.paidDevelopmentAnchor) ||
    receipt.paidDevelopmentAnchor < 0
  ) {
    return null;
  }
  if (
    receipt.productId !== product.id ||
    receipt.turn < product.startedTurn ||
    receipt.turn < product.stageStartedTurn ||
    receipt.turn <= (product.lastProcessedTurn ?? 0)
  ) {
    return null;
  }

  const developmentPaidAnchor = product.developmentPaidAnchor + receipt.paidDevelopmentAnchor;
  const elapsedDevelopmentTurns =
    product.stage === "development"
      ? product.elapsedDevelopmentTurns + 1
      : product.elapsedDevelopmentTurns;
  if (!Number.isFinite(developmentPaidAnchor) || !safeNonNegativeInteger(elapsedDevelopmentTurns)) {
    return null;
  }
  let stage = product.stage;
  let stageStartedTurn = product.stageStartedTurn;

  if (stage === "development") {
    if (
      developmentPaidAnchor >= product.paidThresholdAnchor &&
      elapsedDevelopmentTurns >= product.elapsedThresholdTurns
    ) {
      stage = "launch";
      stageStartedTurn = receipt.turn;
    }
  } else {
    const elapsedStageTurns = Math.max(0, receipt.turn - stageStartedTurn + 1);
    const configuredTurns = input.durations?.[stage];
    const stageTurns =
      typeof configuredTurns === "number" &&
      Number.isSafeInteger(configuredTurns) &&
      configuredTurns > 0
        ? configuredTurns
        : PRODUCT_LIFECYCLE_STAGE_TURNS[stage];
    const next = NEXT_STAGE[stage];
    if (stageTurns != null && next && elapsedStageTurns >= stageTurns) {
      stage = next;
      stageStartedTurn = receipt.turn;
    }
  }

  return {
    stage,
    stageStartedTurn,
    lastProcessedTurn: receipt.turn,
    developmentPaidAnchor,
    elapsedDevelopmentTurns,
    active: stage !== "retired",
  };
}
