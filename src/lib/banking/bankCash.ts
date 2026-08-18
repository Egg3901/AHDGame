/**
 * The bank's balance sheet, separate from its holding company's.
 *
 * ## Why two fields and not one field with a rule
 *
 * A chartered bank used to keep its money in `corporation.liquidCapital`, the
 * same field the corporation spends on capacity, shares, bonds and payouts.
 * One pot, two claims on it, and nothing in between. The first attempt at
 * fixing that added a reserve floor to the shared cash guard: the corporation
 * could not spend below `deposits × reserveRatio`.
 *
 * That was the wrong shape twice over. It put a banking rule inside a helper
 * used by thirty-odd unrelated callers, none of which know what a deposit is;
 * and because the engine's deposits never actually arrived as cash, the floor
 * demanded reserves that eight of the twelve live banks had never held, which
 * would have frozen their corporations out of ordinary spending on the turn it
 * shipped.
 *
 * Two balances make the problem go away rather than guarding against it. The
 * corporation spends `liquidCapital`. The bank spends `bankCharter.cashReserves`.
 * Neither can reach the other except through the two operations below, which
 * are the only places the boundary is crossed and therefore the only places the
 * rules have to live.
 *
 * ## The transfer rules are deliberately asymmetric
 *
 * Money goes IN freely and comes OUT under supervision. A shareholder putting
 * their own money at risk behind the depositors needs no permission; the same
 * shareholder taking money back out is reducing the buffer that stands between
 * a bank failure and a depositor haircut, and the recovery waterfall in
 * `insurance.ts` funds payouts from exactly this cash.
 *
 * So: injection is capped only by what the corporation has. Upstreaming is
 * capped by {@link upstreamCapacity} — only genuinely surplus reserves, only
 * from a bank the supervisor calls adequate, and never so much that the bank
 * drops below its reserve requirement.
 */

import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { BankCharter } from "@/lib/db/types/bank";
import {
  bankBalanceSheet,
  getCashReserves as readCashReserves,
  mayDistribute,
  requiredReserves as computeRequiredReserves,
  type BalanceSheetCharter,
} from "@/lib/banking/balanceSheet";

export type BankCashResult =
  | { ok: true; cashReserves: number; liquidCapital: number; amount: number }
  | { ok: false; error: string };

/**
 * Every balance-sheet line this module used to define now lives in
 * `balanceSheet.ts`, which is the single authority (see the note there). These
 * re-exports keep the existing call sites working while there is exactly one
 * implementation behind them.
 */
export {
  getCashReserves,
  cashBackedDeposits,
  requiredReserves,
  bankEquity,
} from "@/lib/banking/balanceSheet";

/**
 * How much the bank may pay up to its parent right now.
 *
 * Thin wrapper over the `distributable` line of the balance sheet: the lower of
 * surplus reserves and book equity, and zero unless the supervisor calls the
 * bank adequate. Distributing above equity is paying shareholders with
 * depositor money; distributing below the reserve requirement is paying them
 * with the reserves that stand behind a run.
 */
export function upstreamCapacity(
  charter: BalanceSheetCharter & Pick<BankCharter, "capitalStanding" | "totalDeposits">,
  reserveRatio: number
): number {
  return bankBalanceSheet({ charter, reserveRatio }).distributable;
}

/**
 * Corporation → bank. Capped only by the corporation's own cash.
 *
 * Increments `postedCapital` alongside the cash, because that is what posted
 * capital has always meant: the cumulative shareholder money standing behind
 * the depositors. The cash is the asset; posted capital is the memo of where it
 * came from, and the resolution waterfall reads both.
 */
export async function injectBankCapital(
  db: Db,
  corporationId: ObjectId,
  amount: number
): Promise<BankCashResult> {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Amount must be a positive number." };
  }
  const move = Math.round(amount);

  // One atomic write across both balances: the corporation's cash and the
  // bank's are fields of the same document, so the transfer cannot half-apply
  // even without transactions (standalone Mongo has none).
  const updated = await db.collection<Corporation>("corporations").findOneAndUpdate(
    {
      _id: corporationId,
      "bankCharter.status": "active",
      liquidCapital: { $gte: move },
    },
    {
      $inc: {
        liquidCapital: -move,
        "bankCharter.cashReserves": move,
        "bankCharter.postedCapital": move,
      },
      $set: { updatedAt: new Date() },
    },
    { returnDocument: "after", projection: { liquidCapital: 1, bankCharter: 1 } }
  );

  if (!updated) {
    return { ok: false, error: "Insufficient corporate funds, or no active charter." };
  }
  return {
    ok: true,
    amount: move,
    cashReserves: readCashReserves(updated.bankCharter),
    liquidCapital: updated.liquidCapital ?? 0,
  };
}

/**
 * Bank → corporation. Only surplus reserves, only from an adequate bank.
 *
 * `postedCapital` comes down with the cash but never below zero: a bank that
 * has earned more than its shareholders put in may upstream those earnings
 * without booking negative contributed capital.
 */
export async function upstreamBankCash(
  db: Db,
  corporationId: ObjectId,
  amount: number,
  reserveRatio: number
): Promise<BankCashResult> {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Amount must be a positive number." };
  }

  const corp = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: corporationId }, { projection: { liquidCapital: 1, bankCharter: 1 } });
  const charter = corp?.bankCharter;
  if (!charter || charter.status !== "active") {
    return { ok: false, error: "This corporation has no active bank charter." };
  }

  if (charter.capitalStanding && !mayDistribute(charter.capitalStanding)) {
    return {
      ok: false,
      error:
        charter.capitalStanding === "undercapitalized"
          ? "The bank is undercapitalized. Post capital rather than taking it out."
          : "The bank failed its stress test, so it may not pay out until it clears.",
    };
  }

  const capacity = upstreamCapacity(charter, reserveRatio);
  const move = Math.round(Math.min(amount, capacity));
  if (move <= 0) {
    return {
      ok: false,
      error:
        "The bank has no distributable capital. Its reserves are required against deposits, or it holds no equity above its deposit liabilities to pay out.",
    };
  }

  const required = computeRequiredReserves(charter, reserveRatio);
  const postedDown = Math.min(move, Math.max(0, charter.postedCapital ?? 0));

  // Re-gate both ceilings inside the write. The read above can go stale against
  // a concurrent injection or a banking turn moving deposits/loans, and the one
  // thing this must never do is leave the bank short of reserves OR pay the
  // owner out of depositor money (post-move book equity must stay non-negative).
  const updated = await db.collection<Corporation>("corporations").findOneAndUpdate(
    {
      _id: corporationId,
      "bankCharter.status": "active",
      $expr: {
        $and: [
          {
            $gte: [{ $subtract: [{ $ifNull: ["$bankCharter.cashReserves", 0] }, move] }, required],
          },
          {
            $gte: [
              {
                $subtract: [
                  {
                    $add: [
                      { $ifNull: ["$bankCharter.cashReserves", 0] },
                      { $max: [0, { $ifNull: ["$bankCharter.totalLoans", 0] }] },
                    ],
                  },
                  {
                    $add: [
                      { $max: [0, { $ifNull: ["$bankCharter.npcDeposits", 0] }] },
                      { $max: [0, { $ifNull: ["$bankCharter.interbankDebt", 0] }] },
                      { $max: [0, { $ifNull: ["$bankCharter.cbMarginDebt", 0] }] },
                      { $max: [0, { $ifNull: ["$bankCharter.discountWindowDebt", 0] }] },
                      // Arrears are borrowings too: unpaid interest is still
                      // owed, and leaving it out of the guard let an owner
                      // upstream exactly the money the bank could not pay.
                      { $max: [0, { $ifNull: ["$bankCharter.discountWindowArrears", 0] }] },
                      { $max: [0, { $ifNull: ["$bankCharter.cbMarginArrears", 0] }] },
                      move,
                    ],
                  },
                ],
              },
              0,
            ],
          },
        ],
      },
    },
    {
      $inc: {
        liquidCapital: move,
        "bankCharter.cashReserves": -move,
        ...(postedDown > 0 ? { "bankCharter.postedCapital": -postedDown } : {}),
      },
      $set: { updatedAt: new Date() },
    },
    { returnDocument: "after", projection: { liquidCapital: 1, bankCharter: 1 } }
  );

  if (!updated) {
    return {
      ok: false,
      error: "The bank's reserves moved while that was in flight. Try again.",
    };
  }
  return {
    ok: true,
    amount: move,
    cashReserves: readCashReserves(updated.bankCharter),
    liquidCapital: updated.liquidCapital ?? 0,
  };
}
