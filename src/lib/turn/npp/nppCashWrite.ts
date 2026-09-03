/**
 * Builds the corporation bulkWrite op for one NPP decision (ticket #1260).
 *
 * `liquidCapital` is written twice per corporation turn, into the SAME ordered
 * bulkWrite. `sectorCalculations` pushes the operating income as
 * `$inc: { liquidCapital: incomeForBalance }`, and `corporation/index.ts` then
 * APPENDS the NPP decision's ops (see the "Merge NPP corp updates" block). An
 * ordered bulkWrite applies per-document ops in array order, so anything the
 * NPP writes lands last.
 *
 * The NPP decision therefore must never write `liquidCapital` absolutely. It
 * used to carry `$set: { liquidCapital: cashLocal }`, where `cashLocal` was
 * seeded from `corp.liquidCapital` as read at the top of the NPP phase — before
 * the income credit existed. That $set overwrote the credit with a pre-income
 * figure, so the turn's entire operating income vanished.
 *
 * Measured on live Value Mart (IT #80): across turns 555-582, 21 of 28 turns
 * reconcile to the lira as `close == open + late-phase flows` with the whole
 * ~£11M of operating income absent, and 0 of 28 reconcile if it had landed.
 * Because ANY placed build assigned the field, a £221 maintenance build was
 * enough to destroy £11,000,000 of income. Bond coupons and supply settlements
 * survived only because later phases apply them with their own `$inc` after the
 * corporation turn had finished.
 *
 * So the cash leg travels as a DELTA and is emitted as `$inc`, which composes
 * with the income credit and with every other phase rather than racing them.
 * This is the same shape the tech-unlock path in `nppCorporationBehavior` has
 * always used (`$inc: { liquidCapital: -cashCost }`); it is now the rule for
 * every NPP cash movement, not just that one.
 */

import type { ObjectId } from "mongodb";
import type { NppCorpDecision } from "./corpDecisionTypes";

export type NppCorpUpdateOp = {
  filter: { _id: ObjectId; unlockedTechNodeIds?: { $ne: string } };
  update: {
    $set: Record<string, unknown>;
    $inc?: Record<string, number>;
    $addToSet?: { unlockedTechNodeIds: string };
  };
};

/**
 * Turn a decision into its corporation op, or null when it changes nothing.
 *
 * The cash spend is gated separately from `updates` on purpose: with cash no
 * longer living in `updates`, a decision whose only effect is a spend would be
 * dropped by an `Object.keys(updates).length > 0` check.
 */
export function buildNppCorpUpdateOp(decision: NppCorpDecision): NppCorpUpdateOp | null {
  const delta = decision.liquidCapitalDelta ?? 0;
  // A non-finite `$inc` sets the field to NaN and poisons every later read of
  // it, so drop it rather than corrupt the balance — `sectorCalculations`
  // carries a guard comment about this exact class of write.
  const cashDelta = Number.isFinite(delta) ? Math.round(delta) : 0;
  const hasSet = Object.keys(decision.updates).length > 0;
  if (!hasSet && cashDelta === 0) return null;

  return {
    filter: { _id: decision.corpId },
    update: {
      $set: decision.updates,
      ...(cashDelta !== 0 ? { $inc: { liquidCapital: cashDelta } } : {}),
    },
  };
}
