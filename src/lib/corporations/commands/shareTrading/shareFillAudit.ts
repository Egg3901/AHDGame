import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { ObjectId, type Collection, type Db } from "mongodb";
import {
  claimMoneyFlowReceipt,
  failMoneyFlowReceipt,
  keyedInsertId,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
  type MoneyFlowReceipt,
} from "@/lib/db/nonAtomicMoneyFlow";
import { emitTx, type EmitTxOutcome, type TxInput } from "@/lib/financialTxLog/emit";
import {
  recordShareTrade,
  type RecordShareTradeInput,
  type RecordShareTradeOutcome,
} from "@/lib/corporations/shareTradeHistory";
import { FUND_TRANSACTION_COLLECTION } from "@/lib/indexFunds/fundQueries";
import type { IndexFundTransaction } from "@/lib/db/types";
import type { ShareOrder } from "@/lib/db/types/corporation";
import type { ShareTradeParty } from "@/lib/db/types/shareTradeHistory";
import type { CurrencyCode } from "@/lib/constants/currencies";

/**
 * Durable audit for peer order-book fills (issue #1672).
 *
 * The fill money path keeps its legacy compensation. This module owns the
 * audit side that the compensation cannot cover: every fill attempt mints one
 * key, stamps it on the order inside the atomic claim write, and persists a
 * resume plan on a money-flow receipt before money moves. All audit rows
 * (financial-tx log, fund-transaction row, trade-history row) then insert
 * under deterministic `_id`s derived from the attempt key, so a crash
 * between money and audit is repaired by convergent re-insertion instead of
 * leaving missing audit, and a retry never duplicates rows.
 *
 * Recovery is audit-only and never re-runs money: it inserts planned rows
 * only after the receipt records `moneyCommitted`. Anything earlier (claim
 * never landed, or landed but money unproven) settles `failed` or stays
 * `in_progress` (TTL-visible) for ops instead of guessing.
 */

/** Deterministic-insert domains for one fill attempt's audit rows. */
export const SHARE_FILL_TX_BUY_DOMAIN = "share-fill-tx-buy";
export const SHARE_FILL_TX_SELL_DOMAIN = "share-fill-tx-sell";
export const SHARE_FILL_FUND_TX_DOMAIN = "share-fill-fund-tx";
export const SHARE_FILL_HISTORY_DOMAIN = "share-fill-history";

export type ShareFillPlacerKind = "character" | "corporation" | "fund";

export type ShareFillFillerCollection = "characters" | "imperialCharacters" | "corporations";

/**
 * Resume plan persisted on the receipt before money moves. Every amount and
 * display name is pinned here at claim time, so recovery rebuilds the exact
 * rows the first attempt owed without re-reading post-fill state. Post-money
 * values that only exist after the debit (`fillerBalanceAfter`) are pinned by
 * `markShareFillMoneyCommitted` in the same write that records the commit.
 */
export interface ShareFillAuditPlan {
  version: 1;
  orderIdHex: string;
  corpIdHex: string;
  corpCcy?: string;
  orderType: "buy" | "sell";
  shares: number;
  pricePerShare: number;
  /** Share value in anchor (total in the corp liquid currency converted). */
  totalAnchor: number;
  turn: number;
  nowIso: string;
  preClaimRemaining: number;
  filler: {
    idHex: string;
    collection: ShareFillFillerCollection;
    name: string;
    homeCurrency: CurrencyCode;
    imperial: boolean;
  };
  /** Filler-side proceeds/cost in the filler's own currency units. */
  fillerAmount: number;
  fillerBalanceAfter?: number;
  placerKind: ShareFillPlacerKind;
  placerIdHex?: string;
  placerName: string;
  /** Seller proceeds (sell fills against a character/corporation placer). */
  sellerAmount?: number;
  sellerCurrency?: CurrencyCode;
  /** Sell fills against a fund placer own a fund-transaction row, no seller tx. */
  fundTx: boolean;
  moneyCommitted: boolean;
}

export type ShareFillReceipt = MoneyFlowReceipt & { shareFillPlan?: ShareFillAuditPlan };

function receipts(db: Db): Collection<MoneyFlowReceipt> {
  return db.collection<MoneyFlowReceipt>(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION);
}

function receiptsEx(db: Db): Collection<ShareFillReceipt> {
  return db.collection<ShareFillReceipt>(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION);
}

export function isShareFillAuditPlan(value: unknown): value is ShareFillAuditPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    plan.version === 1 &&
    typeof plan.orderIdHex === "string" &&
    typeof plan.corpIdHex === "string" &&
    (plan.orderType === "buy" || plan.orderType === "sell") &&
    typeof plan.shares === "number" &&
    typeof plan.totalAnchor === "number" &&
    typeof plan.preClaimRemaining === "number" &&
    typeof plan.fundTx === "boolean" &&
    typeof plan.moneyCommitted === "boolean" &&
    !!plan.filler &&
    typeof plan.turn === "number" &&
    typeof plan.nowIso === "string"
  );
}

/** Stable fingerprint for an attempt: same key + different params fails closed. */
export function buildShareFillFingerprint(input: {
  orderId: ObjectId;
  fillerId: ObjectId;
  shares: number;
  pricePerShare: number;
}): string {
  return [
    "share-fill",
    input.orderId.toHexString(),
    input.fillerId.toHexString(),
    `shares:${input.shares}`,
    `price:${Math.round(input.pricePerShare * 100) / 100}`,
  ].join(":");
}

/** Claim filter shared by both fill paths: open order with enough remaining. */
export function buildShareFillClaimFilter(
  orderId: ObjectId,
  shares: number
): {
  _id: ObjectId;
  status: "open";
  sharesRemaining: { $gte: number };
} {
  return { _id: orderId, status: "open", sharesRemaining: { $gte: shares } };
}

/**
 * Route-path claim pipeline. Byte-identical escrow math to the legacy claim,
 * except the status is conditional: a partial fill stays `open`, so a crash
 * can never strand the order as `filled` with shares still remaining (the
 * turn matcher in fillBestBuyOrder already claims this way). The attempt key
 * lands in the same atomic write, so recovery can always find the plan.
 */
export function buildShareFillRouteClaimPipeline(args: {
  shares: number;
  fillKey: string;
  now: Date;
}): Record<string, unknown>[] {
  const { shares, fillKey, now } = args;
  return [
    {
      $set: {
        sharesRemaining: { $subtract: ["$sharesRemaining", shares] },
        escrowAmount: {
          $cond: [
            { $eq: ["$type", "buy"] },
            { $multiply: [{ $subtract: ["$sharesRemaining", shares] }, "$pricePerShare"] },
            "$escrowAmount",
          ],
        },
        escrowAnchor: {
          $cond: [
            {
              $and: [
                { $eq: ["$type", "buy"] },
                { $gt: ["$sharesRemaining", 0] },
                { $gt: [{ $ifNull: ["$escrowAnchor", 0] }, 0] },
              ],
            },
            {
              $multiply: [
                "$escrowAnchor",
                { $divide: [{ $subtract: ["$sharesRemaining", shares] }, "$sharesRemaining"] },
              ],
            },
            "$escrowAnchor",
          ],
        },
        status: {
          $cond: [{ $eq: [{ $subtract: ["$sharesRemaining", shares] }, 0] }, "filled", "open"],
        },
        lastShareFillKey: fillKey,
        updatedAt: now,
      },
    },
  ];
}

/**
 * Turn-path claim update. Mirrors the fillBestBuyOrder claim fields plus the
 * attempt-key stamp, so market-sell fills recover the same way route fills do.
 */
export function buildShareFillTurnClaimUpdate(args: {
  remainingShares: number;
  remainingEscrowLocal: number;
  remainingEscrowAnchor: number;
  status: "filled" | "open";
  fillKey: string;
  now: Date;
}): { $set: Record<string, unknown> } {
  return {
    $set: {
      sharesRemaining: args.remainingShares,
      escrowAmount: args.remainingEscrowLocal,
      escrowAnchor: args.remainingEscrowAnchor,
      status: args.status,
      lastShareFillKey: args.fillKey,
      updatedAt: args.now,
    },
  };
}

function fillerParty(plan: ShareFillAuditPlan): ShareTradeParty {
  const id = new ObjectId(plan.filler.idHex);
  if (plan.filler.collection === "corporations") {
    return { corporationId: id, name: plan.filler.name };
  }
  return plan.filler.imperial
    ? { imperialCharacterId: id, name: plan.filler.name }
    : { characterId: id, name: plan.filler.name };
}

function placerParty(plan: ShareFillAuditPlan): ShareTradeParty {
  if (plan.placerKind === "fund") return { name: plan.placerName };
  const id = new ObjectId(plan.placerIdHex!);
  if (plan.placerKind === "corporation") {
    return { corporationId: id, name: plan.placerName };
  }
  return { characterId: id, name: plan.placerName };
}

function counterpartyType(kind: ShareFillPlacerKind | "filler-corp" | "filler-char"): string {
  if (kind === "corporation" || kind === "filler-corp") return "corporation";
  if (kind === "fund") return "system";
  return "character";
}

function txMeta(plan: ShareFillAuditPlan): Record<string, unknown> {
  return {
    corporationId: plan.corpIdHex,
    orderId: plan.orderIdHex,
    shares: plan.shares,
    pricePerShare: plan.pricePerShare,
    source: plan.orderType === "sell" ? "order_fill_sell_order" : "order_fill_buy_order",
    imperial: plan.filler.imperial || undefined,
  };
}

/** One fill attempt's full audit set, rebuilt identically on first attempt and recovery. */
export interface ShareFillAuditRows {
  txs: TxInput[];
  txDomains: string[];
  fundTx: Omit<IndexFundTransaction, "_id"> | null;
  history: RecordShareTradeInput;
}

export function collectShareFillAuditRows(plan: ShareFillAuditPlan): ShareFillAuditRows {
  const createdAt = new Date(plan.nowIso);
  const txs: TxInput[] = [];
  const txDomains: string[] = [];
  const fillerIsCorp = plan.filler.collection === "corporations";
  const fillerSubjectType = fillerIsCorp ? "corporation" : "character";
  const fillerCounterpartyKind = fillerIsCorp ? "filler-corp" : "filler-char";

  if (plan.orderType === "sell") {
    if (plan.placerKind !== "fund") {
      txs.push({
        type: "stock_trade_sell",
        turn: plan.turn,
        createdAt,
        subjectType: plan.placerKind === "corporation" ? "corporation" : "character",
        subjectId: new ObjectId(plan.placerIdHex!),
        subjectName: plan.placerName,
        amount: plan.sellerAmount!,
        currencyCode: plan.sellerCurrency!,
        counterpartyType: counterpartyType(fillerCounterpartyKind) as TxInput["counterpartyType"],
        counterpartyId: new ObjectId(plan.filler.idHex),
        counterpartyName: plan.filler.name,
        meta: txMeta(plan),
      });
      txDomains.push(SHARE_FILL_TX_SELL_DOMAIN);
    }
    txs.push({
      type: "stock_trade_buy",
      turn: plan.turn,
      createdAt,
      subjectType: fillerSubjectType as TxInput["subjectType"],
      subjectId: new ObjectId(plan.filler.idHex),
      subjectName: plan.filler.name,
      amount: -plan.fillerAmount,
      balanceAfter: plan.fillerBalanceAfter,
      currencyCode: plan.filler.homeCurrency,
      counterpartyType: counterpartyType(plan.placerKind) as TxInput["counterpartyType"],
      counterpartyId: plan.placerKind === "fund" ? undefined : new ObjectId(plan.placerIdHex!),
      counterpartyName: plan.placerName,
      meta: txMeta(plan),
    });
    txDomains.push(SHARE_FILL_TX_BUY_DOMAIN);
  } else {
    txs.push({
      type: "stock_trade_sell",
      turn: plan.turn,
      createdAt,
      subjectType: fillerSubjectType as TxInput["subjectType"],
      subjectId: new ObjectId(plan.filler.idHex),
      subjectName: plan.filler.name,
      amount: plan.fillerAmount,
      currencyCode: plan.filler.homeCurrency,
      counterpartyType: counterpartyType(plan.placerKind) as TxInput["counterpartyType"],
      counterpartyId: plan.placerKind === "fund" ? undefined : new ObjectId(plan.placerIdHex!),
      counterpartyName: plan.placerName,
      meta: txMeta(plan),
    });
    txDomains.push(SHARE_FILL_TX_SELL_DOMAIN);
  }

  const fundTx: Omit<IndexFundTransaction, "_id"> | null =
    plan.orderType === "sell" && plan.fundTx
      ? {
          fundId: new ObjectId(plan.placerIdHex!),
          kind: "liquidity_quote_sell",
          corporationId: new ObjectId(plan.corpIdHex),
          shares: plan.shares,
          amountAnchor: plan.totalAnchor,
          note: "Executable equity liquidity ask filled",
          createdAt,
        }
      : null;

  const from = plan.orderType === "sell" ? placerParty(plan) : fillerParty(plan);
  const to = plan.orderType === "sell" ? fillerParty(plan) : placerParty(plan);
  const history: RecordShareTradeInput = {
    corporationId: new ObjectId(plan.corpIdHex),
    kind: "peer_fill",
    turn: plan.turn,
    shares: plan.shares,
    pricePerShareAnchor: plan.totalAnchor / plan.shares,
    from,
    to,
    ...(plan.corpCcy ? { corpCurrencyCode: plan.corpCcy as CurrencyCode } : {}),
    createdAt,
  };

  return { txs, txDomains, fundTx, history };
}

/**
 * Mint an attempt key, claim its receipt, and persist the resume plan before
 * the order claim runs. A crash from here on is recoverable under the
 * returned key. A plan-store failure settles the receipt `failed` (nothing
 * applied yet, so that verdict is truthful) and throws.
 */
export async function beginShareFillAttempt(
  db: Db,
  plan: ShareFillAuditPlan,
  fingerprint: string
): Promise<string> {
  const key = randomUUID();
  const claim = await claimMoneyFlowReceipt(receipts(db), key, fingerprint);
  if (claim !== "fresh") {
    throw new Error("SHARE_FILL_KEY_COLLISION");
  }
  try {
    await receiptsEx(db).updateOne(
      { _id: key },
      { $set: { shareFillPlan: plan, updatedAt: new Date() } }
    );
  } catch (planError) {
    await failMoneyFlowReceipt(receipts(db), key, "share-fill:plan-store");
    throw planError;
  }
  return key;
}

/**
 * Record the money commit on the receipt, pinning post-debit values the
 * recovery rebuild needs (filler balance-after). Runs after the last money
 * write and before the first audit insert: only rows committed here may be
 * recovered, so recovery can never fabricate audit for unmoved money.
 */
export async function markShareFillMoneyCommitted(
  db: Db,
  key: string,
  fillerBalanceAfter?: number
): Promise<void> {
  const set: Record<string, unknown> = {
    "shareFillPlan.moneyCommitted": true,
    updatedAt: new Date(),
  };
  if (fillerBalanceAfter !== undefined) {
    set["shareFillPlan.fillerBalanceAfter"] = fillerBalanceAfter;
  }
  await receiptsEx(db).updateOne({ _id: key }, { $set: set });
}

export async function settleShareFillAttempt(
  db: Db,
  key: string,
  status: "completed" | "failed",
  error?: string
): Promise<void> {
  await receipts(db).updateOne(
    { _id: key },
    {
      $set: {
        status,
        updatedAt: new Date(),
        ...(error !== undefined ? { error } : {}),
      },
    }
  );
}

export type ShareFillAuditOutcome = "applied" | "already-applied" | "failed";

function isDuplicateKeyError(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: unknown }).code === 11000;
}

function foldOutcome(
  current: ShareFillAuditOutcome,
  next: EmitTxOutcome | RecordShareTradeOutcome
): ShareFillAuditOutcome {
  // Any failure dominates: the receipt stays `in_progress` for another pass.
  // Otherwise a freshly inserted row dominates a duplicate: recovery that
  // lands even one missing row reports `applied` (`audit-recovered`), and
  // only a pass where every row already existed reports `already-applied`.
  if (next === "failed" || current === "failed") return "failed";
  if (next === "applied" || current === "applied") return "applied";
  return "already-applied";
}

/**
 * Insert one attempt's audit rows convergently. Duplicate `_id`s converge to
 * `already-applied`; any other failure is Sentry-logged and reported as
 * `failed` without throwing, so callers leave the receipt `in_progress` for
 * recovery instead of rolling back moved money over a missing audit row.
 */
export async function insertShareFillAuditRows(
  db: Db,
  key: string,
  rows: ShareFillAuditRows
): Promise<ShareFillAuditOutcome> {
  let outcome: ShareFillAuditOutcome = "already-applied";
  for (let index = 0; index < rows.txs.length; index += 1) {
    outcome = foldOutcome(
      outcome,
      await emitTx(db, rows.txs[index]!, undefined, {
        _id: keyedInsertId(key, rows.txDomains[index]!),
      })
    );
  }
  if (rows.fundTx) {
    try {
      await db
        .collection<IndexFundTransaction>(FUND_TRANSACTION_COLLECTION)
        .insertOne({ ...rows.fundTx, _id: keyedInsertId(key, SHARE_FILL_FUND_TX_DOMAIN) });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        outcome = foldOutcome(outcome, "already-applied");
      } else {
        Sentry.captureException(err, { tags: { module: "shareFillAudit" } });
        outcome = foldOutcome(outcome, "failed");
      }
    }
  }
  outcome = foldOutcome(
    outcome,
    await recordShareTrade(db, rows.history, {
      _id: keyedInsertId(key, SHARE_FILL_HISTORY_DOMAIN),
    })
  );
  return outcome;
}

export type ShareFillRecoveryAction =
  | "settled-failed-claim-never-landed"
  | "settled-failed-no-plan"
  | "settled-failed-order-missing"
  | "audit-recovered"
  | "audit-already-complete"
  | "audit-incomplete"
  | "left-in-progress-uncommitted"
  | "skipped-settled"
  | "skipped-missing";

export interface ShareFillRecoveryResult {
  key: string;
  action: ShareFillRecoveryAction;
}

/**
 * Audit-only crash recovery for one attempt. Reads the receipt plan and the
 * live order, then: settle `failed` when the claim provably never landed
 * (remaining untouched) or the plan/order is gone; convergent-insert the
 * planned rows and settle `completed` when money committed; otherwise touch
 * nothing and stay `in_progress` (mid-money prefixes are the keyed-money
 * seam, never guessed at here).
 */
export async function recoverShareFillAttempt(
  db: Db,
  key: string
): Promise<ShareFillRecoveryResult> {
  const receipt = await receiptsEx(db).findOne({ _id: key });
  if (!receipt) return { key, action: "skipped-missing" };
  if (receipt.status !== "in_progress") return { key, action: "skipped-settled" };
  const plan = isShareFillAuditPlan(receipt.shareFillPlan) ? receipt.shareFillPlan : undefined;
  if (!plan) {
    await settleShareFillAttempt(db, key, "failed", "share-fill:plan-never-stored");
    return { key, action: "settled-failed-no-plan" };
  }
  const order = await db
    .collection<ShareOrder>("shareOrders")
    .findOne({ _id: new ObjectId(plan.orderIdHex) });
  if (!order) {
    await settleShareFillAttempt(db, key, "failed", "share-fill:order-missing");
    return { key, action: "settled-failed-order-missing" };
  }
  if (order.sharesRemaining === plan.preClaimRemaining) {
    await settleShareFillAttempt(db, key, "failed", "share-fill:claim-never-landed");
    return { key, action: "settled-failed-claim-never-landed" };
  }
  if (!plan.moneyCommitted) return { key, action: "left-in-progress-uncommitted" };
  const outcome = await insertShareFillAuditRows(db, key, collectShareFillAuditRows(plan));
  if (outcome === "failed") return { key, action: "audit-incomplete" };
  await settleShareFillAttempt(db, key, "completed");
  return { key, action: outcome === "applied" ? "audit-recovered" : "audit-already-complete" };
}

/**
 * Repair the legacy stranded claim: the old route claim set `filled`
 * optimistically and flipped back to `open` after settlement, so a crash in
 * between leaves a fillable order stuck. Only that path can produce
 * `filled` with shares remaining (full-fill crashes rest at zero, the turn
 * matcher claims conditionally), so reopening is safe: the remaining shares
 * are still the seller's either way.
 */
export async function repairStrandedShareFillClaim(db: Db, order: ShareOrder): Promise<boolean> {
  if (order.status !== "filled" || order.sharesRemaining <= 0) return false;
  await db
    .collection<ShareOrder>("shareOrders")
    .updateOne({ _id: order._id }, { $set: { status: "open", updatedAt: new Date() } });
  return true;
}

/**
 * Pre-claim hook both fill paths run after loading the order: repair a
 * stranded legacy claim, then recover the stamped prior attempt's audit.
 * Returns the order to validate against (status possibly repaired to open).
 */
export async function prepareShareFillClaim(
  db: Db,
  order: ShareOrder
): Promise<{
  order: ShareOrder;
  repaired: boolean;
  recovery: ShareFillRecoveryResult | null;
}> {
  let current = order;
  let repaired = false;
  if (await repairStrandedShareFillClaim(db, current)) {
    current = { ...current, status: "open" };
    repaired = true;
  }
  let recovery: ShareFillRecoveryResult | null = null;
  if (current.lastShareFillKey) {
    recovery = await recoverShareFillAttempt(db, current.lastShareFillKey);
  }
  return { order: current, repaired, recovery };
}

/**
 * Bounded orphan scan for wiring by a periodic driver (no fill path owns a
 * pass over all orders). The per-order stamp hook covers any order that sees
 * another fill; this covers lonely orders whose receipt outlives them.
 *
 * Plan-less receipts (claim insert landed, plan store never did, so the
 * order claim never ran) settle `failed` in the second pass via
 * `recoverShareFillAttempt`: otherwise they stay `in_progress` forever,
 * since no order ever stamps a key whose plan never landed. Failing is
 * truthful because `beginShareFillAttempt` persists the plan before the
 * order claim runs. The fingerprint prefix keeps foreign-domain receipts
 * (including the `share-fill-money` money receipts) out.
 */
export async function recoverShareFillOrphans(
  db: Db,
  limit = 50
): Promise<ShareFillRecoveryResult[]> {
  const stuck = await receiptsEx(db)
    .find({ status: "in_progress", shareFillPlan: { $exists: true } })
    .limit(limit)
    .toArray();
  const results: ShareFillRecoveryResult[] = [];
  for (const receipt of stuck) {
    try {
      results.push(await recoverShareFillAttempt(db, receipt._id));
    } catch (err) {
      Sentry.captureException(err, { tags: { module: "shareFillAudit" } });
      results.push({ key: receipt._id, action: "left-in-progress-uncommitted" });
    }
  }
  if (results.length >= limit) return results;
  const planless = await receiptsEx(db)
    .find({ status: "in_progress", shareFillPlan: { $exists: false } })
    .limit(limit - results.length)
    .toArray();
  for (const receipt of planless) {
    if (typeof receipt._id !== "string") continue;
    if (typeof receipt.fingerprint !== "string" || !receipt.fingerprint.startsWith("share-fill:")) {
      continue;
    }
    try {
      results.push(await recoverShareFillAttempt(db, receipt._id));
    } catch (err) {
      Sentry.captureException(err, { tags: { module: "shareFillAudit" } });
      results.push({ key: receipt._id, action: "left-in-progress-uncommitted" });
    }
  }
  return results;
}
