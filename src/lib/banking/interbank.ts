import { ObjectId, type Db } from "mongodb";
import type { InterbankLoan } from "@/lib/db/types/bank";
import type { Corporation } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getCashReserves } from "@/lib/banking/bankCash";
import { emitTx } from "@/lib/financialTxLog/emit";
import { computePropEquityBase } from "@/lib/banking/propTrading";
import { charterSnapshotFrom, loadBankingSnapshot } from "@/lib/banking/snapshot";
import { cbMarginRatePercent, decideBankCommand } from "@/lib/banking/rules/decide";
import { reviveObjectIds, settleTransition } from "@/lib/banking/settlementJournal";
import { emitBankingAuditEvent } from "@/lib/banking/auditEvents";

export { INTERBANK_MAX_SHARE_OF_LENDABLE } from "@/lib/banking/rules/decide";

export { CB_MARGIN_SPREAD_PP, CB_MARGIN_COLLATERAL_FRACTION } from "@/lib/banking/rules/decide";

export type LendInterbankResult = { ok: true; loan: InterbankLoan } | { ok: false; error: string };

export type RepayInterbankResult =
  { ok: true; repaid: number; outstanding: number } | { ok: false; error: string };

export type CbMarginResult =
  | { ok: true; amount: number; cbMarginDebt: number; cashReserves: number }
  | { ok: false; error: string };

async function sumLenderInterbankOutstanding(
  db: Db,
  lenderCorporationId: ObjectId
): Promise<number> {
  // A find rather than an aggregation so the same code runs on the in-memory
  // store the simulation host uses; a lender holds a handful of loans.
  const rows = await db
    .collection<InterbankLoan>("interbankLoans")
    .find({ lenderCorporationId, status: "current" })
    .project<Pick<InterbankLoan, "outstanding">>({ outstanding: 1 })
    .toArray();
  return rows.reduce(
    (sum, row) =>
      sum +
      (typeof row.outstanding === "number" && Number.isFinite(row.outstanding)
        ? Math.max(0, row.outstanding)
        : 0),
    0
  );
}

/**
 * Retail/universal bank lends cash to an investment/universal bank.
 *
 * The rules boundary decides (capabilities on both sides, currency match,
 * the interbank share of lendable headroom, the lender's cash) and returns
 * one transition: lender vault debit, borrower vault credit, the loan record
 * and the borrower's interbank debt. The journal lands it once. Interbank
 * loans are NOT part of retail totalLoans; debt is tracked on the loan doc and
 * on borrower.interbankDebt.
 */
export async function lendInterbank(
  db: Db,
  lenderCorpId: ObjectId,
  borrowerCorpId: ObjectId,
  amount: number,
  ratePercent: number
): Promise<LendInterbankResult> {
  const loaded = await loadBankingSnapshot(db, lenderCorpId);
  if (!loaded) return { ok: false, error: "Lender corporation not found" };
  const { snapshot, corporation: lender } = loaded;
  if (!snapshot.policy.privateBanking || !snapshot.policy.propTrading) {
    return { ok: false, error: "Interbank lending is not enabled" };
  }
  const borrower = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: borrowerCorpId });
  if (!borrower) return { ok: false, error: "Borrower corporation not found" };

  const loanId = new ObjectId();
  const decision = decideBankCommand(
    snapshot,
    {
      type: "lend_interbank",
      loanId: loanId.toHexString(),
      borrowerBankId: borrowerCorpId.toString(),
      borrowerCharter: charterSnapshotFrom(borrower.bankCharter),
      amount,
      ratePercent,
      lenderOutstanding: await sumLenderInterbankOutstanding(db, lenderCorpId),
    },
    { commandId: loanId.toHexString() }
  );
  if (!decision.allowed) {
    emitBankingAuditEvent(
      {
        kind: "loan.originated",
        command: "bank.interbank.lend",
        turn: snapshot.turn,
        outcome: "rejected",
        reason: decision.message,
        currency: snapshot.currency,
        bankId: lenderCorpId.toString(),
        amount,
      },
      db
    );
    const message =
      decision.refusal.code === "capability" && decision.refusal.capability === "interbankLending"
        ? decision.refusal.denial === "charter_type" ||
          decision.refusal.denial === "charter_inactive"
          ? "Only active retail or universal charters may lend on the interbank market"
          : "Interbank lending is not enabled"
        : decision.message;
    return { ok: false, error: message };
  }

  const settled = await settleTransition(db, decision.transition);
  if (settled.status === "rejected" || settled.status === "partial" || settled.error) {
    return {
      ok: false,
      error:
        settled.appliedLegs.length === 0
          ? "Failed to debit lender liquid capital"
          : "Failed to credit borrower",
    };
  }

  const loan = reviveObjectIds(
    decision.transition.projections[0].insert
  ) as unknown as InterbankLoan;
  await emitTx(db, {
    type: "bank_interbank_lend",
    turn: snapshot.turn,
    createdAt: new Date(),
    subjectType: "corporation",
    subjectId: borrowerCorpId,
    subjectName: borrower.name,
    amount,
    currencyCode: snapshot.currency as CurrencyCode,
    counterpartyType: "corporation",
    counterpartyId: lenderCorpId,
    counterpartyName: lender.name,
    meta: {
      kind: "interbank_lend",
      loanId: loanId.toString(),
      ratePercent,
      settlementId: decision.transition.key,
    },
  });
  emitBankingAuditEvent(
    {
      ...decision.transition.event,
      turn: snapshot.turn,
      outcome: "ok",
      currency: snapshot.currency,
      bankId: lenderCorpId.toString(),
      settlementId: decision.transition.key,
    },
    db
  );
  return { ok: true, loan };
}

/**
 * Borrower returns principal: cash borrower -> lender, reduces
 * charter.interbankDebt and loan.outstanding. One transition, no
 * compensating write.
 */
export async function repayInterbank(
  db: Db,
  loanId: ObjectId,
  amount: number,
  commandId: string = new ObjectId().toHexString()
): Promise<RepayInterbankResult> {
  const loan = await db.collection<InterbankLoan>("interbankLoans").findOne({ _id: loanId });
  if (!loan || loan.status !== "current") {
    return { ok: false, error: "Interbank loan not found or not current" };
  }
  const loaded = await loadBankingSnapshot(db, loan.borrowerCorporationId);
  if (!loaded) return { ok: false, error: "Borrower corporation not found" };
  const { snapshot, corporation: borrowerCorp } = loaded;
  if (!snapshot.policy.privateBanking || !snapshot.policy.propTrading) {
    return { ok: false, error: "Interbank lending is not enabled" };
  }

  const decision = decideBankCommand(
    snapshot,
    {
      type: "repay_interbank",
      loanId: loanId.toHexString(),
      lenderBankId: loan.lenderCorporationId.toString(),
      outstanding: Math.max(0, loan.outstanding),
      amount,
    },
    { commandId }
  );
  if (!decision.allowed) {
    const message =
      decision.refusal.code === "insufficient_funds"
        ? "Borrower has insufficient liquid capital"
        : decision.refusal.code === "capability"
          ? "Interbank lending is not enabled"
          : decision.message;
    return { ok: false, error: message };
  }
  const repay = decision.transition.legs[0]?.amount ?? 0;

  const settled = await settleTransition(db, decision.transition);
  if (settled.status === "rejected" || settled.status === "partial" || settled.error) {
    return {
      ok: false,
      error:
        settled.appliedLegs.length === 0
          ? "Borrower has insufficient liquid capital"
          : "Failed to credit lender",
    };
  }

  const lenderCorp = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: loan.lenderCorporationId }, { projection: { name: 1 } });
  await emitTx(db, {
    type: "bank_interbank_repay",
    turn: snapshot.turn,
    createdAt: new Date(),
    subjectType: "corporation",
    subjectId: loan.borrowerCorporationId,
    subjectName: borrowerCorp.name ?? "Unknown corporation",
    amount: -repay,
    currencyCode: loan.currency,
    counterpartyType: "corporation",
    counterpartyId: loan.lenderCorporationId,
    counterpartyName: lenderCorp?.name ?? "Unknown corporation",
    meta: {
      kind: "interbank_repay",
      loanId: loanId.toString(),
      settlementId: decision.transition.key,
    },
  });
  emitBankingAuditEvent(
    {
      ...decision.transition.event,
      turn: snapshot.turn,
      outcome: "ok",
      currency: snapshot.currency,
      bankId: loan.borrowerCorporationId.toString(),
      settlementId: decision.transition.key,
    },
    db
  );

  const nextOutstanding = Math.max(0, Math.max(0, loan.outstanding) - repay);
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
