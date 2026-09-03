/**
 * `decide`: the one function behind every bank command.
 *
 * Each branch below reads the snapshot, applies the capability table and the
 * balance-sheet rules, and either refuses with a reason or returns exactly
 * one balanced transition. The transitions reproduce what the hand-written
 * command modules used to write, leg for leg, so adopting the boundary is a
 * move rather than a retune. Where a hand-written path was known to be
 * wrong (an unfunded loan disbursement, a refund paid twice) the correct
 * shape is here and the commit that switches the shell over says so.
 */

import type { BankCharterType } from "@/lib/db/types/bank";
import {
  bankBalanceSheet,
  getCashReserves,
  requiredReserves,
} from "@/lib/banking/rules/balanceSheet";
import {
  capabilityMessage,
  charterCapabilities,
  type CapabilityKey,
} from "@/lib/banking/rules/capabilities";
import {
  canDraw,
  discountWindowRatePercent,
  quoteDiscountWindow,
} from "@/lib/banking/rules/discountWindow";
import { effectiveBankRatesFromPrime } from "@/lib/banking/rules/rates";
import {
  CHARACTER_LOAN_SPREAD_PP,
  bindingNamedLoanCap,
  maxPrincipalFromIncome,
  namedLoanPrincipalCap,
} from "@/lib/banking/rules/lendingMath";
import { namedLoanHeadroom } from "@/lib/banking/rules/loans";
import { lifecycleRefusal, type LifecycleAction } from "@/lib/banking/rules/lifecycle";
import type { BalanceSheetOptions } from "@/lib/banking/rules/balanceSheet";

/** The balance-sheet reading the snapshot's policy calls for. */
function sheetOptions(
  snapshot: Pick<BankingSnapshot, "playerDepositsAreLiabilities">
): BalanceSheetOptions {
  return { playerDepositsAreLiabilities: snapshot.playerDepositsAreLiabilities === true };
}
import { getLendableHeadroom } from "@/lib/banking/rules/reserves";
import {
  oid,
  type BankCharterSnapshot,
  type BankCommand,
  type BankingDecision,
  type BankingSnapshot,
  type BankingTransition,
  type TransitionLeg,
} from "@/lib/banking/rules/boundary";

/** Provisional - max share of lendable headroom a retail bank may place on interbank. */
export const INTERBANK_MAX_SHARE_OF_LENDABLE = 0.5;

/** Provisional - CB margin rate = prime + this spread (pp). */
export const CB_MARGIN_SPREAD_PP = 1.5;

/** Provisional - cbMarginDebt may not exceed this x propBookMarkValue. */
export const CB_MARGIN_COLLATERAL_FRACTION = 0.5;

/** Named loan term bounds, in turns. */
export const NAMED_LOAN_MIN_TERM_TURNS = 4;
export const NAMED_LOAN_MAX_TERM_TURNS = 120;

export function cbMarginRatePercent(primeRate: number): number {
  return Math.max(0, primeRate + CB_MARGIN_SPREAD_PP);
}

function refuse(
  refusal: Extract<BankingDecision, { allowed: false }>["refusal"],
  message: string
): BankingDecision {
  return { allowed: false, refusal, message };
}

function requireCapability(
  snapshot: BankingSnapshot,
  charter: BankCharterSnapshot | null,
  key: CapabilityKey
): BankingDecision | null {
  const caps = charterCapabilities(charter, snapshot.policy);
  const result = caps[key];
  if (result.allowed) return null;
  return refuse(
    { code: "capability", capability: key, denial: result.reason! },
    capabilityMessage(key, result.reason!, charter?.type as BankCharterType | undefined)
  );
}

/**
 * The lifecycle gate. Capability says what a charter of this type may do;
 * the stage says what this charter may do right now. Both refuse with a
 * message the player sees.
 */
function requireStage(
  charter: BankCharterSnapshot | null,
  action: LifecycleAction
): BankingDecision | null {
  const refused = lifecycleRefusal(charter, action);
  if (!refused) return null;
  if (refused.refusal.code === "no_charter") {
    return refuse({ code: "state", detail: "no_charter" }, refused.message);
  }
  return refuse(
    { code: "lifecycle", stage: refused.refusal.stage, action: refused.refusal.action },
    refused.message
  );
}

function positiveAmount(amount: number): number | null {
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

const INVALID_AMOUNT = "Amount must be a positive number.";

function corpFilter(bankId: string): Record<string, unknown> {
  return { _id: oid(bankId) };
}

function vaultLeg(
  snapshot: BankingSnapshot,
  kind: "debit" | "credit",
  amount: number,
  note: string
): TransitionLeg {
  return {
    kind,
    amount,
    collection: "corporations",
    filter: { ...corpFilter(snapshot.bankId), "bankCharter.status": "active" },
    path: "bankCharter.cashReserves",
    note,
  };
}

function treasuryLeg(
  snapshot: BankingSnapshot,
  kind: "debit" | "credit",
  amount: number,
  note: string
): TransitionLeg {
  return {
    kind,
    amount,
    collection: "corporations",
    filter: corpFilter(snapshot.bankId),
    path: "liquidCapital",
    note,
  };
}

function transition(
  snapshot: BankingSnapshot,
  kind: string,
  keySuffix: string,
  legs: TransitionLeg[],
  projections: BankingTransition["projections"],
  event: BankingTransition["event"]
): BankingTransition {
  return {
    key: `${kind}:${snapshot.bankId}:${keySuffix}`,
    kind,
    turn: snapshot.turn,
    currency: snapshot.currency,
    legs,
    projections,
    event,
  };
}

export interface DecideOptions {
  /**
   * Distinguishes two identical commands issued in the same turn. A route
   * passes its request id; the simulation passes a sequence number. Without
   * it, two injections of the same amount in one turn would share a key and
   * the second would replay as the first.
   */
  commandId: string;
}

export function decideBankCommand(
  snapshot: BankingSnapshot,
  command: BankCommand,
  options: DecideOptions
): BankingDecision {
  const charter = snapshot.charter;
  const active = charter && charter.status === "active" ? charter : null;
  const suffix = `${snapshot.turn}:${options.commandId}`;

  switch (command.type) {
    case "inject_capital": {
      const denied = requireCapability(snapshot, charter, "serviceLoanBook");
      if (denied) return denied;
      const amount = positiveAmount(command.amount);
      if (amount === null) return refuse({ code: "invalid_amount" }, INVALID_AMOUNT);
      const move = Math.round(amount);
      if (move > snapshot.corporationLiquidCapital) {
        return refuse(
          { code: "insufficient_funds", available: snapshot.corporationLiquidCapital },
          "The corporation does not hold that much cash."
        );
      }
      return {
        allowed: true,
        transition: transition(
          snapshot,
          "bank_capital_injection",
          suffix,
          [
            treasuryLeg(snapshot, "debit", move, "shareholder cash posted behind depositors"),
            vaultLeg(snapshot, "credit", move, "capital arrives in the vault"),
          ],
          [
            {
              collection: "corporations",
              filter: corpFilter(snapshot.bankId),
              update: { $inc: { "bankCharter.postedCapital": move } },
              note: "posted capital is the memo of where the cash came from",
            },
          ],
          {
            kind: "charter.issued",
            command: "bank.capital.inject",
            statusAfter: "active",
            amount: move,
            meta: { operation: "inject" },
          }
        ),
      };
    }

    case "upstream_cash": {
      const denied = requireCapability(snapshot, charter, "serviceLoanBook");
      if (denied) return denied;
      const amount = positiveAmount(command.amount);
      if (amount === null) return refuse({ code: "invalid_amount" }, INVALID_AMOUNT);
      const sheet = bankBalanceSheet({
        charter: active!,
        reserveRatio: snapshot.reserveRatio,
        capacityCeiling: snapshot.capacityCeiling,
        playerDepositsAreLiabilities: snapshot.playerDepositsAreLiabilities,
      });
      if (active!.capitalStanding === "undercapitalized") {
        return refuse(
          { code: "state", detail: "undercapitalized" },
          "The bank is undercapitalized. Post capital rather than taking it out."
        );
      }
      if (active!.capitalStanding === "stressed") {
        return refuse(
          { code: "state", detail: "stressed" },
          "The bank failed its stress test, so it may not pay out until it clears."
        );
      }
      const staged = requireStage(charter, "distribute");
      if (staged) return staged;
      // Floor, never round: distributable is bounded by the cash in the vault,
      // and rounding up past it by a few cents asks the guarded debit for more
      // than there is, which fails at the write instead of here.
      const move = Math.floor(Math.min(amount, sheet.distributable));
      if (move <= 0) {
        return refuse(
          { code: "cap", cap: "distributable", max: Math.max(0, sheet.distributable) },
          "The bank has no distributable capital. Its reserves are required against deposits, or it holds no equity above its deposit liabilities to pay out."
        );
      }
      const postedDown = Math.min(move, Math.max(0, active!.postedCapital ?? 0));
      const required = requiredReserves(active!, snapshot.reserveRatio, sheetOptions(snapshot));
      return {
        allowed: true,
        derived: { distributable: sheet.distributable, moved: move },
        transition: transition(
          snapshot,
          "bank_cash_upstream",
          suffix,
          [
            {
              ...vaultLeg(snapshot, "debit", move, "surplus reserves leave the vault"),
              // Re-gate the reserve floor inside the write: the snapshot can be
              // stale against a concurrent turn, and the one thing this must
              // never do is leave the bank short of required reserves.
              filter: {
                ...corpFilter(snapshot.bankId),
                "bankCharter.status": "active",
                "bankCharter.cashReserves": { $gte: required + move },
              },
            },
            treasuryLeg(snapshot, "credit", move, "distribution reaches the parent"),
          ],
          postedDown > 0
            ? [
                {
                  collection: "corporations",
                  filter: corpFilter(snapshot.bankId),
                  update: { $inc: { "bankCharter.postedCapital": -postedDown } },
                  note: "posted capital comes down with the cash, never below zero",
                },
              ]
            : [],
          {
            kind: "charter.issued",
            command: "bank.capital.upstream",
            statusAfter: "active",
            amount: -move,
            meta: { operation: "upstream", postedDown },
          }
        ),
      };
    }

    case "draw_discount_window": {
      const denied = requireCapability(snapshot, charter, "discountWindow");
      if (denied) return denied;
      const staged = requireStage(charter, "borrowFromCentralBank");
      if (staged) return staged;
      const amount = positiveAmount(command.amount);
      if (amount === null) return refuse({ code: "invalid_amount" }, INVALID_AMOUNT);
      const allowed = canDraw(active!, amount, snapshot.primeRate, sheetOptions(snapshot));
      if (!allowed.ok) {
        if (allowed.reason === "no_deposits") {
          return refuse(
            { code: "state", detail: "no_deposits" },
            "The window is sized against the deposit base, and this bank has none."
          );
        }
        const quote = quoteDiscountWindow(active!, snapshot.primeRate, sheetOptions(snapshot));
        return refuse(
          { code: "cap", cap: "discountWindow", max: quote.headroomAnchor },
          "This draw would take the bank past its window limit. A bank needing more than that is not illiquid, it is insolvent."
        );
      }
      const draw = Math.round(amount);
      const rate = discountWindowRatePercent(snapshot.primeRate);
      return {
        allowed: true,
        derived: { ratePercent: rate, capAnchor: allowed.quote.capAnchor },
        transition: transition(
          snapshot,
          "discount_window_draw",
          suffix,
          [
            { kind: "mint", amount: draw, note: "central bank creates the liquidity" },
            {
              ...vaultLeg(snapshot, "credit", draw, "window draw arrives in the vault"),
              filter: {
                ...corpFilter(snapshot.bankId),
                "bankCharter.status": "active",
                $expr: {
                  $lte: [
                    { $add: [{ $ifNull: ["$bankCharter.discountWindowDebt", 0] }, draw] },
                    allowed.quote.capAnchor,
                  ],
                },
              },
              set: {},
            },
          ],
          [
            {
              collection: "corporations",
              filter: corpFilter(snapshot.bankId),
              update: { $inc: { "bankCharter.discountWindowDebt": draw } },
              note: "the claim the central bank now holds",
            },
            {
              collection: "centralBanks",
              filter: { _id: snapshot.centralBankId },
              update: { $inc: { netMoneyCreatedLifetime: draw } },
              note: "money created at the central bank",
            },
          ],
          {
            kind: "charter.issued",
            command: "bank.discountWindow.draw",
            statusAfter: "active",
            amount: draw,
            meta: { operation: "discount_window_draw", ratePercent: rate },
          }
        ),
      };
    }

    case "repay_discount_window": {
      const denied = requireCapability(snapshot, charter, "serviceLoanBook");
      if (denied) return denied;
      const outstanding = Math.max(0, active!.discountWindowDebt ?? 0);
      if (outstanding <= 0) {
        return refuse(
          { code: "state", detail: "nothing_outstanding" },
          "Nothing is outstanding on the window."
        );
      }
      const amount = positiveAmount(command.amount);
      if (amount === null) return refuse({ code: "invalid_amount" }, "Repayment must be positive.");
      const repay = Math.min(Math.round(amount), outstanding);
      if (repay > getCashReserves(active!)) {
        return refuse(
          { code: "insufficient_funds", available: getCashReserves(active!) },
          "Insufficient cash to repay that amount."
        );
      }
      return {
        allowed: true,
        derived: { repaid: repay, outstandingAfter: outstanding - repay },
        transition: transition(
          snapshot,
          "discount_window_repay",
          suffix,
          [
            vaultLeg(snapshot, "debit", repay, "window repayment leaves the vault"),
            { kind: "burn", amount: repay, note: "central bank retires the liquidity" },
          ],
          [
            {
              collection: "corporations",
              filter: {
                ...corpFilter(snapshot.bankId),
                "bankCharter.discountWindowDebt": { $gte: repay },
              },
              update: { $inc: { "bankCharter.discountWindowDebt": -repay } },
              note: "the central bank's claim shrinks",
            },
            {
              collection: "centralBanks",
              filter: { _id: snapshot.centralBankId },
              update: { $inc: { netMoneyCreatedLifetime: -repay } },
              note: "money retired at the central bank",
            },
          ],
          {
            kind: "charter.issued",
            command: "bank.discountWindow.repay",
            statusAfter: "active",
            amount: -repay,
            meta: { operation: "discount_window_repay" },
          }
        ),
      };
    }

    case "draw_cb_margin": {
      const denied = requireCapability(snapshot, charter, "centralBankMargin");
      if (denied) return denied;
      const staged = requireStage(charter, "borrowFromCentralBank");
      if (staged) return staged;
      const amount = positiveAmount(command.amount);
      if (amount === null) return refuse({ code: "invalid_amount" }, INVALID_AMOUNT);
      const mark = Math.max(0, active!.propBookMarkValue ?? 0);
      const debt =
        Math.max(0, active!.cbMarginDebt ?? 0) + Math.max(0, active!.cbMarginArrears ?? 0);
      const maxDebt = CB_MARGIN_COLLATERAL_FRACTION * mark;
      if (debt + amount > maxDebt + 1e-9) {
        return refuse(
          { code: "cap", cap: "cbMarginCollateral", max: Math.max(0, maxDebt - debt) },
          "Draw would exceed CB margin collateral cap"
        );
      }
      return {
        allowed: true,
        derived: {
          cbMarginDebtAfter: debt + amount,
          ratePercent: cbMarginRatePercent(snapshot.primeRate),
        },
        transition: transition(
          snapshot,
          "cb_margin_draw",
          suffix,
          [
            { kind: "mint", amount, note: "central bank creates the margin advance" },
            vaultLeg(snapshot, "credit", amount, "margin advance arrives in the vault"),
          ],
          [
            {
              collection: "corporations",
              filter: corpFilter(snapshot.bankId),
              update: { $inc: { "bankCharter.cbMarginDebt": amount } },
              note: "margin principal owed to the central bank",
            },
            {
              collection: "centralBanks",
              filter: { _id: snapshot.centralBankId },
              update: { $inc: { netMoneyCreatedLifetime: amount } },
              note: "money created at the central bank",
            },
          ],
          {
            kind: "charter.issued",
            command: "bank.cbMargin.draw",
            statusAfter: "active",
            amount,
            meta: { operation: "cb_margin_draw" },
          }
        ),
      };
    }

    case "repay_cb_margin": {
      const denied = requireCapability(snapshot, charter, "centralBankMargin");
      if (denied) return denied;
      const amount = positiveAmount(command.amount);
      if (amount === null) return refuse({ code: "invalid_amount" }, INVALID_AMOUNT);
      const debt = Math.max(0, active!.cbMarginDebt ?? 0);
      const repay = Math.min(amount, debt, getCashReserves(active!));
      if (!(repay > 0)) {
        return refuse(
          { code: "state", detail: "nothing_to_repay" },
          "Nothing to repay or insufficient liquid capital"
        );
      }
      return {
        allowed: true,
        derived: { repaid: repay, cbMarginDebtAfter: debt - repay },
        transition: transition(
          snapshot,
          "cb_margin_repay",
          suffix,
          [
            vaultLeg(snapshot, "debit", repay, "margin repayment leaves the vault"),
            { kind: "burn", amount: repay, note: "central bank retires the advance" },
          ],
          [
            {
              collection: "corporations",
              filter: {
                ...corpFilter(snapshot.bankId),
                "bankCharter.cbMarginDebt": { $gte: repay },
              },
              update: { $inc: { "bankCharter.cbMarginDebt": -repay } },
              note: "margin principal repaid",
            },
            {
              collection: "centralBanks",
              filter: { _id: snapshot.centralBankId },
              update: { $inc: { netMoneyCreatedLifetime: -repay } },
              note: "money retired at the central bank",
            },
          ],
          {
            kind: "charter.issued",
            command: "bank.cbMargin.repay",
            statusAfter: "active",
            amount: -repay,
            meta: { operation: "cb_margin_repay" },
          }
        ),
      };
    }

    case "originate_named_loan": {
      const capability: CapabilityKey =
        command.borrower.type === "character" ? "namedCharacterLending" : "namedCorporationLending";
      const denied = requireCapability(snapshot, charter, capability);
      if (denied) return denied;
      const staged = requireStage(charter, "originate");
      if (staged) return staged;
      const principal = positiveAmount(command.principal);
      if (principal === null) {
        return refuse({ code: "invalid_amount" }, "Principal must be a positive number");
      }
      if (
        !Number.isInteger(command.termTurns) ||
        command.termTurns < NAMED_LOAN_MIN_TERM_TURNS ||
        command.termTurns > NAMED_LOAN_MAX_TERM_TURNS
      ) {
        return refuse(
          { code: "state", detail: "term" },
          `termTurns must be an integer from ${NAMED_LOAN_MIN_TERM_TURNS} to ${NAMED_LOAN_MAX_TERM_TURNS}`
        );
      }
      if (command.borrower.type === "corporation" && command.borrower.id === snapshot.bankId) {
        return refuse({ code: "state", detail: "self" }, "A bank cannot lend to itself");
      }
      if (command.borrower.blocked) {
        return refuse(
          { code: "state", detail: "blacklisted" },
          "Borrower is on the bank's blacklist"
        );
      }
      if (!command.borrower.currencyMatches) {
        return refuse(
          { code: "state", detail: "currency" },
          `Loan currency ${snapshot.currency} does not match the borrower's treasury currency`
        );
      }
      const rates = effectiveBankRatesFromPrime(active!, snapshot.primeRate);
      const ratePercent =
        command.borrower.type === "character"
          ? rates.lendingRatePercent + CHARACTER_LOAN_SPREAD_PP
          : rates.lendingRatePercent;
      const cashReserves = getCashReserves(active!);
      const headroom = namedLoanHeadroom(active!, snapshot.reserveRatio, sheetOptions(snapshot));
      const incomeCap = maxPrincipalFromIncome({
        incomePerTurn: command.borrower.incomePerTurn,
        ratePercent,
        termTurns: command.termTurns,
        committedPaymentPerTurn: command.borrower.committedPaymentPerTurn,
      });
      const capInput = { bankCashReserves: cashReserves, lendableHeadroom: headroom, incomeCap };
      const maxPrincipal = namedLoanPrincipalCap(capInput);
      if (principal > maxPrincipal) {
        const bind = bindingNamedLoanCap(capInput);
        const max = String(Math.floor(Math.max(0, maxPrincipal)));
        return refuse(
          { code: "cap", cap: bind, max: maxPrincipal },
          bind === "cashReserves"
            ? `Principal exceeds the bank's cash reserves (max ${max})`
            : bind === "headroom"
              ? `Principal exceeds lendable headroom (max ${max})`
              : `Principal exceeds borrower income limit (max ${max})`
        );
      }

      const pending = active!.requireApproval === true;
      const loanDoc = {
        _id: oid(command.loanId),
        bankCorporationId: oid(snapshot.bankId),
        currency: snapshot.currency,
        borrowerType: command.borrower.type,
        borrowerId: oid(command.borrower.id),
        principal,
        outstanding: principal,
        ratePercent,
        originatedTurn: snapshot.turn,
        termTurns: command.termTurns,
        status: pending ? "pending" : "current",
        ...(pending ? { requestedTurn: snapshot.turn } : {}),
      };
      const borrowerLeg: TransitionLeg =
        command.borrower.type === "character"
          ? {
              kind: "credit",
              amount: principal,
              collection: "characters",
              filter: { _id: oid(command.borrower.id) },
              path: `currencyBalances.personal.${snapshot.currency}`,
              note: "loan proceeds reach the borrower",
            }
          : {
              kind: "credit",
              amount: principal,
              collection: "corporations",
              filter: { _id: oid(command.borrower.id) },
              path: "liquidCapital",
              note: "loan proceeds reach the borrower",
            };
      return {
        allowed: true,
        derived: { ratePercent, maxPrincipal, pending },
        transition: transition(
          snapshot,
          pending ? "named_loan_request" : "named_loan_origination",
          command.loanId,
          pending
            ? []
            : [
                vaultLeg(snapshot, "debit", principal, "the bank funds the loan from its vault"),
                borrowerLeg,
              ],
          [
            { collection: "bankLoans", insert: loanDoc, note: "the loan record" },
            ...(pending
              ? []
              : [
                  {
                    collection: "corporations",
                    filter: corpFilter(snapshot.bankId),
                    update: { $inc: { "bankCharter.totalLoans": principal } },
                    note: "cached loan book total",
                  },
                ]),
          ],
          {
            kind: "loan.originated",
            command: "bank.loan.originate",
            subjectType: "loan",
            subjectId: command.loanId,
            statusAfter: pending ? "pending" : "current",
            amount: principal,
            meta: {
              borrowerType: command.borrower.type,
              termTurns: command.termTurns,
              ratePercent,
            },
          }
        ),
      };
    }

    case "disburse_pending_loan": {
      const capability: CapabilityKey =
        command.borrower.type === "character" ? "namedCharacterLending" : "namedCorporationLending";
      const denied = requireCapability(snapshot, charter, capability);
      if (denied) return denied;
      const principal = positiveAmount(command.principal);
      if (principal === null) {
        return refuse({ code: "invalid_amount" }, "Principal must be a positive number");
      }
      if (command.borrower.blocked) {
        return refuse(
          { code: "state", detail: "blacklisted" },
          "Borrower is on the bank's blacklist"
        );
      }
      const headroom = namedLoanHeadroom(active!, snapshot.reserveRatio, sheetOptions(snapshot));
      if (principal > headroom) {
        return refuse(
          { code: "cap", cap: "headroom", max: headroom },
          "Insufficient lendable headroom to fund this loan now"
        );
      }
      if (principal > getCashReserves(active!)) {
        return refuse(
          { code: "cap", cap: "cashReserves", max: getCashReserves(active!) },
          "Insufficient cash reserves to fund this loan now"
        );
      }
      const proceeds: TransitionLeg =
        command.borrower.type === "character"
          ? {
              kind: "credit",
              amount: principal,
              collection: "characters",
              filter: { _id: oid(command.borrower.id) },
              path: `currencyBalances.personal.${snapshot.currency}`,
              note: "loan proceeds reach the borrower",
            }
          : {
              kind: "credit",
              amount: principal,
              collection: "corporations",
              filter: { _id: oid(command.borrower.id) },
              path: "liquidCapital",
              note: "loan proceeds reach the borrower",
            };
      return {
        allowed: true,
        transition: transition(
          snapshot,
          "named_loan_disbursement",
          command.loanId,
          [
            vaultLeg(snapshot, "debit", principal, "the bank funds the loan from its vault"),
            proceeds,
          ],
          [
            {
              collection: "bankLoans",
              filter: { _id: oid(command.loanId), status: "pending" },
              update: { $set: { status: "current", decisionTurn: snapshot.turn } },
              note: "pending loan becomes current",
            },
            {
              collection: "corporations",
              filter: corpFilter(snapshot.bankId),
              update: { $inc: { "bankCharter.totalLoans": principal } },
              note: "cached loan book total",
            },
          ],
          {
            kind: "loan.approved",
            command: "bank.loan.approve",
            subjectType: "loan",
            subjectId: command.loanId,
            statusBefore: "pending",
            statusAfter: "current",
            amount: principal,
            meta: { borrowerType: command.borrower.type },
          }
        ),
      };
    }

    case "reject_pending_loan": {
      const denied = requireCapability(snapshot, charter, "serviceLoanBook");
      if (denied) return denied;
      const trimmed = (command.reason ?? "").trim().slice(0, 280);
      return {
        allowed: true,
        transition: transition(
          snapshot,
          "named_loan_rejection",
          command.loanId,
          [],
          [
            {
              collection: "bankLoans",
              filter: { _id: oid(command.loanId), status: "pending" },
              update: {
                $set: {
                  status: "rejected",
                  decisionTurn: snapshot.turn,
                  ...(trimmed ? { rejectedReason: trimmed } : {}),
                },
              },
              note: "pending loan declined",
            },
          ],
          {
            kind: "loan.rejected",
            command: "bank.loan.reject",
            subjectType: "loan",
            subjectId: command.loanId,
            statusBefore: "pending",
            statusAfter: "rejected",
            meta: { hasReason: trimmed.length > 0 },
          }
        ),
      };
    }

    case "lend_interbank": {
      const denied = requireCapability(snapshot, charter, "interbankLending");
      if (denied) return denied;
      const staged = requireStage(charter, "originate");
      if (staged) return staged;
      const amount = positiveAmount(command.amount);
      if (amount === null) return refuse({ code: "invalid_amount" }, INVALID_AMOUNT);
      if (!Number.isFinite(command.ratePercent) || command.ratePercent < 0) {
        return refuse({ code: "invalid_amount" }, "Rate must be a non-negative number");
      }
      if (command.borrowerBankId === snapshot.bankId) {
        return refuse(
          { code: "state", detail: "self" },
          "A bank cannot lend to itself on the interbank market"
        );
      }
      const borrowerCaps = charterCapabilities(command.borrowerCharter, snapshot.policy);
      if (!borrowerCaps.interbankBorrowing.allowed) {
        return refuse(
          {
            code: "capability",
            capability: "interbankBorrowing",
            denial: borrowerCaps.interbankBorrowing.reason!,
          },
          "Borrower must have an active investment or universal charter"
        );
      }
      if (command.borrowerCharter!.currency !== snapshot.currency) {
        return refuse(
          { code: "state", detail: "currency" },
          "Lender and borrower charter currencies must match"
        );
      }
      const headroom = getLendableHeadroom(active!, snapshot.reserveRatio, sheetOptions(snapshot));
      const maxByShare = INTERBANK_MAX_SHARE_OF_LENDABLE * headroom;
      if (amount > maxByShare + 1e-9 || command.lenderOutstanding + amount > maxByShare + 1e-9) {
        return refuse(
          {
            code: "cap",
            cap: "interbankShare",
            max: Math.max(0, maxByShare - command.lenderOutstanding),
          },
          "Amount exceeds interbank share of lendable headroom"
        );
      }
      if (amount > getCashReserves(active!) + 1e-9) {
        return refuse(
          { code: "insufficient_funds", available: getCashReserves(active!) },
          "Lender has insufficient liquid capital"
        );
      }
      return {
        allowed: true,
        transition: transition(
          snapshot,
          "interbank_lend",
          command.loanId,
          [
            vaultLeg(snapshot, "debit", amount, "lending bank's cash leaves its vault"),
            {
              kind: "credit",
              amount,
              collection: "corporations",
              filter: { _id: oid(command.borrowerBankId), "bankCharter.status": "active" },
              path: "bankCharter.cashReserves",
              note: "borrowing bank receives the cash",
            },
          ],
          [
            {
              collection: "interbankLoans",
              insert: {
                _id: oid(command.loanId),
                lenderCorporationId: oid(snapshot.bankId),
                borrowerCorporationId: oid(command.borrowerBankId),
                currency: snapshot.currency,
                principal: amount,
                outstanding: amount,
                ratePercent: command.ratePercent,
                originatedTurn: snapshot.turn,
                status: "current",
              },
              note: "the interbank loan record",
            },
            {
              collection: "corporations",
              filter: { _id: oid(command.borrowerBankId) },
              update: { $inc: { "bankCharter.interbankDebt": amount } },
              note: "borrower's interbank debt",
            },
          ],
          {
            kind: "loan.originated",
            command: "bank.interbank.lend",
            subjectType: "interbankLoan",
            subjectId: command.loanId,
            statusAfter: "current",
            amount,
            meta: { ratePercent: command.ratePercent, counterpartyBankId: command.borrowerBankId },
          }
        ),
      };
    }

    case "repay_interbank": {
      const denied = requireCapability(snapshot, charter, "interbankBorrowing");
      if (denied) return denied;
      const amount = positiveAmount(command.amount);
      if (amount === null) return refuse({ code: "invalid_amount" }, INVALID_AMOUNT);
      const outstanding = Math.max(0, command.outstanding);
      const repay = Math.min(amount, outstanding);
      if (!(repay > 0))
        return refuse({ code: "state", detail: "nothing_to_repay" }, "Nothing to repay");
      if (repay > getCashReserves(active!) + 1e-9) {
        return refuse(
          { code: "insufficient_funds", available: getCashReserves(active!) },
          "Borrower has insufficient liquid capital"
        );
      }
      const after = Math.max(0, outstanding - repay);
      return {
        allowed: true,
        derived: { repaid: repay, outstandingAfter: after },
        transition: transition(
          snapshot,
          "interbank_repay",
          `${command.loanId}:${suffix}`,
          [
            vaultLeg(snapshot, "debit", repay, "borrowing bank repays principal"),
            {
              kind: "credit",
              amount: repay,
              collection: "corporations",
              filter: { _id: oid(command.lenderBankId) },
              path: "bankCharter.cashReserves",
              note: "lending bank recovers principal",
            },
          ],
          [
            {
              collection: "corporations",
              filter: {
                ...corpFilter(snapshot.bankId),
                "bankCharter.interbankDebt": { $gte: repay },
              },
              update: { $inc: { "bankCharter.interbankDebt": -repay } },
              note: "borrower's interbank debt shrinks",
            },
            {
              collection: "interbankLoans",
              filter: { _id: oid(command.loanId), status: "current" },
              update: {
                $set: {
                  outstanding: after,
                  status: after <= 0 ? "repaid" : "current",
                  arrearsTurns: 0,
                },
              },
              note: "loan record after repayment",
            },
          ],
          {
            kind: "loan.paid",
            command: "bank.interbank.repay",
            subjectType: "interbankLoan",
            subjectId: command.loanId,
            statusBefore: "current",
            statusAfter: after <= 0 ? "repaid" : "current",
            amount: repay,
            meta: { counterpartyBankId: command.lenderBankId },
          }
        ),
      };
    }
  }
}
