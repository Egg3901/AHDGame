/**
 * Per-player cap on money received from party funds, per turn.
 *
 * A turn is one hour, so these are hourly ceilings. The cap is a rate
 * limit, not a permission check: it does not stop an officer paying
 * themselves, it stops them emptying a treasury in a single unnoticed
 * transaction. Draining a large treasury becomes many turns of visible
 * activity that other members can react to.
 *
 * The cap is COMBINED across every party-money source: the national
 * party treasury, every state party, and every caucus. Anything narrower
 * is trivially bypassed, because the national Chair is authorised on
 * every state party of their own party — a per-source cap would let them
 * draw the cap from each of hundreds of state treasuries in the same
 * turn.
 *
 * Amounts are in each country's local currency, which is why the cap is
 * a per-country table rather than one global constant: the same figure
 * is a hard ceiling in one economy and no constraint at all in another.
 */

import type { Db } from "mongodb";
import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getPlayerPayoutCap } from "@/lib/treasury/payoutCapValues";

export {
  getPlayerPayoutCap,
  PLAYER_PAYOUT_CAP_PER_TURN,
  DEFAULT_PLAYER_PAYOUT_CAP_PER_TURN,
} from "@/lib/treasury/payoutCapValues";

/**
 * Total already paid to this character from party funds this turn.
 *
 * Reads the treasury ledger rather than a counter, so it stays correct
 * without a migration and picks up every route that emits a transfer.
 * Sums across holder types (party / state_party / caucus) deliberately.
 */
export async function getPlayerPayoutThisTurn(
  db: Db,
  characterId: ObjectId,
  countryId: CountryId,
  currentTurn: number
): Promise<number> {
  const [row] = await db
    .collection("treasuryTransactions")
    .aggregate<{ total: number }>([
      {
        $match: {
          countryId,
          turn: currentTurn,
          category: "transfers",
          direction: "debit",
          "counterparty.type": "character",
          "counterparty.id": characterId.toString(),
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ])
    .toArray();
  return row?.total ?? 0;
}

export type PayoutCapCheck =
  | { ok: true; cap: number; used: number; remaining: number }
  | { ok: false; cap: number; used: number; remaining: number; reason: string };

/**
 * Whether paying `amount` to this character would breach their cap for
 * the current turn.
 *
 * This is a read-then-check, so two payouts landing in the same instant
 * can both pass and overshoot slightly. That is acceptable for a rate
 * limit: the overshoot is bounded by one payment, and the next turn's
 * check sees the full ledger. It is not a substitute for the balance
 * guards, which stay atomic.
 */
export async function checkPlayerPayoutCap(
  db: Db,
  args: {
    characterId: ObjectId;
    countryId: CountryId;
    currentTurn: number;
    amount: number;
  }
): Promise<PayoutCapCheck> {
  const cap = getPlayerPayoutCap(args.countryId);
  const used = await getPlayerPayoutThisTurn(
    db,
    args.characterId,
    args.countryId,
    args.currentTurn
  );
  const remaining = Math.max(0, cap - used);
  if (args.amount > remaining) {
    return {
      ok: false,
      cap,
      used,
      remaining,
      reason:
        remaining === 0
          ? `This member has already received the maximum of $${cap.toLocaleString()} from party funds this turn. Try again next turn.`
          : `This member can receive $${remaining.toLocaleString()} more from party funds this turn, out of a maximum of $${cap.toLocaleString()}.`,
    };
  }
  return { ok: true, cap, used, remaining };
}
