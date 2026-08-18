import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { acquirerOwnershipPercent } from "@/lib/corporations/corporateOwnership";
import {
  corporationWithReservedHoldings,
  loadReservedCorporatePositions,
} from "@/lib/corporations/reservedCorporateHoldings";
import { SUBSIDIARY_FORMALIZATION_THRESHOLD_PERCENT } from "../constants";
import {
  isEligibleAsSubsidiary,
  isEligibleAsSubsidiaryParent,
  wouldCreateOwnershipCycle,
} from "../helpers";
import { fail, type SubsidiaryCommandResult } from "../commandTypes";

export interface FormalizeSubsidiaryInput {
  parent: Corporation;
  target: Corporation;
  callerUserId: ObjectId;
  turn: number;
  now: Date;
}

/**
 * Formalize `target` as a managed subsidiary of `parent`. Sets the derived-model
 * marker `subsidiaryFormalizedAtTurn` on the target only — no stored parent id.
 */
export async function formalizeSubsidiary(
  db: Db,
  input: FormalizeSubsidiaryInput
): Promise<SubsidiaryCommandResult<{ subsidiaryFormalizedAtTurn: number }>> {
  const { parent, target, callerUserId, turn, now } = input;

  // Caller must be the sitting CEO/owner of the parent.
  if (parent.ceoVacant === true || !parent.userId || !parent.userId.equals(callerUserId)) {
    return fail("You must be the CEO of the parent corporation.", 403);
  }

  if (parent._id.equals(target._id)) {
    return fail("A corporation cannot be its own subsidiary.");
  }

  // National corps excluded on both sides.
  if (!isEligibleAsSubsidiaryParent(parent)) {
    return fail(
      "This corporation cannot act as a parent (national corporations and existing subsidiaries are excluded).",
      403
    );
  }
  if (!isEligibleAsSubsidiary(target)) {
    return fail("National corporations cannot be held as subsidiaries.");
  }

  // Must control >50% VOTING power (super-shares aware), not raw shares.
  // Count unsold shares still reserved on a corp sell/listing so listing a
  // controlling block does not block re-formalization before the trade fills.
  const reserved = await loadReservedCorporatePositions(db, target._id);
  const votingPct = acquirerOwnershipPercent(
    parent._id,
    corporationWithReservedHoldings(target, reserved)
  );
  if (votingPct <= SUBSIDIARY_FORMALIZATION_THRESHOLD_PERCENT) {
    return fail(
      `The parent must control more than ${SUBSIDIARY_FORMALIZATION_THRESHOLD_PERCENT}% of the target's voting power to formalize a subsidiary (currently ${
        Math.round(votingPct * 100) / 100
      }%).`
    );
  }

  if (target.subsidiaryFormalizedAtTurn != null) {
    return fail("This corporation is already a formalized subsidiary.");
  }

  // No chaining / no cycles. Fetch the minimal cap-table fields for every corp.
  const allCorps = await db
    .collection<Corporation>("corporations")
    .find({}, { projection: { _id: 1, shareholders: 1, totalShares: 1, superShareMultiplier: 1 } })
    .toArray();
  if (wouldCreateOwnershipCycle(parent, target, allCorps)) {
    return fail("Formalizing this subsidiary would create an ownership cycle.");
  }

  // Same-human guard: a subsidiary must be run by a different player than the
  // parent owner. If the target's current human operator is the parent owner,
  // they must seat a different CEO (human or NPP) first.
  if (target.ceoType !== "npp" && target.userId && target.userId.equals(parent.userId)) {
    return fail(
      "A subsidiary must be run by a different player than the parent. Seat a different CEO (a player or an NPP caretaker) on the target first."
    );
  }

  const result = await db
    .collection<Corporation>("corporations")
    .updateOne(
      { _id: target._id, subsidiaryFormalizedAtTurn: { $exists: false } },
      { $set: { subsidiaryFormalizedAtTurn: turn, updatedAt: now } }
    );
  if (result.matchedCount === 0) {
    return fail("This corporation is already a formalized subsidiary.", 409);
  }

  return { ok: true, subsidiaryFormalizedAtTurn: turn };
}
