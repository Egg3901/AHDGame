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
}): ProductLifecycleProgress | null {
  const { product, receipt } = input;
  if (
    receipt.productId !== product.id ||
    !Number.isInteger(receipt.turn) ||
    receipt.turn < product.startedTurn ||
    receipt.turn <= (product.lastProcessedTurn ?? 0)
  ) {
    return null;
  }

  const developmentPaidAnchor =
    finiteNonNegative(product.developmentPaidAnchor) +
    finiteNonNegative(receipt.paidDevelopmentAnchor);
  const elapsedDevelopmentTurns =
    product.stage === "development"
      ? Math.floor(finiteNonNegative(product.elapsedDevelopmentTurns)) + 1
      : Math.floor(finiteNonNegative(product.elapsedDevelopmentTurns));
  let stage = product.stage;
  let stageStartedTurn = product.stageStartedTurn;

  if (stage === "development") {
    const paidThresholdAnchor = finiteNonNegative(product.paidThresholdAnchor);
    const elapsedThresholdTurns = Math.floor(finiteNonNegative(product.elapsedThresholdTurns));
    if (
      developmentPaidAnchor >= paidThresholdAnchor &&
      elapsedDevelopmentTurns >= elapsedThresholdTurns
    ) {
      stage = "launch";
      stageStartedTurn = receipt.turn;
    }
  } else {
    const elapsedStageTurns = Math.max(0, receipt.turn - stageStartedTurn + 1);
    const stageTurns = PRODUCT_LIFECYCLE_STAGE_TURNS[stage];
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

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
