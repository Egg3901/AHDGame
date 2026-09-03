/**
 * The Banking Rules boundary: snapshot in, decision out.
 *
 * A caller (a route, a turn stage, the simulation harness) loads an immutable
 * snapshot of one bank and its currency context, hands it to `decide` with a
 * command, and gets back either a refusal with a reason a player can read or
 * an allowed decision carrying one balanced transition. The caller then
 * commits the transition through the settlement journal and publishes the
 * event the decision names. Nothing on this side of the boundary touches the
 * database, the clock, or a feature flag it was not handed.
 *
 * The shapes are deliberately plain: string ids, numbers, and literal unions.
 * A transition is data the journal can apply and a test can inspect; it is
 * never a closure.
 */

import type { BankCharter } from "@/lib/db/types/bank";
import type { BankingPolicySnapshot } from "@/lib/banking/rules/policy";
import type { CapabilityDenial, CapabilityKey } from "@/lib/banking/rules/capabilities";
import type { ValueLegKind } from "@/lib/banking/rules/invariants";
import type { BankingAuditEventKind, BankingAuditMeta } from "@/lib/banking/rules/auditEvents";

/** The charter fields the rules read. A projection of the stored sub-document. */
export type BankCharterSnapshot = Pick<
  BankCharter,
  | "type"
  | "status"
  | "currency"
  | "postedCapital"
  | "cashReserves"
  | "npcDeposits"
  | "totalDeposits"
  | "totalLoans"
  | "depositOffset"
  | "lendingOffset"
  | "discountWindowDebt"
  | "discountWindowArrears"
  | "cbMarginDebt"
  | "cbMarginArrears"
  | "interbankDebt"
  | "propBookMarkValue"
  | "capitalStanding"
  | "requireApproval"
  | "lendingProfile"
  | "charterSwitchCooldownUntilTurn"
>;

export interface BankingSnapshot {
  /** The in-flight turn. Idempotency keys and deadlines are derived from it. */
  turn: number;
  policy: BankingPolicySnapshot;
  /** Bank corporation id, hex. */
  bankId: string;
  currency: string;
  charter: BankCharterSnapshot | null;
  /** The holding company's own treasury, outside the ring fence. */
  corporationLiquidCapital: number;
  /** Reserve requirement for the currency, 0..1. */
  reserveRatio: number;
  primeRate: number;
  /** Central bank document id for the currency. */
  centralBankId: string;
  /** Deposit ceiling implied by branch capacity, when the caller loaded sectors. */
  capacityCeiling?: number;
}

/** A borrower as the rules see one: income and commitments, never a document. */
export interface BorrowerSnapshot {
  type: "corporation" | "character";
  id: string;
  /** Per-turn income in the loan currency. */
  incomePerTurn: number;
  /** Per-turn instalments already committed on other named loans. */
  committedPaymentPerTurn: number;
  /** True when the bank's blacklist covers this borrower. */
  blocked: boolean;
  /** For a corporation: whether its treasury is in the loan currency. */
  currencyMatches: boolean;
}

export type BankCommand =
  | { type: "inject_capital"; amount: number }
  | { type: "upstream_cash"; amount: number }
  | { type: "draw_discount_window"; amount: number }
  | { type: "repay_discount_window"; amount: number }
  | { type: "draw_cb_margin"; amount: number }
  | { type: "repay_cb_margin"; amount: number }
  | {
      type: "originate_named_loan";
      /** Pre-generated so the transition and its key are deterministic. */
      loanId: string;
      borrower: BorrowerSnapshot;
      principal: number;
      termTurns: number;
    }
  | {
      type: "lend_interbank";
      loanId: string;
      borrowerBankId: string;
      borrowerCharter: BankCharterSnapshot | null;
      amount: number;
      ratePercent: number;
      /** Principal this lender already has out on the interbank market. */
      lenderOutstanding: number;
    }
  | {
      type: "repay_interbank";
      loanId: string;
      lenderBankId: string;
      outstanding: number;
      amount: number;
    };

export type BankCommandType = BankCommand["type"];

/**
 * Document ids inside a transition are written as `{ $oid: "<hex>" }`. The
 * rules zone cannot construct a driver ObjectId, and a transition has to be
 * plain data anyway so a simulation host can apply it to an in-memory store.
 * The settlement journal revives every `$oid` marker before it writes.
 */
export interface OidRef {
  $oid: string;
}

export function oid(hex: string): OidRef {
  return { $oid: hex };
}

/** One side of a transition, addressed the way the journal applies it. */
export interface TransitionLeg {
  kind: ValueLegKind;
  amount: number;
  collection?: string;
  filter?: Record<string, unknown>;
  path?: string;
  set?: Record<string, unknown>;
  note: string;
}

/**
 * A document write that is not money: a status flip, a counter, a new loan
 * record. Applied after the legs land, recorded on the journal so a crashed
 * transition can be finished.
 */
export interface TransitionProjection {
  collection: string;
  /** Present for an update; absent for an insert. */
  filter?: Record<string, unknown>;
  /** Mongo-style update operators for an update. */
  update?: Record<string, unknown>;
  /** The whole document for an insert. */
  insert?: Record<string, unknown>;
  note: string;
}

export interface TransitionEvent {
  kind: BankingAuditEventKind;
  command: string;
  subjectType?: string;
  subjectId?: string;
  statusBefore?: string;
  statusAfter?: string;
  amount?: number;
  meta?: BankingAuditMeta;
}

export interface BankingTransition {
  /** Idempotency key. Same key, same transition, forever. */
  key: string;
  kind: string;
  turn: number;
  currency: string;
  legs: TransitionLeg[];
  projections: TransitionProjection[];
  event: TransitionEvent;
}

export type DecisionRefusal =
  | { code: "capability"; capability: CapabilityKey; denial: CapabilityDenial }
  | { code: "invalid_amount" }
  | { code: "cap"; cap: string; max: number }
  | { code: "insufficient_funds"; available: number }
  | { code: "state"; detail: string };

export type BankingDecision =
  | {
      allowed: true;
      transition: BankingTransition;
      /** Figures the caller may want to show, e.g. the loan rate that was set. */
      derived?: Record<string, number | string | boolean>;
    }
  | {
      allowed: false;
      refusal: DecisionRefusal;
      /** One sentence for the player. */
      message: string;
    };
