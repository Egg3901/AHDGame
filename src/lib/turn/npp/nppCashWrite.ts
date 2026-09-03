import type { ObjectId } from "mongodb";
import type { NppCorpDecision } from "./corpDecisionTypes";

export type NppCorpUpdateOp = {
  filter: { _id: ObjectId; unlockedTechNodeIds?: { $ne: string } };
  update: {
    $set?: Record<string, unknown>;
    $inc?: Record<string, number>;
    $addToSet?: { unlockedTechNodeIds: string };
  };
};

/**
 * Build a composable corporation update. NPP decisions run after operating
 * income is queued in the same ordered bulk write, so cash spending must be a
 * delta. An absolute balance write would erase that income.
 */
export function buildNppCorpUpdateOp(decision: NppCorpDecision): NppCorpUpdateOp | null {
  const cashDelta = Number.isFinite(decision.liquidCapitalDelta) ? decision.liquidCapitalDelta : 0;
  const hasSet = Object.keys(decision.updates).length > 0;
  if (!hasSet && cashDelta === 0) return null;

  return {
    filter: { _id: decision.corpId },
    update: {
      ...(hasSet ? { $set: decision.updates } : {}),
      ...(cashDelta !== 0 ? { $inc: { liquidCapital: cashDelta } } : {}),
    },
  };
}
