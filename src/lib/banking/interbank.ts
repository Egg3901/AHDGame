import { ObjectId, type Db } from "mongodb";
import type { BankCharter, InterbankLoan } from "@/lib/db/types/bank";
import type { Corporation } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getCashReserves } from "@/lib/banking/bankCash";
import { getCurrentTurn } from "@/lib/currentTurn";
import { emitTx } from "@/lib/financialTxLog/emit";
import { isBankPropTradingEnabled, isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import { getLendableHeadroom, getReserveRequirement } from "@/lib/banking/reserves";
import { computePropEquityBase } from "@/lib/banking/propTrading";
import { charterMay } from "@/lib/banking/rules/capabilities";
import { loadBankingSnapshot } from "@/lib/banking/snapshot";
import { cbMarginRatePercent, decideBankCommand } from "@/lib/banking/rules/decide";
import { settleTransition } from "@/lib/banking/settlementJournal";
import { emitBankingAuditEvent } from "@/lib/banking/auditEvents";

export { INTERBANK_MAX_SHARE_OF_LENDABLE } from "@/lib/banking/rules/decide";
import { INTERBANK_MAX_SHARE_OF_LENDABLE } from "@/lib/banking/rules/decide";

export { CB_MARGIN_SPREAD_PP, CB_MARGIN_COLLATERAL_FRACTION } from "@/lib/banking/rules/decide";

export type LendInterbankResult = { ok: true; loan: InterbankLoan } | { ok: false; error: string };

export type RepayInterbankResult =
  { ok: true; repaid: number; outstanding: number } | { ok: false; error: string };

export type CbMarginResult =
  | { ok: true; amount: number; cbMarginDebt: number; cashReserves: number }
  | { ok: false; error: string };

function isPropBorrowerCharter(charter: BankCharter | undefined): charter is BankCharter {
  return charterMay(charter, "interbankBorrowing");
}

function isInterbankLenderCharter(charter: BankCharter | undefined): charter is BankCharter {
  return charterMay(charter, "interbankLending");
}

async function sumLenderInterbankOutstanding(
  db: Db,
  lenderCorporationId: ObjectId
): Promise<number> {
  const rows = await db
    .collection<InterbankLoan>("interbankLoans")
    .aggregate<{ total: number }>([
      {
        $match: {
          lenderCorporationId,
          status: { $in: ["current"] },
        },
      },
      { $group: { _id: null, total: { $sum: "$outstanding" } } },
    ])
    .toArray();
  const total = rows[0]?.total ?? 0;
  return typeof total === "number" && Number.isFinite(total) ? total : 0;
}

/**
 * Retail/universal bank lends cash to an investment/universal bank.
 * Cash moves lender → borrower bank reserves. Interbank loans are NOT part of
 * retail totalLoans; debt is tracked on InterbankLoan docs + borrower.interbankDebt.
 */
export async function lendInterbank(
  db: Db,
  lenderCorpId: ObjectId,
  borrowerCorpId: ObjectId,
  amount: number,
  ratePercent: number
): Promise<LendInterbankResult> {
  if (!(await isPrivateBankingEnabled()) || !(await isBankPropTradingEnabled())) {
    return { ok: false, error: "Interbank lending is not enabled" };
  }
  if (!Number.isFinite(amount) || !(amount > 0)) {
    return { ok: false, error: "Amount must be a positive number" };
  }
  if (!Number.isFinite(ratePercent) || ratePercent < 0) {
    return { ok: false, error: "Rate must be a non-negative number" };
  }
  if (lenderCorpId.equals(borrowerCorpId)) {
    return { ok: false, error: "A bank cannot lend to itself on the interbank market" };
  }

  const [lender, borrower] = await Promise.all([
    db.collection<Corporation>("corporations").findOne({ _id: lenderCorpId }),
    db.collection<Corporation>("corporations").findOne({ _id: borrowerCorpId }),
  ]);
  if (!lender) return { ok: false, error: "Lender corporation not found" };
  if (!borrower) return { ok: false, error: "Borrower corporation not found" };

  const lenderCharter = lender.bankCharter;
  if (!isInterbankLenderCharter(lenderCharter)) {
    return {
      ok: false,
      error: "Only active retail or universal charters may lend on the interbank market",
    };
  }
  const borrowerCharter = borrower.bankCharter;
  if (!isPropBorrowerCharter(borrowerCharter)) {
    return {
      ok: false,
      error: "Borrower must have an active investment or universal charter",
    };
  }
  if (lenderCharter.currency !== borrowerCharter.currency) {
    return { ok: false, error: "Lender and borrower charter currencies must match" };
  }

  const currency = lenderCharter.currency as CurrencyCode;
  const reserveRatio = await getReserveRequirement(db, currency);
  const headroom = getLendableHeadroom(lenderCharter, reserveRatio);
  const maxByShare = INTERBANK_MAX_SHARE_OF_LENDABLE * headroom;
  const alreadyOut = await sumLenderInterbankOutstanding(db, lenderCorpId);
  if (amount > maxByShare + 1e-9 || alreadyOut + amount > maxByShare + 1e-9) {
    return { ok: false, error: "Amount exceeds interbank share of lendable headroom" };
  }

  const lenderLiquid = getCashReserves(lender.bankCharter);
  if (amount > lenderLiquid + 1e-9) {
    return { ok: false, error: "Lender has insufficient liquid capital" };
  }

  const loanId = new ObjectId();
  const originatedTurn = await getCurrentTurn(db);
  const loan: InterbankLoan = {
    _id: loanId,
    lenderCorporationId: lenderCorpId,
    borrowerCorporationId: borrowerCorpId,
    currency,
    principal: amount,
    outstanding: amount,
    ratePercent,
    originatedTurn,
    status: "current",
  };

  try {
    await db.collection<InterbankLoan>("interbankLoans").insertOne(loan);
  } catch {
    return { ok: false, error: "Failed to write interbank loan document" };
  }

  const lenderDebit = await db.collection<Corporation>("corporations").updateOne(
    {
      _id: lenderCorpId,
      "bankCharter.status": "active",
      "bankCharter.cashReserves": { $gte: amount },
    },
    {
      $inc: { "bankCharter.cashReserves": -amount },
      $set: { updatedAt: new Date() },
    }
  );
  if (lenderDebit.matchedCount !== 1) {
    await db.collection<InterbankLoan>("interbankLoans").deleteOne({ _id: loanId });
    return { ok: false, error: "Failed to debit lender liquid capital" };
  }

  const borrowerCredit = await db.collection<Corporation>("corporations").updateOne(
    {
      _id: borrowerCorpId,
      "bankCharter.status": "active",
    },
    {
      $inc: {
        "bankCharter.cashReserves": amount,
        "bankCharter.interbankDebt": amount,
      },
      $set: { updatedAt: new Date() },
    }
  );
  if (borrowerCredit.matchedCount !== 1) {
    await db
      .collection<Corporation>("corporations")
      .updateOne(
        { _id: lenderCorpId },
        { $inc: { "bankCharter.cashReserves": amount }, $set: { updatedAt: new Date() } }
      );
    await db.collection<InterbankLoan>("interbankLoans").deleteOne({ _id: loanId });
    return { ok: false, error: "Failed to credit borrower" };
  }

  await emitTx(db, {
    type: "bank_interbank_lend",
    turn: originatedTurn,
    createdAt: new Date(),
    subjectType: "corporation",
    subjectId: borrowerCorpId,
    subjectName: borrower.name,
    amount,
    currencyCode: currency,
    counterpartyType: "corporation",
    counterpartyId: lenderCorpId,
    counterpartyName: lender.name,
    meta: { kind: "interbank_lend", loanId: loanId.toString(), ratePercent },
  });

  return { ok: true, loan };
}

/**
 * Borrower (or lender-triggered repay path) returns principal: cash borrower → lender,
 * reduces charter.interbankDebt and loan.outstanding.
 */
export async function repayInterbank(
  db: Db,
  loanId: ObjectId,
  amount: number
): Promise<RepayInterbankResult> {
  if (!(await isPrivateBankingEnabled()) || !(await isBankPropTradingEnabled())) {
    return { ok: false, error: "Interbank lending is not enabled" };
  }
  if (!Number.isFinite(amount) || !(amount > 0)) {
    return { ok: false, error: "Amount must be a positive number" };
  }

  const loan = await db.collection<InterbankLoan>("interbankLoans").findOne({ _id: loanId });
  if (!loan || loan.status !== "current") {
    return { ok: false, error: "Interbank loan not found or not current" };
  }

  const outstanding = Math.max(0, loan.outstanding);
  const repay = Math.min(amount, outstanding);
  if (!(repay > 0)) {
    return { ok: false, error: "Nothing to repay" };
  }

  const borrowerDebit = await db.collection<Corporation>("corporations").updateOne(
    {
      _id: loan.borrowerCorporationId,
      "bankCharter.cashReserves": { $gte: repay },
    },
    {
      $inc: {
        "bankCharter.cashReserves": -repay,
        "bankCharter.interbankDebt": -repay,
      },
      $set: { updatedAt: new Date() },
    }
  );
  if (borrowerDebit.matchedCount !== 1) {
    return { ok: false, error: "Borrower has insufficient liquid capital" };
  }

  const lenderCredit = await db.collection<Corporation>("corporations").updateOne(
    { _id: loan.lenderCorporationId },
    {
      $inc: { "bankCharter.cashReserves": repay },
      $set: { updatedAt: new Date() },
    }
  );
  if (lenderCredit.matchedCount !== 1) {
    // Compensate: put the debited cash back on the borrower rather than
    // destroying it (no transactions on standalone Mongo).
    await db.collection<Corporation>("corporations").updateOne(
      { _id: loan.borrowerCorporationId },
      {
        $inc: {
          "bankCharter.cashReserves": repay,
          "bankCharter.interbankDebt": repay,
        },
        $set: { updatedAt: new Date() },
      }
    );
    return { ok: false, error: "Failed to credit lender" };
  }

  const [borrowerCorp, lenderCorp, repayTurn] = await Promise.all([
    db
      .collection<Corporation>("corporations")
      .findOne({ _id: loan.borrowerCorporationId }, { projection: { name: 1 } }),
    db
      .collection<Corporation>("corporations")
      .findOne({ _id: loan.lenderCorporationId }, { projection: { name: 1 } }),
    getCurrentTurn(db),
  ]);
  await emitTx(db, {
    type: "bank_interbank_repay",
    turn: repayTurn,
    createdAt: new Date(),
    subjectType: "corporation",
    subjectId: loan.borrowerCorporationId,
    subjectName: borrowerCorp?.name ?? "Unknown corporation",
    amount: -repay,
    currencyCode: loan.currency,
    counterpartyType: "corporation",
    counterpartyId: loan.lenderCorporationId,
    counterpartyName: lenderCorp?.name ?? "Unknown corporation",
    meta: { kind: "interbank_repay", loanId: loanId.toString() },
  });

  const nextOutstanding = Math.max(0, outstanding - repay);
  await db.collection<InterbankLoan>("interbankLoans").updateOne(
    { _id: loanId },
    {
      $set: {
        outstanding: nextOutstanding,
        status: nextOutstanding <= 0 ? "repaid" : "current",
        arrearsTurns: 0,
      },
    }
  );

  return { ok: true, repaid: repay, outstanding: nextOutstanding };
}

export { cbMarginRatePercent };

async function runMarginCommand(
  db: Db,
  corpId: ObjectId,
  command: { type: "draw_cb_margin" | "repay_cb_margin"; amount: number }
): Promise<CbMarginResult> {
  const loaded = await loadBankingSnapshot(db, corpId);
  if (!loaded) return { ok: false, error: "Corporation not found" };
  const { snapshot, corporation } = loaded;
  const commandName =
    command.type === "draw_cb_margin" ? "bank.cbMargin.draw" : "bank.cbMargin.repay";

  const decision = decideBankCommand(snapshot, command, {
    commandId: new ObjectId().toHexString(),
  });
  if (!decision.allowed) {
    emitBankingAuditEvent(
      {
        kind: "charter.issued",
        command: commandName,
        turn: snapshot.turn,
        outcome: "rejected",
        reason: decision.message,
        currency: snapshot.currency,
        bankId: corpId.toString(),
        meta: { amount: command.amount },
      },
      db
    );
    // The margin line used to answer the "no charter" case with its own
    // wording; keep those sentences for the console.
    const message =
      decision.refusal.code === "capability" && decision.refusal.denial === "charter_type"
        ? command.type === "draw_cb_margin"
          ? "Only active investment or universal charters may draw CB margin"
          : "No active prop-trading charter"
        : decision.refusal.code === "capability" &&
            decision.refusal.denial === "prop_trading_disabled"
          ? "CB margin line is not enabled"
          : decision.refusal.code === "capability" && decision.refusal.denial === "banking_disabled"
            ? "CB margin line is not enabled"
            : decision.message;
    return { ok: false, error: message };
  }

  const settled = await settleTransition(db, decision.transition);
  if (settled.status === "rejected" || settled.status === "partial" || settled.error) {
    emitBankingAuditEvent(
      {
        ...decision.transition.event,
        turn: snapshot.turn,
        outcome: "rejected",
        reason: settled.error ?? "settlement did not complete",
        currency: snapshot.currency,
        bankId: corpId.toString(),
        settlementId: decision.transition.key,
      },
      db
    );
    return {
      ok: false,
      error:
        command.type === "draw_cb_margin"
          ? "Failed to draw CB margin"
          : "Failed to repay CB margin",
    };
  }

  const moved =
    decision.transition.legs.find((l) => l.kind === "credit" || l.kind === "debit")?.amount ?? 0;
  const currency = snapshot.currency as CurrencyCode;
  await emitTx(db, {
    type: command.type === "draw_cb_margin" ? "bank_cb_margin_draw" : "bank_cb_margin_repay",
    turn: snapshot.turn,
    createdAt: new Date(),
    subjectType: "corporation",
    subjectId: corpId,
    subjectName: corporation.name,
    amount: command.type === "draw_cb_margin" ? moved : -moved,
    currencyCode: currency,
    counterpartyType: "government",
    counterpartyName: `${getCountryIdForCurrency(currency)} central bank`,
    meta: { kind: command.type === "draw_cb_margin" ? "cb_margin_draw" : "cb_margin_repay" },
  });
  emitBankingAuditEvent(
    {
      ...decision.transition.event,
      turn: snapshot.turn,
      outcome: "ok",
      currency,
      bankId: corpId.toString(),
      settlementId: decision.transition.key,
    },
    db
  );

  const debtBefore = Math.max(0, snapshot.charter?.cbMarginDebt ?? 0);
  const cashBefore = getCashReserves(snapshot.charter ?? undefined);
  return {
    ok: true,
    amount: moved,
    cbMarginDebt:
      command.type === "draw_cb_margin" ? debtBefore + moved : Math.max(0, debtBefore - moved),
    cashReserves:
      command.type === "draw_cb_margin" ? cashBefore + moved : Math.max(0, cashBefore - moved),
  };
}

/**
 * Draw on the CB margin line against prop-book collateral.
 * Cash is CREATED into the bank's reserves (LOC-style: originating a CB loan does
 * not debit a CB pool; principal repayment later destroys cash symmetrically).
 */
export async function drawCbMargin(
  db: Db,
  corpId: ObjectId,
  amount: number
): Promise<CbMarginResult> {
  if (!Number.isFinite(amount) || !(amount > 0)) {
    return { ok: false, error: "Amount must be a positive number" };
  }
  return runMarginCommand(db, corpId, { type: "draw_cb_margin", amount });
}

/**
 * Repay CB margin principal: cash DESTROYED from bank reserves (mirror of creation
 * on draw; same symmetry as LOC principal repayment).
 */
export async function repayCbMargin(
  db: Db,
  corpId: ObjectId,
  amount: number
): Promise<CbMarginResult> {
  if (!Number.isFinite(amount) || !(amount > 0)) {
    return { ok: false, error: "Amount must be a positive number" };
  }
  return runMarginCommand(db, corpId, { type: "repay_cb_margin", amount });
}

/** Exposed for tests / solvency equity checks. */
export { computePropEquityBase };
