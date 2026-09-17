import { randomUUID } from "node:crypto";
import { ObjectId, type Collection, type Db, type Filter } from "mongodb";
import {
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  deriveMoneyFlowKey,
  failMoneyFlowReceipt,
  insertKeyedDoc,
  keyedInsertId,
  makeLegStep,
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  runMoneyFlowSteps,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
  type MoneyFlowLeg,
  type MoneyFlowLegOutcome,
  type MoneyFlowReceipt,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import {
  makeCapCreditStep,
  makeCapDebitStep,
  makeCashStep,
  type ShareFillCapLeg,
  type ShareFillCashLeg,
} from "@/lib/corporations/commands/shareTrading/shareFillMoney";
import {
  makeDealerStep,
  type ShareOrderPlacementDealer,
} from "@/lib/corporations/shareOrderPlacement";
import { buildShareTradeDoc, type ShareTradeParty } from "@/lib/corporations/shareTradeHistory";
import type { ShareTradeHistory } from "@/lib/db/types/shareTradeHistory";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { emitTx } from "@/lib/financialTxLog/emit";
import { safeDistributeConversionSpread } from "@/lib/currency/marketMaker";
import { onFloatSellCommitted } from "@/lib/corporations/shareEscrowSettlement";
import { recordAudit } from "@/lib/audit/recordAudit";
import { closeCeoTenure } from "@/lib/corporations/ceoHistory";

/**
 * Keyed market float trades (issue #1672).
 *
 * `buyPublicShares` / `sellPublicShares` ran every market trade debit-first
 * with manual compensation: a crash between the buyer debit and the cap-table
 * credit left the buyer down with no shares (the guarded float check then
 * reported a full float on retry, stranding cash), a crash between the share
 * debit and the proceeds credit left the seller with neither shares nor cash,
 * and every issuer-settlement leg (`applyFloatBuyCredit` /
 * `settleFloatSellDebit`) ran outside any receipt, so a crash there stranded
 * money on exactly one side with no same-key retry able to converge it. The
 * manual catch blocks refunded with plain updates that raced keyed recovery,
 * and neither route accepted an `Idempotency-Key`, so a client retry after a
 * timeout double-traded.
 *
 * This module runs every float buy and sell as one keyed money flow,
 * following the share-fill money and order-placement conventions:
 *
 * - One receipt per trade attempt. The routes forward the client
 *   `Idempotency-Key` (minted when absent). Same-key retries converge on the
 *   stored plan and return the stored response; a key reused with a different
 *   fingerprint throws `MoneyFlowKeyConflictError` (fail closed); a key that
 *   settled without completing throws `MoneyFlowTerminalError`.
 * - The route pins every amount, currency field, dealer routing decision,
 *   escrow split, CEO-vacate snapshot, wash exclusion, and guard error string
 *   BEFORE the flow starts, and the flow stores that immutable plan on the
 *   receipt before the first step. Recovery replays the stored figures
 *   instead of repricing from post-debit state, so FX drift between attempt
 *   and retry cannot move money.
 * - Step order mirrors the legacy write order exactly. Buys: buyer debit,
 *   float decrement (guarded, the legacy `publicFloat >= shares` gate), buyer
 *   cap-table credit, issuer credit (pool / treasury / escrow, reusing the
 *   placement dealer shapes including the atomic escrow-split pipeline
 *   write), terminal history insert. Sells: issuer debit first (the legacy
 *   buyback gate: pool depth, then gated treasury, then floored escrow
 *   split), seller cap-table debit (the legacy sufficiency gate), float
 *   increment with the CEO-vacate mutation folded in, proceeds credit,
 *   terminal history insert.
 * - Cash debits gate `$gte` + `$ne: key` in one atomic write (exactly the
 *   legacy `atomicallyDebit*` semantics), cap-table moves reuse the keyed
 *   cap debit/credit steps, and `runMoneyFlowSteps` reverses the applied
 *   prefix with keyed inverses before settling, so a trade ends `completed`
 *   or terminal without effect, never partial.
 * - The float step carries the full order-flow `$inc` record (including the
 *   wash-round-trip neutralization, which can touch both window fields, so
 *   the single-field placement float step is not reused here). The CEO-vacate
 *   mutation rides the sell float step with a pinned restore snapshot, so a
 *   compensated sell restores the exact prior CEO fields.
 * - The history row is the terminal money step under a deterministic `_id`
 *   (a crash there stays `in_progress` and the retry converges instead of
 *   compensating the trade). The tx row is post-commit best effort with a
 *   deterministic `_id` (replays converge). The corp-buy FX spread rides
 *   `safeDistributeConversionSpread` post-commit; `onFloatSellCommitted`
 *   stays fire-and-forget; audit and takeover notifications fire only on the
 *   fresh attempt; CEO vote cleanup and tenure close run post-commit best
 *   effort.
 *
 * Legacy economics and API behavior are preserved: identical debit/credit
 * math, identical response bodies and status codes, identical error strings
 * (pinned per guard at plan time), and the character/imperial order-book
 * branch still runs first as a caller pre-step (its fills are stored as
 * completed receipts under an explicit key so a same-key retry replays
 * instead of selling twice).
 */

export const PUBLIC_SHARE_TRADE_FINGERPRINT_DOMAIN = "public-share-trade";
export const PUBLIC_SHARE_TRADE_TX_DOMAIN = "public-share-trade-tx";
export const PUBLIC_SHARE_TRADE_HISTORY_DOMAIN = "public-share-trade-history";

export type PublicShareTradeKind = "market-buy" | "market-sell";

export type PublicShareTradeStepName =
  | "buyer-debit"
  | "float"
  | "buyer-credit"
  | "dealer"
  | "seller-debit"
  | "proceeds-credit"
  | "history";

export interface PublicShareTradePinnedError {
  message: string;
  status: number;
}

export interface PublicShareTradeTxPlan {
  type: "stock_trade_buy" | "stock_trade_sell";
  subjectType: "character" | "corporation";
  subjectIdHex: string;
  subjectName: string;
  amount: number;
  /** Balance-after is informational: read live post-commit (see below). */
  includeBalanceAfter: boolean;
  /** Pinned debit result is NOT reused: under contention the live re-read wins. */
  currencyCode: string;
  counterpartyType: "corporation";
  counterpartyIdHex: string;
  counterpartyName: string;
  meta: Record<string, unknown>;
}

export interface PublicShareTradeHistoryPlan {
  kind: "market_buy" | "market_sell";
  shares: number;
  pricePerShareAnchor: number;
  from: ShareTradeParty | null;
  to: ShareTradeParty | null;
  corpCurrencyCode?: string;
}

export interface PublicShareTradeAuditPlan {
  counterpartyType: "character" | "corporation";
  counterpartyIdHex: string;
  counterpartyName: string;
  amount: number;
  currencyCode: string;
  shares: number;
  pricePerShare: number;
}

/** Prior CEO fields pinned at plan time so a compensated sell restores them exactly. */
export interface PublicShareTradeCeoSnapshot {
  ceoIdHex: string;
  userIdHex: string;
  ceoVacant: boolean;
  ceoVacantSinceTurn?: number;
  pendingCeoCharacterIdHex?: string;
}

/**
 * Immutable resume plan pinned before the first step. Every remainder,
 * amount, currency field, party, routing decision, wash exclusion, guard
 * error string, and response body is fixed here; recovery replays these
 * figures.
 */
export interface PublicShareTradePlan {
  version: 1;
  tradeKey: string;
  kind: PublicShareTradeKind;
  corpIdHex: string;
  corpName: string;
  shares: number;
  executionPrice: number;
  turn: number;
  nowIso: string;
  orderFlowEligible: boolean;
  washExcluded: boolean;
  /** Buy debit (buyer cash). Null on sells. */
  buyerDebit: ShareFillCashLeg | null;
  /** Buyer cap-table credit. Null on sells. */
  capCredit: ShareFillCapLeg | null;
  /** Seller cap-table debit. Null on buys. */
  capDebit: ShareFillCapLeg | null;
  /** Seller proceeds credit. Null on buys. */
  proceedsLeg: ShareFillCashLeg | null;
  /** Issuer settlement (buy credit / sell debit). */
  dealer: ShareOrderPlacementDealer | null;
  /** Sell CEO vacate folded into the float step. Null unless the sale vacates. */
  ceoVacate: PublicShareTradeCeoSnapshot | null;
  /** Post-commit CEO tenure close on vacate. Mirrors ceoVacate presence. */
  closeTenureHolderIdHex: string | null;
  tx: PublicShareTradeTxPlan | null;
  history: PublicShareTradeHistoryPlan | null;
  spread: { fee: number; from: string; to: string } | null;
  /** Sells audit; buys only notify. Null when neither applies. */
  audit: PublicShareTradeAuditPlan | null;
  notifyTakeover: boolean;
  /** Legacy guard error strings pinned per step name. */
  errors: Record<PublicShareTradeStepName, PublicShareTradePinnedError>;
  /** Exact legacy response body, stored at settle for replays. */
  response: Record<string, unknown>;
  spreadDistributed?: boolean;
}

export function isPublicShareTradePlan(value: unknown): value is PublicShareTradePlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    plan.version === 1 &&
    typeof plan.tradeKey === "string" &&
    (plan.kind === "market-buy" || plan.kind === "market-sell") &&
    typeof plan.corpIdHex === "string" &&
    typeof plan.response === "object"
  );
}

export function buildPublicShareTradeFingerprint(plan: PublicShareTradePlan): string {
  const cents = (n: number): string => String(Math.round(n * 100) / 100);
  const cash = (leg: ShareFillCashLeg | null): string =>
    leg ? `${leg.collection}:${leg.idHex}:${leg.field}:${cents(leg.amount)}` : "none";
  const cap = (leg: ShareFillCapLeg | null): string =>
    leg ? `${leg.field}:${leg.idHex}:${cents(leg.pricePerShare)}` : "none";
  const dealer = plan.dealer
    ? `${plan.dealer.kind}:${cents(plan.dealer.amountLocal)}:${plan.dealer.currency ?? "none"}:${plan.dealer.flowKind ?? "none"}:${cents(plan.dealer.escrowPart ?? 0)}:${cents(plan.dealer.treasuryPart ?? 0)}`
    : "none";
  return [
    PUBLIC_SHARE_TRADE_FINGERPRINT_DOMAIN,
    plan.kind,
    plan.corpIdHex,
    `shares:${plan.shares}`,
    `exec:${cents(plan.executionPrice)}`,
    `debit:${cash(plan.buyerDebit)}`,
    `credit:${cap(plan.capCredit)}`,
    `capDebit:${cap(plan.capDebit)}`,
    `proceeds:${cash(plan.proceedsLeg)}`,
    `dealer:${dealer}`,
    `vacate:${plan.ceoVacate ? plan.ceoVacate.ceoIdHex : "none"}`,
  ].join(":");
}

export type PublicShareTradeResult =
  | { ok: true; body: Record<string, unknown>; replayed: boolean }
  | { ok: false; error: string; status: number };

type PublicShareTradeReceipt = MoneyFlowReceipt & {
  publicShareTradePlan?: unknown;
  publicShareTradeResponse?: unknown;
};

function receipts(db: Db): Collection<MoneyFlowReceipt> {
  return db.collection<MoneyFlowReceipt>(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION);
}

function receiptsEx(db: Db): Collection<PublicShareTradeReceipt> {
  return db.collection<PublicShareTradeReceipt>(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION);
}

function mapTradeError(plan: PublicShareTradePlan) {
  return (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error => {
    const pinned = plan.errors[step.name as PublicShareTradeStepName];
    if (pinned) {
      return new Error(`PUBLIC_SHARE_TRADE:${pinned.status}:${pinned.message}`);
    }
    return new Error(`public-share-trade:${step.name}:${outcome}`);
  };
}

function tradeErrorOf(error: Error): { error: string; status: number } {
  const match = /^PUBLIC_SHARE_TRADE:(\d+):([\s\S]*)$/.exec(error.message);
  if (match) return { error: match[2]!, status: Number(match[1]) };
  throw error;
}

interface TradeCorpAccount {
  _id: ObjectId;
  appliedMoneyFlowKeys?: string[];
}

/**
 * Float `$inc` carrying the full order-flow record (the wash-round-trip
 * neutralization can touch both window fields, which the single-field
 * placement float step cannot express). Buys decrement under the legacy
 * `$gte` gate; sells increment unconditionally. Revert is the exact inverse
 * through the keyed leg machinery.
 */
function makeTradeFloatStep(
  db: Db,
  tradeKey: string,
  corpId: ObjectId,
  delta: number,
  orderFlow: Record<string, number>,
  now: Date
): MoneyFlowStep {
  const extraIncs: Record<string, number> | undefined =
    Object.keys(orderFlow).length > 0 ? orderFlow : undefined;
  const leg: MoneyFlowLeg<TradeCorpAccount> = {
    name: "float",
    collection: db.collection<TradeCorpAccount>("corporations"),
    docId: corpId,
    field: "publicFloat",
    delta,
    ...(delta < 0 ? { minBalance: -delta } : {}),
    ...(extraIncs ? { extraIncs } : {}),
    set: { updatedAt: now },
  };
  return makeLegStep(deriveMoneyFlowKey(tradeKey, "float"), leg);
}

/**
 * Sell float increment with the CEO-vacate mutation folded in (the legacy
 * sell performs the share debit, float increment, and CEO vacate in one
 * update). The vacate snapshot is pinned in the plan; the revert restores
 * the exact prior CEO fields so a compensated sell leaves tenure untouched.
 */
function makeFloatCeoStep(
  db: Db,
  tradeKey: string,
  corpId: ObjectId,
  delta: number,
  orderFlow: Record<string, number>,
  vacate: PublicShareTradeCeoSnapshot,
  vacateTurn: number,
  now: Date
): MoneyFlowStep {
  const subkey = deriveMoneyFlowKey(tradeKey, "float");
  const corps = db.collection<TradeCorpAccount>("corporations");
  const extraIncs: Record<string, number> | undefined =
    Object.keys(orderFlow).length > 0 ? orderFlow : undefined;
  const negatedExtra: Record<string, number> | undefined = extraIncs
    ? Object.fromEntries(Object.entries(extraIncs).map(([field, amount]) => [field, -amount]))
    : undefined;
  const restoreSet: Record<string, unknown> = {
    ceoId: new ObjectId(vacate.ceoIdHex),
    userId: new ObjectId(vacate.userIdHex),
    ceoVacant: vacate.ceoVacant,
    updatedAt: now,
  };
  if (vacate.ceoVacantSinceTurn !== undefined) {
    restoreSet.ceoVacantSinceTurn = vacate.ceoVacantSinceTurn;
  }
  if (vacate.pendingCeoCharacterIdHex !== undefined) {
    restoreSet.pendingCeoCharacterId = new ObjectId(vacate.pendingCeoCharacterIdHex);
  }
  const restoreUnset: Record<string, ""> = {};
  if (vacate.ceoVacantSinceTurn === undefined) restoreUnset.ceoVacantSinceTurn = "";
  if (vacate.pendingCeoCharacterIdHex === undefined) restoreUnset.pendingCeoCharacterId = "";
  return {
    name: "float",
    apply: () =>
      applyKeyedUpdate(
        subkey,
        {
          collection: corps,
          filter: { _id: corpId } as Filter<TradeCorpAccount>,
          update: {
            $inc: { publicFloat: delta, ...(extraIncs ?? {}) },
            $set: { updatedAt: now, ceoVacant: true, ceoVacantSinceTurn: vacateTurn },
            $unset: { ceoId: "", userId: "", pendingCeoCharacterId: "" },
          },
        },
        {}
      ),
    revert: () =>
      applyKeyedUpdate(
        deriveMoneyFlowKey(subkey, "compensate", "float"),
        {
          collection: corps,
          filter: { _id: corpId } as Filter<TradeCorpAccount>,
          update: {
            $inc: { publicFloat: -delta, ...(negatedExtra ?? {}) },
            $set: restoreSet,
            ...(Object.keys(restoreUnset).length > 0 ? { $unset: restoreUnset } : {}),
          },
        },
        {}
      ),
  };
}

/**
 * Terminal history insert: no revert, nothing runs after. A direct keyed
 * insert (not the best-effort `recordShareTrade`, whose catch-all would
 * swallow a process death into a silent row): duplicates converge on the
 * deterministic `_id` and anything else propagates, so a crash here leaves
 * the receipt `in_progress` and the same-key retry converges instead of
 * compensating the trade and burning the key.
 */
function makeTradeHistoryStep(db: Db, tradeKey: string, plan: PublicShareTradePlan): MoneyFlowStep {
  const historyDoc: ShareTradeHistory = buildShareTradeDoc(
    {
      corporationId: new ObjectId(plan.corpIdHex),
      kind: plan.history!.kind,
      turn: plan.turn,
      shares: plan.history!.shares,
      pricePerShareAnchor: plan.history!.pricePerShareAnchor,
      corpCurrencyCode: plan.history!.corpCurrencyCode as CurrencyCode | undefined,
      from: plan.history!.from,
      to: plan.history!.to,
      createdAt: new Date(plan.nowIso),
    },
    keyedInsertId(tradeKey, PUBLIC_SHARE_TRADE_HISTORY_DOMAIN)
  );
  return {
    name: "history",
    apply: () => insertKeyedDoc(db.collection<ShareTradeHistory>("shareTradeHistory"), historyDoc),
  };
}

/** Step build shared by first attempt and crash recovery (from the stored plan). */
export function buildPublicShareTradeSteps(db: Db, plan: PublicShareTradePlan): MoneyFlowStep[] {
  const now = new Date(plan.nowIso);
  const corpId = new ObjectId(plan.corpIdHex);
  const notional = plan.shares * plan.executionPrice;
  const steps: MoneyFlowStep[] = [];
  if (plan.kind === "market-buy") {
    if (!plan.buyerDebit || !plan.capCredit) {
      throw new Error("public-share-trade:buy-needs-debit-and-credit");
    }
    steps.push(
      makeCashStep(
        db,
        "buyer-debit",
        deriveMoneyFlowKey(plan.tradeKey, "buyer-debit"),
        plan.buyerDebit,
        true,
        now
      )
    );
    // Legacy buy order: cap credit and float decrement in one guarded write.
    // The guarded float step runs first so a drained float fails before any
    // share row is touched; the unguarded cap credit then cannot fail on a
    // live corp doc, and compensation reverses both on a later failure.
    const buyFlow = plan.orderFlowEligible ? buildBuyOrderFlow(plan.washExcluded, notional) : {};
    steps.push(makeTradeFloatStep(db, plan.tradeKey, corpId, -plan.shares, buyFlow, now));
    steps.push(
      makeCapCreditStep(
        db,
        "buyer-credit",
        deriveMoneyFlowKey(plan.tradeKey, "buyer-credit"),
        corpId,
        plan.capCredit,
        plan.shares,
        now
      )
    );
    if (plan.dealer) {
      const dealerStep = makeDealerStep(db, plan.tradeKey, corpId, plan.dealer, now);
      if (dealerStep) steps.push(dealerStep);
    }
  } else {
    if (!plan.capDebit || !plan.proceedsLeg) {
      throw new Error("public-share-trade:sell-needs-debit-and-proceeds");
    }
    // Legacy sell order: the issuer buyback settles FIRST as the gate, then
    // the share debit, then the proceeds credit.
    if (plan.dealer) {
      const dealerStep = makeDealerStep(db, plan.tradeKey, corpId, plan.dealer, now);
      if (dealerStep) steps.push(dealerStep);
    }
    steps.push(
      makeCapDebitStep(
        db,
        deriveMoneyFlowKey(plan.tradeKey, "seller-debit"),
        corpId,
        plan.capDebit,
        plan.shares,
        now
      )
    );
    const sellFlow = plan.orderFlowEligible ? buildSellOrderFlow(plan.washExcluded, notional) : {};
    if (plan.ceoVacate) {
      steps.push(
        makeFloatCeoStep(
          db,
          plan.tradeKey,
          corpId,
          plan.shares,
          sellFlow,
          plan.ceoVacate,
          plan.turn,
          now
        )
      );
    } else {
      steps.push(makeTradeFloatStep(db, plan.tradeKey, corpId, plan.shares, sellFlow, now));
    }
    steps.push(
      makeCashStep(
        db,
        "proceeds-credit",
        deriveMoneyFlowKey(plan.tradeKey, "proceeds-credit"),
        plan.proceedsLeg,
        false,
        now
      )
    );
  }
  if (plan.history) {
    steps.push(makeTradeHistoryStep(db, plan.tradeKey, plan));
  }
  return steps;
}

function buildBuyOrderFlow(washExcluded: boolean, notional: number): Record<string, number> {
  if (!(notional > 0)) return {};
  if (washExcluded) return { orderFlowWindowSellValue: -notional };
  return { orderFlowWindowBuyValue: notional };
}

function buildSellOrderFlow(washExcluded: boolean, notional: number): Record<string, number> {
  if (!(notional > 0)) return {};
  if (washExcluded) return { orderFlowWindowBuyValue: -notional };
  return { orderFlowWindowSellValue: notional };
}

/** Post-commit best-effort tx row with a deterministic id (replays converge). */
async function emitTradeTxBestEffort(db: Db, plan: PublicShareTradePlan): Promise<void> {
  if (!plan.tx) return;
  const tx = plan.tx;
  try {
    await emitTx(
      db,
      {
        type: tx.type,
        turn: plan.turn,
        createdAt: new Date(plan.nowIso),
        subjectType: tx.subjectType,
        subjectId: new ObjectId(tx.subjectIdHex),
        subjectName: tx.subjectName,
        amount: tx.amount,
        ...(tx.includeBalanceAfter ? { balanceAfter: await readBalanceAfter(db, plan) } : {}),
        currencyCode: tx.currencyCode as CurrencyCode,
        counterpartyType: tx.counterpartyType,
        counterpartyId: new ObjectId(tx.counterpartyIdHex),
        counterpartyName: tx.counterpartyName,
        meta: { ...tx.meta },
      },
      undefined,
      { _id: keyedInsertId(plan.tradeKey, PUBLIC_SHARE_TRADE_TX_DOMAIN) }
    );
  } catch {
    // Best effort, like the legacy fire-and-forget rows.
  }
}

/**
 * `balanceAfter` is informational: the legacy path pinned the debit result,
 * but the debit result is only observable inside the keyed step. Re-reading
 * live post-commit reports the same figure whenever nothing else moved the
 * wallet between the debit and the emit (the common case); under contention
 * it reports the later balance instead of the post-debit one.
 */
async function readBalanceAfter(db: Db, plan: PublicShareTradePlan): Promise<number> {
  const leg = plan.buyerDebit;
  if (!leg) return 0;
  try {
    const doc = (await db
      .collection<{ _id: ObjectId }>(leg.collection)
      .findOne(
        { _id: new ObjectId(leg.idHex) } as Filter<{ _id: ObjectId }>,
        { projection: { [leg.field]: 1 } } as never
      )) as unknown as Record<string, unknown> | null;
    if (!doc) return 0;
    const value = leg.field
      .split(".")
      .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], doc);
    return typeof value === "number" ? value : 0;
  } catch {
    return 0;
  }
}

/** Post-commit best-effort side effects shared by fresh settle and recovery. */
async function runTradePostCommit(db: Db, plan: PublicShareTradePlan): Promise<void> {
  void emitTradeTxBestEffort(db, plan);
  if (plan.spread && !plan.spreadDistributed) {
    try {
      await safeDistributeConversionSpread(
        db,
        plan.spread.fee,
        plan.spread.from as CurrencyCode,
        plan.spread.to as CurrencyCode
      );
    } catch {
      // Terminal by construction; never fail the trade.
    }
    try {
      await receiptsEx(db).updateOne(
        { _id: plan.tradeKey },
        { $set: { "publicShareTradePlan.spreadDistributed": true, updatedAt: new Date() } }
      );
    } catch {
      // Flag write is best effort; the spread itself is terminal.
    }
  }
  if (plan.kind === "market-sell" && plan.dealer) {
    const corpId = new ObjectId(plan.corpIdHex);
    const amountLocal = Math.abs(
      plan.dealer.kind === "escrow-split"
        ? (plan.dealer.escrowPart ?? 0) + (plan.dealer.treasuryPart ?? 0)
        : plan.dealer.amountLocal
    );
    void onFloatSellCommitted(db, { _id: corpId } as { _id: ObjectId }, amountLocal);
  }
  if (plan.closeTenureHolderIdHex) {
    try {
      await db
        .collection("corporationCeoVotes")
        .deleteMany({ corporationId: new ObjectId(plan.corpIdHex) });
    } catch {
      // Best effort; the tenure close below is the record of truth.
    }
    try {
      await closeCeoTenure(db, new ObjectId(plan.corpIdHex), {
        holderId: new ObjectId(plan.closeTenureHolderIdHex),
        turn: plan.turn,
      });
    } catch {
      // Best effort; never fail the committed sell.
    }
  }
}

function fireTradeAudit(plan: PublicShareTradePlan): void {
  if (!plan.audit) return;
  recordAudit({
    source: "api",
    action: "share.sell",
    category: "market",
    subject: {
      type: "corporation",
      id: new ObjectId(plan.corpIdHex),
      name: plan.corpName,
    },
    counterparty: {
      type: plan.audit.counterpartyType,
      id: new ObjectId(plan.audit.counterpartyIdHex),
      name: plan.audit.counterpartyName,
    },
    amount: plan.audit.amount,
    currencyCode: plan.audit.currencyCode,
    refs: { corporationId: new ObjectId(plan.corpIdHex) },
    delta: [
      { field: "status", before: null, after: "filled" },
      { field: "shares", before: null, after: plan.audit.shares },
      { field: "pricePerShare", before: null, after: plan.audit.pricePerShare },
    ],
    outcome: "ok",
  });
}

/**
 * Execute one float trade to exactly one terminal state. The plan is already
 * fully pinned by the caller (the route); this claims the receipt, stores
 * the plan, runs the steps, and returns the legacy response body. Throws
 * MoneyFlowKeyConflictError / MoneyFlowTerminalError from the claim for the
 * route to map to 409.
 */
export async function executePublicShareTradeFlow(
  db: Db,
  plan: PublicShareTradePlan,
  opts: { idempotencyKey?: string } = {}
): Promise<PublicShareTradeResult> {
  const tradeKey = opts.idempotencyKey ?? randomUUID();
  if (tradeKey !== plan.tradeKey) {
    throw new Error("public-share-trade:key-mismatch");
  }
  const fingerprint = buildPublicShareTradeFingerprint(plan);
  const claim = await claimMoneyFlowReceipt(receipts(db), tradeKey, fingerprint);
  if (claim === "duplicate") {
    const stored = await receiptsEx(db).findOne({ _id: tradeKey });
    if (stored?.publicShareTradeResponse && typeof stored.publicShareTradeResponse === "object") {
      return {
        ok: true,
        body: stored.publicShareTradeResponse as Record<string, unknown>,
        replayed: true,
      };
    }
    const storedPlan = stored?.publicShareTradePlan;
    if (isPublicShareTradePlan(storedPlan)) {
      return { ok: true, body: storedPlan.response, replayed: true };
    }
    return { ok: true, body: plan.response, replayed: true };
  }
  if (claim === "in-progress") {
    return recoverPublicShareTradeByKey(db, tradeKey);
  }

  try {
    await receiptsEx(db).updateOne(
      { _id: tradeKey },
      { $set: { publicShareTradePlan: { ...plan }, updatedAt: new Date() } }
    );
  } catch (planError) {
    await failMoneyFlowReceipt(receipts(db), tradeKey, "public-share-trade:plan-store");
    throw planError;
  }

  try {
    await runMoneyFlowSteps(
      receipts(db),
      tradeKey,
      buildPublicShareTradeSteps(db, plan),
      mapTradeError(plan)
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PUBLIC_SHARE_TRADE:")) {
      const mapped = tradeErrorOf(error);
      return { ok: false, error: mapped.error, status: mapped.status };
    }
    throw error;
  }
  await runTradePostCommit(db, plan);
  fireTradeAudit(plan);
  await receiptsEx(db).updateOne(
    { _id: tradeKey },
    { $set: { publicShareTradeResponse: { ...plan.response }, updatedAt: new Date() } }
  );
  return { ok: true, body: plan.response, replayed: false };
}

/**
 * Route-facing key lookup: when the client passed an explicit
 * `Idempotency-Key` with a receipt already on file, the first attempt
 * already validated, so the retry reconciles through the keyed steps
 * instead of re-running the route guards (which post-debit reads would
 * fail). Returns null when no receipt exists and the route must validate
 * fresh.
 */
export async function getStoredPublicShareTradeResponse(
  db: Db,
  tradeKey: string
): Promise<{ settled: boolean } | null> {
  const receipt = await receiptsEx(db).findOne({ _id: tradeKey });
  if (!receipt) return null;
  return { settled: receipt.status !== "in_progress" };
}

async function runStoredTradePlan(
  db: Db,
  tradeKey: string,
  plan: PublicShareTradePlan
): Promise<PublicShareTradeResult> {
  try {
    await runMoneyFlowSteps(
      receipts(db),
      tradeKey,
      buildPublicShareTradeSteps(db, plan),
      mapTradeError(plan)
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PUBLIC_SHARE_TRADE:")) {
      const mapped = tradeErrorOf(error);
      return { ok: false, error: mapped.error, status: mapped.status };
    }
    return { ok: false, error: "Failed to record trade", status: 500 };
  }
  await runTradePostCommit(db, plan);
  return { ok: true, body: plan.response, replayed: true };
}

/**
 * Crash recovery for one trade receipt, from only the flow key: replays the
 * stored plan to convergence. A plan-less receipt settled here as `failed`
 * is truthful because the plan store precedes the first step, so a missing
 * plan means no step ever ran and nothing moved.
 */
export async function recoverPublicShareTradeReceipt(
  db: Db,
  tradeKey: string
): Promise<PublicShareTradeRecoveryResult> {
  const receipt = await receiptsEx(db).findOne({ _id: tradeKey });
  if (!receipt) return { tradeKey, action: "skipped-missing" };
  if (receipt.status !== "in_progress") return { tradeKey, action: "skipped-settled" };
  const stored = receipt.publicShareTradePlan;
  if (!isPublicShareTradePlan(stored)) {
    await failMoneyFlowReceipt(receipts(db), tradeKey, "public-share-trade:plan-never-stored");
    return { tradeKey, action: "settled-failed-no-plan" };
  }
  const result = await runStoredTradePlan(db, tradeKey, stored);
  return {
    tradeKey,
    action: result.ok ? "trade-recovered" : "trade-incomplete",
  };
}

/**
 * Route- and caller-facing recovery: maps the receipt action onto the
 * legacy trade surface. Same-key retries converge here instead of
 * double-trading.
 */
export async function recoverPublicShareTradeByKey(
  db: Db,
  tradeKey: string
): Promise<PublicShareTradeResult> {
  const receipt = await receiptsEx(db).findOne({ _id: tradeKey });
  if (!receipt)
    return { ok: false, error: "Trade did not complete; retry with a new key", status: 500 };
  if (receipt.status === "completed") {
    if (receipt.publicShareTradeResponse && typeof receipt.publicShareTradeResponse === "object") {
      return {
        ok: true,
        body: receipt.publicShareTradeResponse as Record<string, unknown>,
        replayed: true,
      };
    }
    const stored = receipt.publicShareTradePlan;
    if (isPublicShareTradePlan(stored)) {
      return { ok: true, body: stored.response, replayed: true };
    }
    return { ok: false, error: "Trade did not complete; retry with a new key", status: 500 };
  }
  if (receipt.status !== "in_progress") {
    throw new MoneyFlowTerminalError(tradeKey, receipt.status, receipt.error);
  }
  const result = await recoverPublicShareTradeReceipt(db, tradeKey);
  switch (result.action) {
    case "trade-recovered":
    case "skipped-settled": {
      const settled = await receiptsEx(db).findOne({ _id: tradeKey });
      if (
        settled?.publicShareTradeResponse &&
        typeof settled.publicShareTradeResponse === "object"
      ) {
        return {
          ok: true,
          body: settled.publicShareTradeResponse as Record<string, unknown>,
          replayed: true,
        };
      }
      const stored = settled?.publicShareTradePlan;
      if (isPublicShareTradePlan(stored)) {
        return { ok: true, body: stored.response, replayed: true };
      }
      return { ok: false, error: "Failed to record trade", status: 500 };
    }
    case "settled-failed-no-plan":
      return { ok: false, error: "Trade did not complete; retry with a new key", status: 500 };
    case "skipped-missing":
      return { ok: false, error: "Trade did not complete; retry with a new key", status: 500 };
    case "trade-incomplete": {
      const current = await receiptsEx(db).findOne({ _id: tradeKey });
      return { ok: false, error: current?.error ?? "Failed to record trade", status: 500 };
    }
  }
}

export type PublicShareTradeRecoveryAction =
  | "trade-recovered"
  | "trade-incomplete"
  | "settled-failed-no-plan"
  | "skipped-settled"
  | "skipped-missing";

export interface PublicShareTradeRecoveryResult {
  tradeKey: string;
  action: PublicShareTradeRecoveryAction;
}

/**
 * Bounded trade orphan scan for the periodic driver. Recovers every
 * `in_progress` trade receipt from its stored plan; plan-less receipts
 * settle `failed` (the plan store precedes the first step, so nothing
 * moved). Foreign-domain receipts stay out via the fingerprint prefix.
 */
export async function recoverPublicShareTradeOrphans(
  db: Db,
  limit = 50
): Promise<PublicShareTradeRecoveryResult[]> {
  const stuck = await receiptsEx(db)
    .find({ status: "in_progress", publicShareTradePlan: { $exists: true } })
    .limit(limit)
    .toArray();
  const results: PublicShareTradeRecoveryResult[] = [];
  for (const receipt of stuck) {
    const stored = receipt.publicShareTradePlan;
    if (!isPublicShareTradePlan(stored)) {
      await failMoneyFlowReceipt(receipts(db), receipt._id, "public-share-trade:plan-never-stored");
      results.push({ tradeKey: receipt._id, action: "settled-failed-no-plan" });
      continue;
    }
    const result = await runStoredTradePlan(db, receipt._id, stored);
    results.push({
      tradeKey: receipt._id,
      action: result.ok ? "trade-recovered" : "trade-incomplete",
    });
  }
  if (results.length >= limit) return results;
  const planless = await receiptsEx(db)
    .find({ status: "in_progress", publicShareTradePlan: { $exists: false } })
    .limit(limit - results.length)
    .toArray();
  for (const receipt of planless) {
    if (typeof receipt._id !== "string") continue;
    if (
      typeof receipt.fingerprint !== "string" ||
      !receipt.fingerprint.startsWith(PUBLIC_SHARE_TRADE_FINGERPRINT_DOMAIN)
    ) {
      continue;
    }
    await failMoneyFlowReceipt(receipts(db), receipt._id, "public-share-trade:plan-never-stored");
    results.push({ tradeKey: receipt._id, action: "settled-failed-no-plan" });
  }
  return results;
}

/**
 * Order-book fills have no keyed steps of their own, so an explicit-key
 * request that fills through the order book stores its response as a
 * completed receipt here. A same-key retry replays the stored body instead
 * of filling (and selling) twice. The fingerprint pins the actual fill so a
 * key reused for a different fill fails closed on the next claim.
 */
export async function recordCompletedTradeResponse(
  db: Db,
  tradeKey: string,
  fingerprint: string,
  body: Record<string, unknown>
): Promise<{ replayed: boolean; body: Record<string, unknown> }> {
  const now = new Date();
  try {
    await receipts(db).insertOne({
      _id: tradeKey,
      status: "completed",
      fingerprint,
      createdAt: now,
      updatedAt: now,
      publicShareTradeResponse: { ...body },
    } as MoneyFlowReceipt);
    return { replayed: false, body };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  const stored = await receiptsEx(db).findOne({ _id: tradeKey });
  if (stored && stored.fingerprint !== fingerprint) {
    throw new MoneyFlowKeyConflictError(tradeKey);
  }
  if (stored?.publicShareTradeResponse && typeof stored.publicShareTradeResponse === "object") {
    return {
      replayed: true,
      body: stored.publicShareTradeResponse as Record<string, unknown>,
    };
  }
  const storedPlan = stored?.publicShareTradePlan;
  if (isPublicShareTradePlan(storedPlan)) {
    return { replayed: true, body: storedPlan.response };
  }
  return { replayed: true, body };
}

function isDuplicateKeyError(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: unknown }).code === 11000;
}

/** Deterministic fingerprint for an order-book fill stored under an explicit key. */
export function buildOrderBookFillFingerprint(input: {
  corpId: ObjectId;
  sellerId: ObjectId;
  shares: number;
  pricePerShareLocal: number;
  proceedsAnchor: number;
}): string {
  const cents = (n: number): string => String(Math.round(n * 100) / 100);
  return [
    PUBLIC_SHARE_TRADE_FINGERPRINT_DOMAIN,
    "order-book-fill",
    input.corpId.toHexString(),
    input.sellerId.toHexString(),
    `shares:${input.shares}`,
    `price:${cents(input.pricePerShareLocal)}`,
    `proceeds:${cents(input.proceedsAnchor)}`,
  ].join(":");
}
