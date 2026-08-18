import type { Db } from "mongodb";

/**
 * Idempotency keys for defence procurement money movements.
 *
 * Mongo runs single-node here, so there are no transactions: a delivery is a debit, a credit
 * and a contract update that can each land independently, and a retried turn (a crashed sweep,
 * an operator re-run, two overlapping turn processes) would repeat all three. The only way to
 * make that safe without transactions is to CLAIM THE KEY FIRST and treat the duplicate-key
 * error as "someone already did this" - a unique `_id` insert is the one atomic primitive
 * available.
 *
 * Claiming BEFORE the money moves, never after, is the whole point. A key written after the
 * transfer leaves a window where the transfer happened and the claim did not, and the retry
 * pays twice.
 */
interface DefenceMoneyClaim {
  _id: string;
  countryId: string;
  contractId: string;
  turn: number;
  amount: number;
  claimedAt: Date;
}

function claims(db: Db) {
  return db.collection<DefenceMoneyClaim>("defenceMoneyClaims");
}

/** One key per contract per turn: a contract settles at most once in any turn, ever. */
export function deliveryClaimKey(contractId: string, turn: number): string {
  return `delivery:${contractId}:${turn}`;
}

/**
 * Take the key, or report that it is already taken.
 *
 * Returns true when THIS caller owns the claim and must proceed, false when the work is
 * already done and the caller must skip. Any error other than a duplicate key is rethrown:
 * a claim store that is failing for another reason must stop the sweep rather than be read
 * as permission to move money unguarded.
 */
export async function claimDefenceMoneyMove(
  db: Db,
  key: string,
  detail: { countryId: string; contractId: string; turn: number; amount: number }
): Promise<boolean> {
  try {
    await claims(db).insertOne({ _id: key, ...detail, claimedAt: new Date() });
    return true;
  } catch (error) {
    if ((error as { code?: number })?.code === 11000) return false;
    throw error;
  }
}

/**
 * Give a claim back when the work it guarded did not happen after all.
 *
 * Only correct BEFORE any money has moved - an award whose encumbrance failed, say. Once a
 * transfer has landed the key must stay, or the retry repeats it.
 */
export async function releaseDefenceMoneyClaim(db: Db, key: string): Promise<void> {
  await claims(db).deleteOne({ _id: key });
}
