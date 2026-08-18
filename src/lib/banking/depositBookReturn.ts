/**
 * The one way a bank's deposit book ever goes away.
 *
 * ## Why there is only one
 *
 * There were four. A bank could fail (solvency pass), be revoked by the
 * central-bank chair, be unwound by an admin, or switch to a charter that
 * cannot hold deposits. Each of those wrote its own version of "give the
 * deposits back", and three of the four were wrong in a different way:
 *
 *  - **Revocation did nothing at all.** It set `status: "revoked"`, refused to
 *    refund the owner while deposits existed, and left every depositor pointed
 *    at a dead bank with `npcDeposits` still on its books. That is ticket 1093:
 *    a revoke erased the balance sheet and stranded the money.
 *  - **Charter switch and admin unwind duplicated money.** Both credited the
 *    central bank's `externalBroadMoney` with the household deposit book while
 *    leaving the matching cash in `cashReserves`. The same money then existed
 *    in the money supply AND in the bank, and on unwind it was handed to the
 *    shareholder as a refund on top.
 *  - **Failure resolution paid pointer depositors out of a cash pot that never
 *    held their money**, and destroyed the difference as a haircut.
 *
 * One path, four causes. Every cause claims an idempotency key first, moves
 * cash with {@link applyMoneyMove} so the legs must net to zero, and pays out
 * in a stated priority order.
 *
 * ## The two deposit kinds part company here, and this is why it is short
 *
 * Household (NPC) deposits are cash: `bankingTurn` moved real money out of
 * `externalBroadMoney` into `cashReserves` to create them, so returning them
 * moves real money back, and any shortfall is a real hole that deposit
 * insurance fills.
 *
 * Player savings are a pointer. The balance never left the character; the bank
 * only held the label. Returning them flips the label and moves nothing, and a
 * bank failure therefore does NOT confiscate a player's principal.
 *
 * That last point is a deliberate change from the old resolution, which
 * haircut player balances and then had the insurance fund pay for the balances
 * it did not haircut. Both halves of that were money that appeared or vanished
 * with nobody on the other side, which is precisely the disease. A player who
 * banks with a bank that fails loses the yield and the counterparty, not the
 * money that was never sent. Deposit insurance still exists and still matters:
 * it stands behind the household book, which is the part made of cash.
 *
 * ## Priority order
 *
 * 1. Household depositors, from the bank's cash, backstopped by the insurance
 *    fund and then the treasury.
 * 2. The owner, and only up to book equity: cash beyond equity belongs to the
 *    bank's other creditors, so it stays on the charter rather than being
 *    handed to a shareholder.
 */

import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { Character } from "@/lib/db/types/character";
import type { DepositInsuranceFund } from "@/lib/db/types/bank";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { bankEquity, cashBackedDeposits, getCashReserves } from "@/lib/banking/balanceSheet";
import { applyMoneyMove, type MoneyMoveLeg } from "@/lib/banking/moneyMove";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { FederalBudget } from "@/lib/db/types";

/** Budget spending line a deposit insurance backstop is booked against. */
export const DEPOSIT_INSURANCE_SPENDING_KEY = "depositInsurance";

export type DepositBookReturnCause =
  /** The solvency pass failed the bank. */
  | "failure"
  /** The supervisor or the central-bank chair pulled the charter. */
  | "revocation"
  /** An operator force-unwound a stuck bank. */
  | "admin_unwind"
  /** The bank moved to a charter type that cannot hold deposits. */
  | "charter_switch";

export interface DepositBookReturnResult {
  /** False when there was nothing to do, or another runner owned the move. */
  returned: boolean;
  depositorsFlipped: number;
  /** Household deposits put back into the money supply. */
  npcReturned: number;
  /** Of that, paid out of the bank's own cash. */
  fromBankCash: number;
  fromInsuranceFund: number;
  fromTreasury: number;
  /** Surplus cash released to the owner, capped at book equity. */
  ownerResidual: number;
  error?: string;
}

const EMPTY: DepositBookReturnResult = {
  returned: false,
  depositorsFlipped: 0,
  npcReturned: 0,
  fromBankCash: 0,
  fromInsuranceFund: 0,
  fromTreasury: 0,
  ownerResidual: 0,
};

export function depositBookReturnKey(
  corporationId: ObjectId | string,
  cause: DepositBookReturnCause,
  turn: number
): string {
  return `deposit-book-return:${corporationId.toString()}:${cause}:${turn}`;
}

/**
 * Return a bank's deposit book: pointers to the central bank, household cash to
 * the money supply, residual equity to the owner.
 *
 * Safe to call on a bank with no deposits (it flips nothing and moves nothing)
 * and safe to call twice with the same turn and cause.
 */
export async function returnDepositBook(
  db: Db,
  corporationId: ObjectId,
  options: {
    cause: DepositBookReturnCause;
    turn: number;
    /** Pay any surplus above the household book to the parent. */
    releaseResidualToOwner: boolean;
  }
): Promise<DepositBookReturnResult> {
  const corp = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: corporationId }, { projection: { bankCharter: 1, liquidCapital: 1 } });
  const charter = corp?.bankCharter;
  if (!corp || !charter) return EMPTY;

  const currency = charter.currency as CurrencyCode;
  const bankIdHex = corporationId.toString();
  const holderPath = `currencyBalances.savingsHolder.${currency}`;
  const now = new Date();

  // Pointer flip first, and outside the money move: it is not a money movement
  // at all, it is a label, and it is idempotent by construction (a second run
  // matches nothing). Doing it first means a crash mid-way leaves depositors
  // free of a dead bank rather than trapped in one.
  const flip = await db
    .collection<Character>("characters")
    .updateMany(
      { [holderPath]: bankIdHex },
      { $set: { [holderPath]: "centralBank", updatedAt: now } }
    );
  const depositorsFlipped = flip.modifiedCount ?? 0;

  const npc = cashBackedDeposits(charter);
  const cash = getCashReserves(charter);
  const equity = bankEquity(charter);

  const fromBankCash = Math.min(cash, npc);
  const shortfall = Math.max(0, npc - fromBankCash);

  // The fund pays what it has; the treasury covers the rest by deficit, which
  // is money entering the world and is booked as such.
  const fund = await db
    .collection<DepositInsuranceFund>("depositInsuranceFunds")
    .findOne({ _id: currency });
  const fundBalance = Math.max(0, fund?.balance ?? 0);
  const fromInsuranceFund = Math.min(fundBalance, shortfall);
  const fromTreasury = Math.max(0, shortfall - fromInsuranceFund);

  // Cash left after the household book is settled belongs to the owner, but
  // only as far as book equity: anything above that is owed to the bank's
  // lenders, and paying it out is the "distribution funded by borrowing" hole
  // the upstream guard already refuses to open.
  const surplus = Math.max(0, cash - fromBankCash);
  const ownerResidual = options.releaseResidualToOwner ? Math.max(0, Math.min(surplus, equity)) : 0;

  const cbDocId = getBankId(getCountryIdForCurrency(currency));
  const legs: MoneyMoveLeg[] = [];

  if (npc > 0) {
    if (fromBankCash > 0) {
      legs.push({
        kind: "debit",
        amount: fromBankCash,
        collection: "corporations",
        filter: { _id: corporationId },
        path: "bankCharter.cashReserves",
        note: "household deposits returned from the bank's own cash",
      });
    }
    if (fromInsuranceFund > 0) {
      legs.push({
        kind: "debit",
        amount: fromInsuranceFund,
        collection: "depositInsuranceFunds",
        filter: { _id: currency },
        path: "balance",
        note: "deposit insurance fund covers the shortfall",
      });
    }
    if (fromTreasury > 0) {
      legs.push({
        kind: "mint",
        amount: fromTreasury,
        note: "treasury backstop, deficit financed",
      });
    }
    legs.push({
      kind: "credit",
      amount: npc,
      collection: "centralBanks",
      filter: { _id: cbDocId },
      path: "externalBroadMoney",
      note: "household deposits back into the money supply",
    });
  }

  if (ownerResidual > 0) {
    legs.push({
      kind: "debit",
      amount: ownerResidual,
      collection: "corporations",
      filter: { _id: corporationId },
      path: "bankCharter.cashReserves",
      note: "residual bank equity released to the parent",
    });
    legs.push({
      kind: "credit",
      amount: ownerResidual,
      collection: "corporations",
      filter: { _id: corporationId },
      path: "liquidCapital",
      note: "residual bank equity received by the parent",
    });
  }

  if (legs.length === 0) {
    // Nothing to move, but the pointer flip and the aggregate clear still have
    // to happen: a book of pointer-only deposits is exactly this case.
    await clearDepositAggregates(db, corporationId, options.turn, options.cause);
    return { ...EMPTY, returned: depositorsFlipped > 0, depositorsFlipped };
  }

  const move = await applyMoneyMove(db, {
    key: depositBookReturnKey(corporationId, options.cause, options.turn),
    kind: "deposit_book_return",
    turn: options.turn,
    legs,
  });

  if (move.status === "replayed") {
    return { ...EMPTY, depositorsFlipped };
  }
  if (move.status === "rejected" || move.status === "partial") {
    return { ...EMPTY, depositorsFlipped, error: move.error };
  }

  if (fromTreasury > 0) {
    // Fiscal bookkeeping for money the `mint` leg already created: this records
    // who is on the hook for it.
    await debitTreasuryDepositInsurance(db, currency, fromTreasury);
  }

  if (fromInsuranceFund > 0 || fromTreasury > 0) {
    await db.collection<DepositInsuranceFund>("depositInsuranceFunds").updateOne(
      { _id: currency },
      {
        $inc: {
          payoutsLifetime: fromInsuranceFund + fromTreasury,
          treasuryBackstopLifetime: fromTreasury,
        },
      }
    );
  }

  await clearDepositAggregates(db, corporationId, options.turn, options.cause);

  return {
    returned: true,
    depositorsFlipped,
    npcReturned: npc,
    fromBankCash,
    fromInsuranceFund,
    fromTreasury,
    ownerResidual,
  };
}

/**
 * Zero the deposit aggregates AFTER the cash has moved, never before.
 *
 * Order matters and used to be the other way round: `adminUnwind` cleared the
 * aggregates so that `revokeCharter` would see an empty book and refund the
 * owner, which is how a shareholder ended up with the depositors' cash.
 */
async function clearDepositAggregates(
  db: Db,
  corporationId: ObjectId,
  turn: number,
  cause: DepositBookReturnCause
): Promise<void> {
  await db.collection<Corporation>("corporations").updateOne(
    { _id: corporationId },
    {
      $set: {
        "bankCharter.npcDeposits": 0,
        "bankCharter.totalDeposits": 0,
        // The floor follows the deposits out, otherwise the corp stays locked
        // out of its own cash until the next banking turn recomputes it.
        "bankCharter.reserveFloor": 0,
        ...(cause === "failure" ? { "bankCharter.depositorsResolvedTurn": turn } : {}),
        updatedAt: new Date(),
      },
    }
  );
}

/**
 * Debit treasuryBalance and book the spend on spending.byCategory.depositInsurance.
 * Unconditional: an unaffordable backstop pushes the treasury into debt.
 */
export async function debitTreasuryDepositInsurance(
  db: Db,
  currency: CurrencyCode,
  amount: number
): Promise<void> {
  if (!(amount > 0)) return;
  const countryId = getCountryIdForCurrency(currency);
  const budgetId = getNationalBudgetId(countryId);
  const now = new Date();
  await db.collection<FederalBudget>("federalBudget").updateOne(
    { _id: budgetId },
    {
      $inc: {
        treasuryBalance: -amount,
        [`spending.byCategory.${DEPOSIT_INSURANCE_SPENDING_KEY}`]: amount,
        "spending.total": amount,
        surplus: -amount,
      },
      $set: { updatedAt: now },
    }
  );
}
