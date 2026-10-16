/** Owned plants and paid construction determine capacity; sales and quotes do not. */
import type { SectorBuildOrder } from "@/lib/db/types";
import {
  costReleasedThisTurn,
  queueUndeliveredCost,
  unitsDeliveredThisTurn,
} from "@/lib/corporations/buildDelivery";
import { CAPITAL_DEPRECIATION_PER_TURN } from "@/lib/market/capital";
import { TURNS_PER_DAY } from "@/lib/constants/turnTime";

export interface ProducerCapacityState {
  completedTurn: number;
  /** Daily units on the current owned recipe basis, including parked capacity. */
  ownedDailyUnits: number;
  /** Actual acquisition cost remaining on the owned stock, never its selling value. */
  paidBookAnchor: number;
  buildQueue: readonly SectorBuildOrder[];
}

function nonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
}

/** Validate the reconciled opening without advancing or consuming construction. */
export function validateProducerCapacityState(state: ProducerCapacityState): void {
  if (!Number.isSafeInteger(state.completedTurn) || state.completedTurn < 0)
    throw new Error("Invalid capacity opening turn");
  nonNegative(state.ownedDailyUnits, "owned capacity");
  nonNegative(state.paidBookAnchor, "paid capacity basis");
  if (state.ownedDailyUnits === 0 && state.paidBookAnchor !== 0)
    throw new Error("Paid basis without owned capacity requires reconciliation");
  for (const order of state.buildQueue) {
    nonNegative(order.unitsOrdered, "ordered capacity");
    nonNegative(order.costPaidAnchor, "construction payment");
    if (
      !Number.isFinite(order.startTurn) ||
      !Number.isSafeInteger(order.onlineTurn) ||
      order.startTurn < 0 ||
      order.startTurn > state.completedTurn ||
      order.onlineTurn < order.startTurn ||
      order.onlineTurn <= state.completedTurn ||
      (order.unitsOrdered === 0 && order.costPaidAnchor !== 0)
    )
      throw new Error("Invalid unsettled construction schedule");
  }
}

export function advanceProducerCapacity(input: {
  state: ProducerCapacityState;
  turn: number;
  activeFraction: number;
  /** Temporary recipe conversion; never changes owned stock or its paid basis. */
  operatingRecipeRatio: number;
  /** Additional physical depreciation, applied to units and paid basis together. */
  recessionCapacityFactor: number;
}) {
  const { state, turn } = input;
  if (
    !Number.isSafeInteger(state.completedTurn) ||
    state.completedTurn < 0 ||
    !Number.isSafeInteger(turn) ||
    turn !== state.completedTurn + 1
  )
    throw new Error("Capacity requires the next unsettled turn");
  validateProducerCapacityState(state);
  nonNegative(input.activeFraction, "active fraction");
  nonNegative(input.operatingRecipeRatio, "operating recipe ratio");
  nonNegative(input.recessionCapacityFactor, "recession factor");
  if (input.activeFraction > 1 || input.recessionCapacityFactor > 1)
    throw new Error("Invalid physical capacity fraction");
  const deliveredDailyUnits = state.buildQueue.reduce(
    (sum, order) => sum + unitsDeliveredThisTurn(order, turn),
    0
  );
  const deliveredPaidCostAnchor = state.buildQueue.reduce(
    (sum, order) => sum + costReleasedThisTurn(order, turn),
    0
  );
  const retention = (1 - CAPITAL_DEPRECIATION_PER_TURN) * input.recessionCapacityFactor;
  const ownedDailyUnits = nonNegative(
    (state.ownedDailyUnits + deliveredDailyUnits) * retention,
    "closing owned capacity"
  );
  const paidBookAnchor = nonNegative(
    (state.paidBookAnchor + deliveredPaidCostAnchor) * retention,
    "closing paid capacity basis"
  );
  const buildQueue = state.buildQueue.filter((order) => order.onlineTurn > turn);
  const constructionInProgressAnchor = nonNegative(
    queueUndeliveredCost(buildQueue, turn),
    "closing construction value"
  );
  const capacityUnits = nonNegative(
    (ownedDailyUnits * input.operatingRecipeRatio) / TURNS_PER_DAY,
    "per-turn operating capacity"
  );
  return {
    state: { completedTurn: turn, ownedDailyUnits, paidBookAnchor, buildQueue },
    capacityUnits,
    activeUnits: capacityUnits * input.activeFraction,
    deliveredDailyUnits,
    deliveredPaidCostAnchor,
    constructionInProgressAnchor,
    depreciationAnchor: state.paidBookAnchor + deliveredPaidCostAnchor - paidBookAnchor,
  };
}
