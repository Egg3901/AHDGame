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
import { formatPayoutCap, getEffectivePlayerPayoutCap } from "@/lib/treasury/payoutCapValues";

export {
  countDistinctOfficers,
  getEffectivePlayerPayoutCap,
  getPlayerPayoutCap,
  PAYOUT_CAP_MULTI_OFFICER_MIN_SEATS,
  PAYOUT_CAP_MULTI_OFFICER_MULTIPLIER,
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
    /**
     * Distinct officers seated on the body making the payment. Two or
     * more raise the ceiling; see
     * `PAYOUT_CAP_MULTI_OFFICER_MULTIPLIER`. Omitted means "treat as a
     * lone officer", which is the safe reading for any caller that has
     * not been taught to count.
     */
    seatedOfficers?: number;
  }
): Promise<PayoutCapCheck> {
  const cap = getEffectivePlayerPayoutCap(args.countryId, args.seatedOfficers ?? 0);
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
      // The ceiling is the PAYING body's, while `used` counts every
      // source. A member paid up to a well staffed party's higher
      // ceiling then hits a lone officer's lower one, so saying they
      // "already received the maximum of $2,000,000" would name a
      // figure they never hit. State what they actually drew.
      reason:
        remaining === 0
          ? `This member has already received ${formatPayoutCap(args.countryId, used)} from party funds this turn, which is at or over the ${formatPayoutCap(args.countryId, cap)} this treasury may pay one member. Try again next turn.`
          : `This member can receive ${formatPayoutCap(args.countryId, remaining)} more from party funds this turn, out of the ${formatPayoutCap(args.countryId, cap)} this treasury may pay one member.`,
    };
  }
  return { ok: true, cap, used, remaining };
}
