/**
 * Put personal money into the treasury of a union you lead.
 *
 * Player ticket #1121 asked "how do I send money to a union", while still
 * building one, and the honest answer was that there was no way at all. Dues
 * were the only inflow, and dues are collected once a turn from a membership the
 * union must first win, so a new union had no route from zero treasury to the
 * 1,000 an organizing drive costs. A head could found a union and then be unable
 * to act with it. Ticket #1112 ("what is the treasury and how do I get more of
 * it") is the same gap read from the other side.
 *
 * Head-only on purpose. Letting any character push cash into any union would be
 * a clean channel for moving money between players with no trace of why, which
 * is exactly the shape of the alt-funding rings the forensics work exists to
 * catch. A head funding their own union is a leader spending their own money on
 * their own project, and it is already visible as a treasury movement.
 */
import type { Db } from "mongodb";
import type { Character, Union } from "@/lib/db/types";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import {
  atomicallyDebitCharacterCash,
  refundCharacterCash,
} from "@/lib/financialTxLog/atomicCashGuard";
import { rejectIfTurnProcessing, resolveOwnedUnion } from "./unionActions";
import type { UnionActionResult } from "./unionActions";

/**
 * Smallest contribution worth a write. Not a balance question: it stops a
 * fractional-amount request from spending a turn's rate limit on a treasury
 * movement that rounds to nothing.
 */
export const MIN_UNION_CONTRIBUTION = 1;

/**
 * Fund the treasury of the union `character` leads.
 *
 * The debit is the same conditional single-document guard every other cash
 * spend uses, so two concurrent contributions can never both pass on a stale
 * balance. If the treasury credit then fails the cash is refunded, so the
 * failure mode is "nothing happened", never "charged for nothing".
 */
export async function fundUnionTreasury(
  db: Db,
  character: Character,
  unionId: string,
  amount: number
): Promise<UnionActionResult> {
  const turnBusy = await rejectIfTurnProcessing(db);
  if (turnBusy) return turnBusy;

  const resolved = await resolveOwnedUnion(db, character, unionId);
  if (!resolved.ok) return resolved;
  const { union } = resolved;

  if (!Number.isFinite(amount) || amount < MIN_UNION_CONTRIBUTION) {
    return {
      ok: false,
      status: 400,
      error: `Enter an amount of at least ${MIN_UNION_CONTRIBUTION}.`,
    };
  }
  // Whole units only: the treasury is displayed rounded, so a fractional
  // contribution would read as money that vanished.
  const contribution = Math.floor(amount);

  const forexEnabled = await isForexEnabled();
  const homeCurrency = getHomeCurrency(character);
  const debit = await atomicallyDebitCharacterCash(
    db,
    character._id,
    homeCurrency,
    contribution,
    forexEnabled
  );
  if (!debit.ok) {
    return {
      ok: false,
      status: 402,
      error: `You do not have ${contribution.toLocaleString()} ${homeCurrency} on hand.`,
    };
  }

  try {
    const credited = await db
      .collection<Union>("unions")
      .updateOne(
        { _id: union._id },
        { $inc: { treasury: contribution }, $set: { updatedAt: new Date() } }
      );
    if (credited.modifiedCount === 0) {
      throw new Error("union treasury credit matched no document");
    }
  } catch {
    await refundCharacterCash(db, character._id, homeCurrency, contribution, forexEnabled);
    return {
      ok: false,
      status: 500,
      error: "The contribution did not go through, you have been refunded.",
    };
  }

  return {
    ok: true,
    status: 200,
    contributed: contribution,
    currency: homeCurrency,
    treasury: (union.treasury ?? 0) + contribution,
  };
}
