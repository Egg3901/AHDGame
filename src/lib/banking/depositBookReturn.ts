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
 * 1. **Secured central bank facilities**: the discount window and the CB margin
 *    line, principal and arrears. They rank first because they are the only
 *    collateralized claims in the model and because a lender of last resort
 *    that can lose money on a failure is not a lender of last resort: if the
 *    window ranked behind depositors, the central bank would have to price
 *    failure risk into an emergency facility whose entire purpose is to be
 *    available when a bank is already in trouble. Both facilities MINTED their
 *    principal into existence on the draw, so repaying them destroys the same
 *    money, recorded as an explicit `burn`.
 * 2. **Household depositors**, from what cash is left, backstopped by the
 *    insurance fund and then the treasury. The taxpayer therefore stands behind
 *    the central bank here rather than beside it, which is the deliberate
 *    consequence of ranking the window first.
 * 3. **Interbank lenders**, pro rata across their outstanding principal. Real
 *    cash left those banks, so this is a real recovery, and the unpaid part is
 *    a real loss recorded against the loan.
 * 4. **The owner**, and only up to book equity: cash beyond equity belongs to
 *    the bank's creditors, so it stays on the charter rather than being handed
 *    to a shareholder.
 *
 * Everything above the first line used to happen nowhere. Interbank loans were
 * flipped to `defaulted` with no recovery attempt at all, the CB margin claim
 * was extinguished by an empty `if` block with a comment in it, and the
 * discount window was not mentioned in the failure path in any form.
 */

import { ObjectId, type Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { Character } from "@/lib/db/types/character";
import type { DepositInsuranceFund, InterbankLoan } from "@/lib/db/types/bank";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { bankEquity, cashBackedDeposits, getCashReserves } from "@/lib/banking/balanceSheet";
import { settleTransition } from "@/lib/banking/settlementJournal";
import { oid, type TransitionLeg, type TransitionProjection } from "@/lib/banking/rules/boundary";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { FederalBudget } from "@/lib/db/types";
import { emitBankingAuditEvent } from "@/lib/banking/auditEvents";

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
  /** Secured central bank facilities repaid, senior to every other claim. */
  centralBankRepaid: number;
  /** Central bank claim the estate could not cover. The CB eats this. */
  centralBankWrittenOff: number;
  /** Recovered by interbank lenders, pro rata. */
  interbankRepaid: number;
  /** Interbank claim the estate could not cover. The lenders eat this. */
  interbankWrittenOff: number;
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
  centralBankRepaid: 0,
  centralBankWrittenOff: 0,
  interbankRepaid: 0,
  interbankWrittenOff: 0,
};

function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function floorCents(value: number): number {
  return Math.floor(value * 100 + 1e-9) / 100;
}

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

  // (1) Secured central bank facilities, senior to everything else.
  const windowOwed =
    Math.max(0, charter.discountWindowDebt ?? 0) + Math.max(0, charter.discountWindowArrears ?? 0);
  const marginOwed =
    Math.max(0, charter.cbMarginDebt ?? 0) + Math.max(0, charter.cbMarginArrears ?? 0);
  const centralBankOwed = windowOwed + marginOwed;
  // The two facilities are one tier, not two. Both are claims of the same
  // central bank, both were minted on the draw, and both are extinguished
  // together on resolution, so splitting the payment between them would change
  // no balance anywhere and only add a rank nobody can observe.
  const centralBankPaid = Math.min(cash, centralBankOwed);
  const cashAfterCentralBank = Math.max(0, cash - centralBankPaid);

  // (2) Household depositors, from whatever the senior claims left.
  const fromBankCash = Math.min(cashAfterCentralBank, npc);
  const shortfall = Math.max(0, npc - fromBankCash);

  // The fund pays what it has; the treasury covers the rest by deficit, which
  // is money entering the world and is booked as such.
  const fund = await db
    .collection<DepositInsuranceFund>("depositInsuranceFunds")
    .findOne({ _id: currency });
  const fundBalance = Math.max(0, fund?.balance ?? 0);
  const fromInsuranceFund = Math.min(fundBalance, shortfall);
  const fromTreasury = Math.max(0, shortfall - fromInsuranceFund);

  // (3) Interbank lenders, pro rata on outstanding principal. Unlike the two
  // central bank facilities, this money was never minted: it came out of
  // another bank's vault, so recovering it is a transfer rather than a burn.
  const cashAfterDeposits = Math.max(0, cashAfterCentralBank - fromBankCash);
  const interbankLoans = await db
    .collection<InterbankLoan>("interbankLoans")
    .find({ borrowerCorporationId: corporationId, status: "current" })
    .toArray();
  const interbankOwed = interbankLoans.reduce(
    (sum, loan) => sum + Math.max(0, loan.outstanding ?? 0),
    0
  );
  // Paid to the cent, and split to the cent: a pro-rata share left as a raw
  // fraction can sum to a hair more than the cash, and the last guarded debit
  // then fails against a vault that is short by a rounding error.
  const interbankPaid = toCents(Math.min(cashAfterDeposits, interbankOwed));
  const interbankShare = interbankOwed > 0 ? interbankPaid / interbankOwed : 0;
  // Where each lender's recovery lands. A live lender takes it into its vault.
  // A lender that has itself failed and not yet been resolved takes it into
  // its estate, where its own waterfall will distribute it. A lender whose
  // estate is already closed (revoked, or failed and resolved) may NOT be
  // credited: its owner has already been paid out and its depositors made
  // whole by the insurer, so the recovery belongs to the insurer. Crediting a
  // dead charter's vault would strand the cash or hand a windfall to a
  // shareholder who has already collected.
  const lenderIds = [...new Set(interbankLoans.map((loan) => loan.lenderCorporationId.toString()))];
  const lenders = lenderIds.length
    ? await db
        .collection<Corporation>("corporations")
        .find({ _id: { $in: lenderIds.map((id) => new ObjectId(id)) } })
        .project<Pick<Corporation, "_id" | "name" | "bankCharter">>({ name: 1, bankCharter: 1 })
        .toArray()
    : [];
  const lenderById = new Map(lenders.map((row) => [row._id.toString(), row]));
  const interbankPayouts = interbankLoans
    .map((loan) => ({
      loan,
      outstanding: Math.max(0, loan.outstanding ?? 0),
      paid: floorCents(Math.max(0, loan.outstanding ?? 0) * interbankShare),
      target: interbankRecoveryTarget(
        lenderById.get(loan.lenderCorporationId.toString()),
        currency
      ),
    }))
    .filter((row) => row.outstanding > 0);
  // Whatever the floors left over goes to the largest claim, so the shares
  // add up to exactly what was paid and no cent is stranded on the estate.
  const floorsTotal = interbankPayouts.reduce((sum, row) => sum + row.paid, 0);
  const remainder = toCents(interbankPaid - floorsTotal);
  if (remainder > 0 && interbankPayouts.length > 0) {
    const largest = interbankPayouts.reduce((best, row) =>
      row.outstanding > best.outstanding ? row : best
    );
    largest.paid = toCents(largest.paid + remainder);
  }

  // (4) Cash left after every creditor belongs to the owner, but only as far as
  // book equity: anything above that is still owed to somebody, and paying it
  // out is the "distribution funded by borrowing" hole the upstream guard
  // already refuses to open.
  const surplus = Math.max(0, cashAfterDeposits - interbankPaid);
  const ownerResidual = options.releaseResidualToOwner ? Math.max(0, Math.min(surplus, equity)) : 0;

  const cbDocId = getBankId(getCountryIdForCurrency(currency));
  const legs: TransitionLeg[] = [];

  if (centralBankPaid > 0) {
    legs.push({
      kind: "debit",
      amount: centralBankPaid,
      collection: "corporations",
      filter: { _id: oid(bankIdHex) },
      path: "bankCharter.cashReserves",
      note: "secured central bank facilities repaid first",
    });
    // The draw created this money (`discountWindowCommands` and the margin line
    // both mint on draw), so repayment destroys it rather than landing in a
    // balance. Booking it as anything else would double the money supply.
    legs.push({
      kind: "burn",
      amount: centralBankPaid,
      note: "central bank liquidity retired on resolution",
    });
  }

  if (npc > 0) {
    if (fromBankCash > 0) {
      legs.push({
        kind: "debit",
        amount: fromBankCash,
        collection: "corporations",
        filter: { _id: oid(bankIdHex) },
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
      filter: { _id: oid(bankIdHex) },
      path: "bankCharter.cashReserves",
      note: "residual bank equity released to the parent",
    });
    legs.push({
      kind: "credit",
      amount: ownerResidual,
      collection: "corporations",
      filter: { _id: oid(bankIdHex) },
      path: "liquidCapital",
      note: "residual bank equity received by the parent",
    });
  }

  for (const row of interbankPayouts) {
    if (!(row.paid > 0)) continue;
    legs.push({
      kind: "debit",
      amount: row.paid,
      collection: "corporations",
      filter: { _id: oid(bankIdHex) },
      path: "bankCharter.cashReserves",
      note: "interbank creditor paid pro rata",
    });
    legs.push({
      kind: "credit",
      amount: row.paid,
      collection: row.target.collection,
      filter: row.target.filter,
      path: row.target.path,
      note: row.target.note,
    });
  }

  // Everything that used to be written by hand after the money moved, as
  // journaled projections: the fiscal record of the backstop, the fund's
  // lifetime counters, the settlement of every creditor claim, and the
  // clearing of the deposit aggregates. Each is stamped, so a retry after the
  // money landed can neither omit one nor apply it twice. A bank that fails
  // holding no cash pays nobody, and "pays nobody" is still a resolution: the
  // claims are settled and the book cleared through the same projections.
  const projections: TransitionProjection[] = [];
  if (fromTreasury > 0) {
    projections.push({
      collection: "federalBudget",
      filter: { _id: getNationalBudgetId(getCountryIdForCurrency(currency)) },
      update: {
        $inc: {
          treasuryBalance: -fromTreasury,
          [`spending.byCategory.${DEPOSIT_INSURANCE_SPENDING_KEY}`]: fromTreasury,
          "spending.total": fromTreasury,
          surplus: -fromTreasury,
        },
        $set: { updatedAt: now },
      },
      note: "treasury books the deposit insurance backstop",
    });
  }
  if (fromInsuranceFund > 0 || fromTreasury > 0) {
    projections.push({
      collection: "depositInsuranceFunds",
      filter: { _id: currency },
      update: {
        $inc: {
          payoutsLifetime: fromInsuranceFund + fromTreasury,
          treasuryBackstopLifetime: fromTreasury,
        },
      },
      note: "fund lifetime payout counters",
    });
  }
  projections.push(
    ...creditorClaimProjections(bankIdHex, cbDocId, options.turn, {
      centralBankOwed,
      centralBankPaid,
      interbankPayouts,
      interbankOwed,
    }),
    depositAggregateClearProjection(bankIdHex, options.turn, options.cause, now)
  );

  const key = depositBookReturnKey(corporationId, options.cause, options.turn);
  const settled = await settleTransition(db, {
    key,
    kind: "deposit_book_return",
    turn: options.turn,
    currency,
    legs,
    projections,
    event: {
      kind: "bank.resolved",
      command: `bank.resolve.${options.cause}`,
      statusBefore: charter.status,
      statusAfter: "resolved",
      amount: npc,
    },
  });

  if (settled.status === "rejected" || settled.status === "partial") {
    return { ...EMPTY, depositorsFlipped, error: settled.error };
  }
  if (settled.status === "replayed") {
    // The cash moved on an earlier attempt and any projections that attempt
    // did not reach have just been finished. Nothing more to report: the
    // amounts belong to the attempt that moved them.
    return { ...EMPTY, depositorsFlipped };
  }

  const result: DepositBookReturnResult = {
    returned: true,
    depositorsFlipped,
    npcReturned: npc,
    fromBankCash,
    fromInsuranceFund,
    fromTreasury,
    ownerResidual,
    centralBankRepaid: centralBankPaid,
    centralBankWrittenOff: Math.max(0, centralBankOwed - centralBankPaid),
    interbankRepaid: interbankPaid,
    interbankWrittenOff: Math.max(0, interbankOwed - interbankPaid),
  };
  emitBankingAuditEvent(
    {
      kind: "bank.resolved",
      command: `bank.resolve.${options.cause}`,
      turn: options.turn,
      outcome: "ok",
      currency,
      bankId: bankIdHex,
      statusBefore: charter.status,
      statusAfter: "resolved",
      settlementId: key,
      amount: npc,
      meta: {
        cause: options.cause,
        depositorsFlipped,
        fromBankCash,
        fromInsuranceFund,
        fromTreasury,
        ownerResidual,
        centralBankRepaid: centralBankPaid,
        centralBankWrittenOff: result.centralBankWrittenOff,
        interbankRepaid: interbankPaid,
        interbankWrittenOff: result.interbankWrittenOff,
      },
    },
    db
  );
  return result;
}

/**
 * Where an interbank recovery lands for one lender. See the note at the call
 * site: a live or unresolved lender is credited; a closed estate is not, and
 * the insurer that stood behind it takes the recovery instead.
 */
export function interbankRecoveryTarget(
  lender: Pick<Corporation, "_id" | "name" | "bankCharter"> | undefined,
  currency: CurrencyCode
): { collection: string; filter: Record<string, unknown>; path: string; note: string } {
  const charter = lender?.bankCharter;
  const eligible =
    charter !== undefined &&
    (charter.status === "active" ||
      (charter.status === "failed" && typeof charter.depositorsResolvedTurn !== "number"));
  if (lender && eligible) {
    return {
      collection: "corporations",
      filter: { _id: oid(lender._id.toString()) },
      path: "bankCharter.cashReserves",
      note:
        charter.status === "active"
          ? "lending bank recovers part of its interbank claim"
          : `recovery into ${lender.name}'s estate, before it is distributed`,
    };
  }
  return {
    collection: "depositInsuranceFunds",
    filter: { _id: currency },
    path: "balance",
    note: "recovery to the insurer that stood behind a resolved lender",
  };
}

/**
 * Extinguish what the estate owed, once it has paid what it could, as
 * projections of the resolution transition.
 *
 * Runs even when nothing was paid. A claim that outlives the bank it was
 * against is a number nobody can collect and nobody can clear, which is how a
 * failed charter used to sit forever carrying debts to counterparties who had
 * already written them off.
 */
function creditorClaimProjections(
  bankIdHex: string,
  cbDocId: string,
  turn: number,
  claims: {
    centralBankOwed: number;
    centralBankPaid: number;
    interbankPayouts: { loan: InterbankLoan; outstanding: number; paid: number }[];
    interbankOwed: number;
  }
): TransitionProjection[] {
  const out: TransitionProjection[] = [];
  if (claims.centralBankOwed > 0) {
    out.push({
      collection: "corporations",
      filter: { _id: oid(bankIdHex) },
      update: {
        $set: {
          "bankCharter.discountWindowDebt": 0,
          "bankCharter.discountWindowArrears": 0,
          "bankCharter.cbMarginDebt": 0,
          "bankCharter.cbMarginArrears": 0,
        },
      },
      note: "central bank claims extinguished",
    });
    // What was repaid is money retired; what was not is money the central bank
    // created and will not get back, which is what being the lender of last
    // resort costs. Only the repaid part comes off the creation counter.
    if (claims.centralBankPaid > 0) {
      out.push({
        collection: "centralBanks",
        filter: { _id: cbDocId },
        update: { $inc: { netMoneyCreatedLifetime: -claims.centralBankPaid } },
        note: "repaid central bank liquidity comes off the creation counter",
      });
    }
  }
  for (const row of claims.interbankPayouts) {
    const unrecovered = Math.max(0, row.outstanding - row.paid);
    out.push({
      collection: "interbankLoans",
      filter: { _id: oid(row.loan._id.toString()) },
      update: {
        $set: {
          outstanding: unrecovered,
          status: unrecovered > 0 ? "defaulted" : "repaid",
          lastProcessedTurn: turn,
        },
      },
      note: "interbank claim settled against the estate",
    });
  }
  if (claims.interbankOwed > 0) {
    out.push({
      collection: "corporations",
      filter: { _id: oid(bankIdHex) },
      update: { $set: { "bankCharter.interbankDebt": 0 } },
      note: "interbank debt extinguished",
    });
  }
  return out;
}

/**
 * Zero the deposit aggregates AFTER the cash has moved, never before.
 *
 * Order matters and used to be the other way round: `adminUnwind` cleared the
 * aggregates so that `revokeCharter` would see an empty book and refund the
 * owner, which is how a shareholder ended up with the depositors' cash. As
 * the last projection of the transition, it cannot run before the legs.
 */
function depositAggregateClearProjection(
  bankIdHex: string,
  turn: number,
  cause: DepositBookReturnCause,
  now: Date
): TransitionProjection {
  return {
    collection: "corporations",
    filter: { _id: oid(bankIdHex) },
    update: {
      $set: {
        "bankCharter.npcDeposits": 0,
        "bankCharter.totalDeposits": 0,
        // The floor follows the deposits out, otherwise the corp stays locked
        // out of its own cash until the next banking turn recomputes it.
        "bankCharter.reserveFloor": 0,
        ...(cause === "failure" ? { "bankCharter.depositorsResolvedTurn": turn } : {}),
        updatedAt: now,
      },
    },
    note: "deposit aggregates cleared after the cash moved",
  };
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
