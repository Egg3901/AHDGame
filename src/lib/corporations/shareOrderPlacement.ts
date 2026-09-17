import { randomUUID } from "node:crypto";
import { ObjectId, type Collection, type Db, type Filter } from "mongodb";
import {
  applyIdempotentLeg,
  claimMoneyFlowReceipt,
  deriveMoneyFlowKey,
  failMoneyFlowReceipt,
  insertKeyedDoc,
  keyedInsertId,
  makeLegStep,
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
import { EQUITY_MARKET_POOLS_COLLECTION } from "@/lib/db/types/equityMarketPool";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { ShareOrder } from "@/lib/db/types";
import { emitTx } from "@/lib/financialTxLog/emit";
import { buildShareTradeDoc, type ShareTradeParty } from "@/lib/corporations/shareTradeHistory";
import type { ShareTradeHistory } from "@/lib/db/types/shareTradeHistory";
import { safeDistributeConversionSpread } from "@/lib/currency/marketMaker";
import { onFloatSellCommitted } from "@/lib/corporations/shareEscrowSettlement";
import { recordAudit } from "@/lib/audit/recordAudit";

/**
 * Keyed order-placement escrow (issue #1672).
 *
 * `placeShareOrder` ran every placement debit-first with manual compensation:
 * a crash between the escrow debit and the order insert left the buyer down
 * with no order (the cancel path then no-ops on the missing order, stranding
 * cash until an admin intervenes), a crash between the share reserve and the
 * sell-order insert stranded shares the same way, and every immediate fill
 * had debit-then-credit windows that stranded money or shares when the
 * process died mid-try. Concurrent placements could both pass stale checks
 * only where the atomic debit guards already prevented it, but the manual
 * catch blocks refunded with plain updates that raced keyed recovery.
 *
 * This module runs every placement as one keyed money flow, following the
 * share-fill money and order-refund conventions:
 *
 * - One receipt per placement attempt. The route forwards the client
 *   `Idempotency-Key` (minted when absent). Same-key retries converge on the
 *   stored plan and return the stored response; a key reused with a
 *   different fingerprint throws `MoneyFlowKeyConflictError` (fail closed);
 *   a key that settled without completing throws `MoneyFlowTerminalError`.
 * - The route pins every amount, currency field, dealer routing decision,
 *   and escrow split BEFORE the flow starts, and the flow stores that
 *   immutable plan on the receipt before the first step. Recovery replays
 *   the stored figures instead of repricing from post-debit state, so FX
 *   drift between attempt and retry cannot move money.
 * - Cash debits gate `$gte` + `$ne: key` in one atomic write (exactly the
 *   legacy `atomicallyDebit*` semantics), cap-table moves reuse the keyed
 *   cap debit/credit steps, the float/order-flow `$inc` is its own guarded
 *   step, and the pool/treasury/escrow dealer leg reuses the matcher leg
 *   shapes with one addition: the escrow-mode sell split runs as a single
 *   atomic pipeline update (the exact legacy floored expressions) plus the
 *   key record, so a crash cannot strand half the split.
 * - `runMoneyFlowSteps` reverses the applied prefix with keyed inverses
 *   before settling, so a placement ends `completed` or terminal without
 *   effect, never partial. Guard failures keep the legacy route surface
 *   (insufficient funds 400s, float/reserve 409s, dealer-depth 400s).
 * - The tx row is post-commit best effort with a deterministic `_id`
 *   (replays converge). The trade-history row is the terminal money step,
 *   also under a deterministic `_id`: a crash there stays `in_progress`
 *   and the retry converges instead of compensating the fill. The FX
 *   spread rides `safeDistributeConversionSpread` post-commit (the legacy
 *   placement kept the spread even when its own catch rolled the fill
 *   back, so the spread is terminal by construction);
 *   `onFloatSellCommitted` stays fire-and-forget; `recordAudit` fires only
 *   on the fresh attempt.
 *
 * Legacy economics and API behavior are preserved: identical debit/credit
 * math (including the corp-sell rounded-proceeds vs char-sell raw-proceeds
 * asymmetry and the pool cents rounding), identical response bodies and
 * status codes, identical error strings (pinned per guard at plan time),
 * identical tx/history shapes, and identical fill-vs-pending branch
 * conditions (the route still decides `immediate` exactly as before).
 *
 * Two deliberate deviations, both pathological-only: a pool credit against
 * a pool document deleted between quote and step throws (legacy would
 * upsert-recreate it), and a sell against a target corp deleted between
 * resolve and step throws `Target corporation not found` (legacy would
 * stagger into a 409). Neither is reachable without deleting live docs
 * mid-request.
 */

export const SHARE_ORDER_PLACEMENT_FINGERPRINT_DOMAIN = "share-order-placement";
export const SHARE_ORDER_PLACEMENT_ORDER_DOMAIN = "share-order-placement-order";
export const SHARE_ORDER_PLACEMENT_TX_DOMAIN = "share-order-placement-tx";
export const SHARE_ORDER_PLACEMENT_HISTORY_DOMAIN = "share-order-placement-history";

export type ShareOrderPlacementKind =
  "buy-immediate" | "buy-pending" | "sell-immediate" | "sell-pending";

export interface ShareOrderPlacementDealer {
  kind: "pool" | "treasury" | "escrow-credit" | "escrow-split";
  /** Pool currency for `pool`, unused otherwise. */
  currency?: CurrencyCode;
  /** Signed local-currency movement (buys +, sells -); pool legs round at apply. */
  amountLocal: number;
  /** Pool lifetime counter side. */
  flowKind?: "purchasesIn" | "salesOut";
  /** Pinned escrow-mode sell split (sums to amountLocal). */
  escrowPart?: number;
  treasuryPart?: number;
}

export interface ShareOrderPlacementTxPlan {
  type: "stock_order_escrow" | "stock_trade_buy" | "stock_trade_sell";
  subjectType: "character" | "corporation";
  subjectIdHex: string;
  subjectName: string;
  amount: number;
  /** Balance-after is informational: read live post-commit (see below). */
  includeBalanceAfter: boolean;
  currencyCode: string;
  counterpartyType: "system" | "corporation";
  counterpartyName: string;
  counterpartyIdHex?: string;
  meta: Record<string, unknown>;
}

export interface ShareOrderPlacementHistoryPlan {
  shares: number;
  pricePerShareAnchor: number;
  from: ShareTradeParty | null;
  to: ShareTradeParty | null;
  corpCurrencyCode?: string;
}

export interface ShareOrderPlacementAuditPlan {
  counterpartyType: "character" | "corporation";
  counterpartyIdHex: string;
  counterpartyName: string;
  amount?: number;
  currencyCode?: string;
  orderType: "buy" | "sell";
  status: "open" | "filled";
  shares: number;
  pricePerShare: number;
}

/**
 * Immutable resume plan pinned before the first step. Every remainder,
 * amount, currency field, party, routing decision, guard error string, and
 * response body is fixed here; recovery replays these figures.
 */
export interface ShareOrderPlacementPlan {
  version: 1;
  placementKey: string;
  orderIdHex: string;
  kind: ShareOrderPlacementKind;
  corpIdHex: string;
  corpName: string;
  shares: number;
  limitPrice: number;
  executionPrice: number;
  turn: number;
  nowIso: string;
  orderFlowEligible: boolean;
  placerKind: "character" | "corporation";
  placerIdHex: string;
  placerName: string;
  /** Authorizing character for corp-placed orders (order doc + audit). */
  characterIdHex: string;
  /** Buy debit (buyer cash or escrow). Null on sells. */
  debitLeg: ShareFillCashLeg | null;
  /** Sell proceeds credit. Null on buys. */
  proceedsLeg: ShareFillCashLeg | null;
  /** Seller cap-table debit (reserve on pending, sale debit on immediate). */
  capDebit: ShareFillCapLeg | null;
  /** Buyer cap-table credit (immediate buys). */
  capCredit: ShareFillCapLeg | null;
  /** Float delta on the target corp (immediate only). */
  floatDelta: number;
  /** Pool/treasury/escrow dealer movement (immediate only). */
  dealer: ShareOrderPlacementDealer | null;
  /** Pending-order doc (pending only; `_id` is the deterministic order id). */
  orderDoc: (Omit<ShareOrder, "_id"> & { _id: ObjectId }) | null;
  tx: ShareOrderPlacementTxPlan | null;
  history: ShareOrderPlacementHistoryPlan | null;
  spread: { fee: number; from: string; to: string } | null;
  audit: ShareOrderPlacementAuditPlan;
  /** Legacy guard error strings pinned per failure site. */
  errors: {
    debit: { message: string; status: number };
    float: { message: string; status: number };
    reserve: { message: string; status: number };
    dealer: { message: string; status: number };
  };
  /** Exact legacy response body, stored at settle for replays. */
  response: Record<string, unknown>;
  spreadDistributed?: boolean;
}

export function isShareOrderPlacementPlan(value: unknown): value is ShareOrderPlacementPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    plan.version === 1 &&
    typeof plan.placementKey === "string" &&
    typeof plan.orderIdHex === "string" &&
    typeof plan.corpIdHex === "string" &&
    typeof plan.kind === "string" &&
    typeof plan.response === "object"
  );
}

export function buildShareOrderPlacementFingerprint(plan: ShareOrderPlacementPlan): string {
  const cents = (n: number): string => String(Math.round(n * 100) / 100);
  const cash = (leg: ShareFillCashLeg | null): string =>
    leg ? `${leg.collection}:${leg.idHex}:${leg.field}:${cents(leg.amount)}` : "none";
  const cap = (leg: ShareFillCapLeg | null): string =>
    leg ? `${leg.field}:${leg.idHex}:${cents(leg.pricePerShare)}` : "none";
  return [
    SHARE_ORDER_PLACEMENT_FINGERPRINT_DOMAIN,
    plan.kind,
    plan.corpIdHex,
    `shares:${plan.shares}`,
    `limit:${cents(plan.limitPrice)}`,
    `exec:${cents(plan.executionPrice)}`,
    `placer:${plan.placerKind}:${plan.placerIdHex}`,
    `debit:${cash(plan.debitLeg)}`,
    `proceeds:${cash(plan.proceedsLeg)}`,
    `capDebit:${cap(plan.capDebit)}`,
    `capCredit:${cap(plan.capCredit)}`,
    `order:${plan.orderIdHex}`,
  ].join(":");
}

export type ShareOrderPlacementResult =
  | { ok: true; body: Record<string, unknown>; replayed: boolean }
  | { ok: false; error: string; status: number };

type ShareOrderPlacementReceipt = MoneyFlowReceipt & { shareOrderPlacementPlan?: unknown };

function receipts(db: Db): Collection<MoneyFlowReceipt> {
  return db.collection<MoneyFlowReceipt>(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION);
}

function receiptsEx(db: Db): Collection<ShareOrderPlacementReceipt> {
  return db.collection<ShareOrderPlacementReceipt>(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION);
}

function mapPlacementError(plan: ShareOrderPlacementPlan) {
  return (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error => {
    const tagged = (site: keyof ShareOrderPlacementPlan["errors"]): Error => {
      const pinned = plan.errors[site];
      return new Error(`SHARE_ORDER_PLACEMENT:${pinned.status}:${pinned.message}`);
    };
    if (step.name === "buyer-debit" || step.name === "escrow-debit") return tagged("debit");
    if (step.name === "float") return tagged("float");
    if (step.name === "reserve-debit" || step.name === "seller-debit") return tagged("reserve");
    if (step.name === "dealer") return tagged("dealer");
    if (step.name === "buyer-credit") return tagged("float");
    if (step.name === "proceeds-credit") {
      return new Error("SHARE_ORDER_PLACEMENT:500:Seller account is gone");
    }
    if (step.name === "order-insert") {
      return new Error("SHARE_ORDER_PLACEMENT:500:Failed to record order");
    }
    if (step.name === "history") {
      return new Error("SHARE_ORDER_PLACEMENT:500:Failed to record trade");
    }
    return new Error(`share-order-placement:${step.name}:${outcome}`);
  };
}

function placementErrorOf(error: Error): { error: string; status: number } {
  const match = /^SHARE_ORDER_PLACEMENT:(\d+):([\s\S]*)$/.exec(error.message);
  if (match) return { error: match[2]!, status: Number(match[1]) };
  throw error;
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

interface CorpAccount {
  _id: ObjectId;
  appliedMoneyFlowKeys?: string[];
}

interface PoolAccount {
  _id: string;
  appliedMoneyFlowKeys?: string[];
}

/** Float `$inc` with the order-flow window folded in (matcher shape). */
export function makeFloatStep(
  db: Db,
  placementKey: string,
  corpId: ObjectId,
  delta: number,
  orderFlow: { field: string; amount: number } | null,
  now: Date
): MoneyFlowStep {
  const extraIncs =
    orderFlow && orderFlow.amount !== 0 ? { [orderFlow.field]: orderFlow.amount } : undefined;
  return makeLegStep(deriveMoneyFlowKey(placementKey, "float"), {
    name: "float",
    collection: db.collection<CorpAccount>("corporations"),
    docId: corpId,
    field: "publicFloat",
    delta,
    ...(delta < 0 ? { minBalance: -delta } : {}),
    ...(extraIncs ? { extraIncs } : {}),
    set: { updatedAt: now },
  });
}

/**
 * Escrow-mode sell split as ONE atomic pipeline update: the exact legacy
 * floored expressions plus the key record, so the split can neither
 * half-land nor double-apply. The revert is the exact inverse through one
 * keyed leg (extraIncs carry the second field).
 */
function makeEscrowSplitDebitStep(
  db: Db,
  placementKey: string,
  corpId: ObjectId,
  escrowPart: number,
  treasuryPart: number,
  now: Date
): MoneyFlowStep {
  const subkey = deriveMoneyFlowKey(placementKey, "dealer", "escrow-split");
  const corps = db.collection<CorpAccount>("corporations");
  return {
    name: "dealer",
    apply: async () => {
      const filter = {
        _id: corpId,
        appliedMoneyFlowKeys: { $ne: subkey },
      } as Filter<CorpAccount>;
      const update = [
        {
          $set: {
            liquidCapital: {
              $subtract: [{ $ifNull: ["$liquidCapital", 0] }, treasuryPart],
            },
            shareEscrowBalance: {
              $subtract: [{ $ifNull: ["$shareEscrowBalance", 0] }, escrowPart],
            },
            updatedAt: now,
            appliedMoneyFlowKeys: {
              $slice: [
                {
                  $concatArrays: [{ $ifNull: ["$appliedMoneyFlowKeys", []] }, [subkey]],
                },
                -100,
              ],
            },
          },
        },
      ] as unknown as Parameters<Collection<CorpAccount>["updateOne"]>[1];
      const result = await corps.updateOne(filter, update);
      if (result.matchedCount === 1) return "applied" as MoneyFlowLegOutcome;
      const existing = await corps.findOne({ _id: corpId } as Filter<CorpAccount>, {
        projection: { appliedMoneyFlowKeys: 1 },
      });
      if (!existing) return "missing";
      if (existing.appliedMoneyFlowKeys?.includes(subkey)) return "already-applied";
      return "guard-rejected";
    },
    revert: () => {
      const compensate = deriveMoneyFlowKey(subkey, "compensate", "dealer");
      if (escrowPart !== 0) {
        return applyIdempotentLeg(
          compensate,
          {
            name: "dealer",
            collection: corps,
            docId: corpId,
            field: "shareEscrowBalance",
            delta: escrowPart,
            ...(treasuryPart !== 0 ? { extraIncs: { liquidCapital: treasuryPart } } : {}),
            set: { updatedAt: now },
          },
          {}
        );
      }
      return applyIdempotentLeg(
        compensate,
        {
          name: "dealer",
          collection: corps,
          docId: corpId,
          field: "liquidCapital",
          delta: treasuryPart,
          set: { updatedAt: now },
        },
        {}
      );
    },
  };
}

export function makeDealerStep(
  db: Db,
  placementKey: string,
  corpId: ObjectId,
  dealer: ShareOrderPlacementDealer,
  now: Date
): MoneyFlowStep | null {
  if (dealer.kind === "escrow-split") {
    return makeEscrowSplitDebitStep(
      db,
      placementKey,
      corpId,
      dealer.escrowPart ?? 0,
      dealer.treasuryPart ?? 0,
      now
    );
  }
  if (dealer.kind === "pool") {
    // Signed matcher shape (see shareMatchSettlement): buys credit the pool,
    // sells debit it under a `$gte` guard, and the lifetime counter always
    // accrues the absolute movement on the pinned flow side.
    const amount = roundCents(dealer.amountLocal);
    if (!Number.isFinite(amount) || amount === 0) return null;
    const pools = db.collection<PoolAccount>(EQUITY_MARKET_POOLS_COLLECTION);
    const leg: MoneyFlowLeg<PoolAccount> = {
      name: "dealer",
      collection: pools,
      docId: dealer.currency as unknown as PoolAccount["_id"],
      field: "cashLocal",
      delta: amount,
      ...(amount < 0 ? { minBalance: -amount } : {}),
      extraIncs: { [`lifetime.${dealer.flowKind}`]: Math.abs(amount) },
      set: { updatedAt: now },
    };
    return makeLegStep(deriveMoneyFlowKey(placementKey, "dealer"), leg);
  }
  if (dealer.kind === "treasury") {
    const amount = dealer.amountLocal;
    if (!Number.isFinite(amount) || amount === 0) return null;
    const corps = db.collection<CorpAccount>("corporations");
    if (amount > 0) {
      return makeLegStep(deriveMoneyFlowKey(placementKey, "dealer"), {
        name: "dealer",
        collection: corps,
        docId: corpId,
        field: "liquidCapital",
        delta: amount,
        extraIncs: { shareIssuanceProceeds: amount },
        set: { updatedAt: now },
      });
    }
    return makeLegStep(deriveMoneyFlowKey(placementKey, "dealer"), {
      name: "dealer",
      collection: corps,
      docId: corpId,
      field: "liquidCapital",
      delta: amount,
      minBalance: -amount,
      set: { updatedAt: now },
    });
  }
  const amount = dealer.amountLocal;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return makeLegStep(deriveMoneyFlowKey(placementKey, "dealer"), {
    name: "dealer",
    collection: db.collection<CorpAccount>("corporations"),
    docId: corpId,
    field: "shareEscrowBalance",
    delta: amount,
    set: { updatedAt: now },
  });
}

/**
 * Terminal history insert: no revert, nothing runs after. A direct keyed
 * insert (not the best-effort `recordShareTrade`, whose catch-all would
 * swallow a process death into `failed`): duplicates converge on the
 * deterministic `_id` and anything else propagates, so a crash here leaves
 * the receipt `in_progress` and the same-key retry converges instead of
 * compensating the fill and burning the key.
 */
function makePlacementHistoryStep(
  db: Db,
  placementKey: string,
  plan: ShareOrderPlacementPlan
): MoneyFlowStep {
  const historyDoc: ShareTradeHistory = buildShareTradeDoc(
    {
      corporationId: new ObjectId(plan.corpIdHex),
      kind: "limit_fill",
      turn: plan.turn,
      shares: plan.history!.shares,
      pricePerShareAnchor: plan.history!.pricePerShareAnchor,
      corpCurrencyCode: plan.history!.corpCurrencyCode as CurrencyCode | undefined,
      from: plan.history!.from,
      to: plan.history!.to,
      createdAt: new Date(plan.nowIso),
    },
    keyedInsertId(placementKey, SHARE_ORDER_PLACEMENT_HISTORY_DOMAIN)
  );
  return {
    name: "history",
    apply: () => insertKeyedDoc(db.collection<ShareTradeHistory>("shareTradeHistory"), historyDoc),
  };
}

/** Step build shared by first attempt and crash recovery (from the stored plan). */
export function buildShareOrderPlacementSteps(
  db: Db,
  plan: ShareOrderPlacementPlan
): MoneyFlowStep[] {
  const now = new Date(plan.nowIso);
  const corpId = new ObjectId(plan.corpIdHex);
  const steps: MoneyFlowStep[] = [];
  const isBuy = plan.kind.startsWith("buy");
  if (isBuy && plan.debitLeg) {
    steps.push(
      makeCashStep(
        db,
        plan.kind === "buy-immediate" ? "buyer-debit" : "escrow-debit",
        deriveMoneyFlowKey(plan.placementKey, "buyer-debit"),
        plan.debitLeg,
        true,
        now
      )
    );
  }
  if (!isBuy && plan.dealer) {
    const dealerStep = makeDealerStep(db, plan.placementKey, corpId, plan.dealer, now);
    if (dealerStep) steps.push(dealerStep);
  }
  if (!isBuy && plan.capDebit) {
    steps.push(
      makeCapDebitStep(
        db,
        deriveMoneyFlowKey(plan.placementKey, "seller-debit"),
        corpId,
        plan.capDebit,
        plan.shares,
        now
      )
    );
  }
  if (isBuy && plan.kind === "buy-immediate") {
    const orderFlow = plan.orderFlowEligible
      ? { field: "orderFlowWindowBuyValue", amount: plan.shares * plan.executionPrice }
      : null;
    steps.push(makeFloatStep(db, plan.placementKey, corpId, -plan.shares, orderFlow, now));
  }
  if (!isBuy && plan.kind === "sell-immediate") {
    const orderFlow = plan.orderFlowEligible
      ? { field: "orderFlowWindowSellValue", amount: plan.shares * plan.executionPrice }
      : null;
    steps.push(makeFloatStep(db, plan.placementKey, corpId, plan.shares, orderFlow, now));
  }
  if (isBuy && plan.capCredit) {
    steps.push(
      makeCapCreditStep(
        db,
        "buyer-credit",
        deriveMoneyFlowKey(plan.placementKey, "buyer-credit"),
        corpId,
        plan.capCredit,
        plan.shares,
        now
      )
    );
  }
  if (!isBuy && plan.proceedsLeg) {
    steps.push(
      makeCashStep(
        db,
        "proceeds-credit",
        deriveMoneyFlowKey(plan.placementKey, "proceeds-credit"),
        plan.proceedsLeg,
        false,
        now
      )
    );
  }
  if (isBuy && plan.dealer) {
    const dealerStep = makeDealerStep(db, plan.placementKey, corpId, plan.dealer, now);
    if (dealerStep) steps.push(dealerStep);
  }
  if (plan.orderDoc) {
    // Terminal order insert (pending only): no revert, nothing runs after.
    // `insertKeyedDoc` converges duplicates on the deterministic `_id` and
    // propagates anything else, so a crash between the escrow debit and the
    // insert leaves the receipt `in_progress` and the same-key retry
    // converges instead of settling compensated and burning the key. The
    // shared `makeInsertStep` catch-all would do the latter.
    const orderDoc = plan.orderDoc as ShareOrder;
    const orderColl = db.collection<ShareOrder>("shareOrders");
    steps.push({
      name: "order-insert",
      apply: () => insertKeyedDoc(orderColl, orderDoc),
    });
  }
  if (plan.history) {
    steps.push(makePlacementHistoryStep(db, plan.placementKey, plan));
  }
  return steps;
}

/** Post-commit best-effort tx row with a deterministic id (replays converge). */
async function emitPlacementTxBestEffort(db: Db, plan: ShareOrderPlacementPlan): Promise<void> {
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
        counterpartyName: tx.counterpartyName,
        ...(tx.counterpartyIdHex ? { counterpartyId: new ObjectId(tx.counterpartyIdHex) } : {}),
        meta: { ...tx.meta },
      },
      undefined,
      { _id: keyedInsertId(plan.placementKey, SHARE_ORDER_PLACEMENT_TX_DOMAIN) }
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
async function readBalanceAfter(db: Db, plan: ShareOrderPlacementPlan): Promise<number> {
  const leg = plan.debitLeg;
  if (!leg) return 0;
  try {
    const doc = (await db.collection<{ _id: ObjectId }>(leg.collection).findOne(
      { _id: new ObjectId(leg.idHex) } as Filter<{ _id: ObjectId }>,
      {
        projection: { [leg.field]: 1 },
      } as never
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
async function runPlacementPostCommit(db: Db, plan: ShareOrderPlacementPlan): Promise<void> {
  void emitPlacementTxBestEffort(db, plan);
  if (plan.spread && !plan.spreadDistributed) {
    try {
      await safeDistributeConversionSpread(
        db,
        plan.spread.fee,
        plan.spread.from as CurrencyCode,
        plan.spread.to as CurrencyCode
      );
    } catch {
      // Terminal by construction (see module header); never fail the fill.
    }
    try {
      await receiptsEx(db).updateOne(
        { _id: plan.placementKey },
        { $set: { "shareOrderPlacementPlan.spreadDistributed": true, updatedAt: new Date() } }
      );
    } catch {
      // Flag write is best effort; the spread itself is terminal.
    }
  }
  if (plan.kind === "sell-immediate" && plan.dealer) {
    const corpId = new ObjectId(plan.corpIdHex);
    // `onFloatSellCommitted` takes positive proceeds (it no-ops on anything
    // else); pool and treasury sell legs pin the signed negative debit.
    const amountLocal = Math.abs(
      plan.dealer.kind === "escrow-split"
        ? (plan.dealer.escrowPart ?? 0) + (plan.dealer.treasuryPart ?? 0)
        : plan.dealer.amountLocal
    );
    void onFloatSellCommitted(db, { _id: corpId } as { _id: ObjectId }, amountLocal);
  }
}

function firePlacementAudit(plan: ShareOrderPlacementPlan): void {
  recordAudit({
    source: "api",
    action: "share.order",
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
    ...(plan.audit.amount !== undefined
      ? { amount: plan.audit.amount, currencyCode: plan.audit.currencyCode }
      : {}),
    refs: { corporationId: new ObjectId(plan.corpIdHex) },
    delta: [
      { field: "orderType", before: null, after: plan.audit.orderType },
      { field: "status", before: null, after: plan.audit.status },
      { field: "shares", before: null, after: plan.audit.shares },
      { field: "pricePerShare", before: null, after: plan.audit.pricePerShare },
    ],
    outcome: "ok",
  });
}

/**
 * Execute one placement to exactly one terminal state. The plan is already
 * fully pinned by the caller (the route); this claims the receipt, stores
 * the plan, runs the steps, and returns the legacy response body. Throws
 * MoneyFlowKeyConflictError / MoneyFlowTerminalError from the claim for the
 * route to map to 409.
 */
export async function executeShareOrderPlacementFlow(
  db: Db,
  plan: ShareOrderPlacementPlan,
  opts: { idempotencyKey?: string } = {}
): Promise<ShareOrderPlacementResult> {
  const placementKey = opts.idempotencyKey ?? randomUUID();
  if (placementKey !== plan.placementKey) {
    throw new Error("share-order-placement:key-mismatch");
  }
  const fingerprint = buildShareOrderPlacementFingerprint(plan);
  const claim = await claimMoneyFlowReceipt(receipts(db), placementKey, fingerprint);
  if (claim === "duplicate") {
    const stored = await receiptsEx(db).findOne({ _id: placementKey });
    const storedPlan = stored?.shareOrderPlacementPlan;
    if (isShareOrderPlacementPlan(storedPlan)) {
      return { ok: true, body: storedPlan.response, replayed: true };
    }
    return { ok: true, body: plan.response, replayed: true };
  }
  if (claim === "in-progress") {
    return recoverShareOrderPlacementByKey(db, placementKey);
  }

  try {
    await receiptsEx(db).updateOne(
      { _id: placementKey },
      { $set: { shareOrderPlacementPlan: { ...plan }, updatedAt: new Date() } }
    );
  } catch (planError) {
    await failMoneyFlowReceipt(receipts(db), placementKey, "share-order-placement:plan-store");
    throw planError;
  }

  try {
    await runMoneyFlowSteps(
      receipts(db),
      placementKey,
      buildShareOrderPlacementSteps(db, plan),
      mapPlacementError(plan)
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("SHARE_ORDER_PLACEMENT:")) {
      const mapped = placementErrorOf(error);
      return { ok: false, error: mapped.error, status: mapped.status };
    }
    throw error;
  }
  await runPlacementPostCommit(db, plan);
  firePlacementAudit(plan);
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
export async function getStoredPlacementResponse(
  db: Db,
  placementKey: string
): Promise<{ settled: boolean } | null> {
  const receipt = await receiptsEx(db).findOne({ _id: placementKey });
  if (!receipt) return null;
  return { settled: receipt.status !== "in_progress" };
}

async function runStoredPlacementPlan(
  db: Db,
  placementKey: string,
  plan: ShareOrderPlacementPlan
): Promise<ShareOrderPlacementResult> {
  try {
    await runMoneyFlowSteps(
      receipts(db),
      placementKey,
      buildShareOrderPlacementSteps(db, plan),
      mapPlacementError(plan)
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("SHARE_ORDER_PLACEMENT:")) {
      const mapped = placementErrorOf(error);
      return { ok: false, error: mapped.error, status: mapped.status };
    }
    return { ok: false, error: "Failed to place order", status: 500 };
  }
  await runPlacementPostCommit(db, plan);
  return { ok: true, body: plan.response, replayed: true };
}

/**
 * Crash recovery for one placement receipt, from only the flow key: replays
 * the stored plan to convergence. A plan-less receipt settled here as
 * `failed` is truthful because the plan store precedes the first step, so a
 * missing plan means no step ever ran and nothing moved.
 */
export async function recoverShareOrderPlacementReceipt(
  db: Db,
  placementKey: string
): Promise<ShareOrderPlacementRecoveryResult> {
  const receipt = await receiptsEx(db).findOne({ _id: placementKey });
  if (!receipt) return { placementKey, action: "skipped-missing" };
  if (receipt.status !== "in_progress") return { placementKey, action: "skipped-settled" };
  const stored = receipt.shareOrderPlacementPlan;
  if (!isShareOrderPlacementPlan(stored)) {
    await failMoneyFlowReceipt(
      receipts(db),
      placementKey,
      "share-order-placement:plan-never-stored"
    );
    return { placementKey, action: "settled-failed-no-plan" };
  }
  const result = await runStoredPlacementPlan(db, placementKey, stored);
  return {
    placementKey,
    action: result.ok ? "placement-recovered" : "placement-incomplete",
  };
}

/**
 * Route- and caller-facing recovery: maps the receipt action onto the
 * legacy placement surface. Same-key retries converge here instead of
 * double-placing.
 */
export async function recoverShareOrderPlacementByKey(
  db: Db,
  placementKey: string
): Promise<ShareOrderPlacementResult> {
  const receipt = await receiptsEx(db).findOne({ _id: placementKey });
  if (!receipt) return { ok: false, error: "Order is not open", status: 400 };
  if (receipt.status === "completed") {
    const stored = receipt.shareOrderPlacementPlan;
    if (isShareOrderPlacementPlan(stored)) {
      return { ok: true, body: stored.response, replayed: true };
    }
    return { ok: false, error: "Order is not open", status: 400 };
  }
  if (receipt.status !== "in_progress") {
    throw new MoneyFlowTerminalError(placementKey, receipt.status, receipt.error);
  }
  const result = await recoverShareOrderPlacementReceipt(db, placementKey);
  switch (result.action) {
    case "placement-recovered":
    case "skipped-settled": {
      const settled = await receiptsEx(db).findOne({ _id: placementKey });
      const stored = settled?.shareOrderPlacementPlan;
      if (isShareOrderPlacementPlan(stored)) {
        return { ok: true, body: stored.response, replayed: true };
      }
      return { ok: false, error: "Failed to place order", status: 500 };
    }
    case "settled-failed-no-plan":
      return { ok: false, error: "Placement did not complete; retry with a new key", status: 500 };
    case "skipped-missing":
      return { ok: false, error: "Order is not open", status: 400 };
    case "placement-incomplete": {
      const current = await receiptsEx(db).findOne({ _id: placementKey });
      return { ok: false, error: current?.error ?? "Failed to place order", status: 500 };
    }
  }
}

export type ShareOrderPlacementRecoveryAction =
  | "placement-recovered"
  | "placement-incomplete"
  | "settled-failed-no-plan"
  | "skipped-settled"
  | "skipped-missing";

export interface ShareOrderPlacementRecoveryResult {
  placementKey: string;
  action: ShareOrderPlacementRecoveryAction;
}

/**
 * Bounded placement orphan scan for the periodic driver. Recovers every
 * `in_progress` placement receipt from its stored plan; plan-less receipts
 * settle `failed` (the plan store precedes the first step, so nothing
 * moved). Foreign-domain receipts stay out via the fingerprint prefix.
 */
export async function recoverShareOrderPlacementOrphans(
  db: Db,
  limit = 50
): Promise<ShareOrderPlacementRecoveryResult[]> {
  const stuck = await receiptsEx(db)
    .find({ status: "in_progress", shareOrderPlacementPlan: { $exists: true } })
    .limit(limit)
    .toArray();
  const results: ShareOrderPlacementRecoveryResult[] = [];
  for (const receipt of stuck) {
    const stored = receipt.shareOrderPlacementPlan;
    if (!isShareOrderPlacementPlan(stored)) {
      await failMoneyFlowReceipt(
        receipts(db),
        receipt._id,
        "share-order-placement:plan-never-stored"
      );
      results.push({ placementKey: receipt._id, action: "settled-failed-no-plan" });
      continue;
    }
    const result = await runStoredPlacementPlan(db, receipt._id, stored);
    results.push({
      placementKey: receipt._id,
      action: result.ok ? "placement-recovered" : "placement-incomplete",
    });
  }
  if (results.length >= limit) return results;
  const planless = await receiptsEx(db)
    .find({ status: "in_progress", shareOrderPlacementPlan: { $exists: false } })
    .limit(limit - results.length)
    .toArray();
  for (const receipt of planless) {
    if (typeof receipt._id !== "string") continue;
    if (
      typeof receipt.fingerprint !== "string" ||
      !receipt.fingerprint.startsWith(SHARE_ORDER_PLACEMENT_FINGERPRINT_DOMAIN)
    ) {
      continue;
    }
    await failMoneyFlowReceipt(
      receipts(db),
      receipt._id,
      "share-order-placement:plan-never-stored"
    );
    results.push({ placementKey: receipt._id, action: "settled-failed-no-plan" });
  }
  return results;
}
