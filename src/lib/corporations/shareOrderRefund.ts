import { randomUUID } from "node:crypto";
import { ObjectId, type Collection, type Db, type Filter } from "mongodb";
import {
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  deriveMoneyFlowKey,
  failMoneyFlowReceipt,
  keyedInsertId,
  runMoneyFlowSteps,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
  type MoneyFlowLegOutcome,
  type MoneyFlowReceipt,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import {
  makeCapCreditStep,
  makeCashStep,
  personalBalanceField,
  type ShareFillCapLeg,
  type ShareFillCashLeg,
} from "@/lib/corporations/commands/shareTrading/shareFillMoney";
import { emitTx } from "@/lib/financialTxLog/emit";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getHomeCurrency, loadCharacterFxRate } from "@/lib/currency/characterFunds";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import type { Character, Corporation, ShareOrder } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import type { CurrencyCode } from "@/lib/constants/currencies";

/**
 * Keyed order-cancel refunds (issue #1672).
 *
 * Placing a buy order escrows cash immediately and placing a sell order with
 * `sharesDebitedAtCreation` reserves shares immediately. The legacy cancel
 * (`cancelShareOrderAndRefund`) then ran claim-then-refund with plain
 * updates: a crash between the `cancelled` claim and the refund left the
 * order cancelled with the escrow kept, and a retry found the order already
 * `cancelled` and no-op'd, stranding player money forever. Concurrent
 * cancels could also both pass the status check and double-refund.
 *
 * This module runs every cancel as one keyed money flow, following the
 * share-fill money conventions:
 *
 * - One receipt per cancel attempt. The caller passes an idempotency key
 *   (the DELETE route forwards the client `Idempotency-Key`, minted when
 *   absent); internal callers (market cleanup, currency conversion) mint
 *   one per call. Same-key retries converge, different keys race on the
 *   CAS claim and the loser keeps the legacy `Order is not open` surface.
 * - The CAS order claim (`open` to `cancelled`, stamped with the flow key)
 *   runs BEFORE the resume plan is pinned, so the plan records the exact
 *   post-claim remainder: a fill racing the cancel either wins (claim
 *   guard-rejects, legacy 400) or loses (plan refunds the true remainder).
 *   Partial fills therefore refund only the remaining escrow and restore
 *   only the remaining reserved shares.
 * - Refund and share-restore legs are exactly-once keyed steps with keyed
 *   inverses, so `runMoneyFlowSteps` reverses the applied prefix before
 *   settling: the flow ends `completed` or terminal without effect, never
 *   partial. The refund tx row is post-commit best effort with a
 *   deterministic `_id`, so replays converge instead of duplicating it.
 * - Recovery (`recoverShareOrderRefundByKey`) rebuilds from the STORED
 *   plan. A plan-less receipt whose key is stamped on a cancelled order
 *   rebuilds the plan from that order (the crash landed between claim and
 *   plan store); a plan-less receipt with no stamped order settles
 *   `failed`, which is truthful because the claim never ran.
 *
 * Legacy economics and API behavior are preserved: identical refund math
 * (anchor-normalized escrow, same rounding, same tx shape), identical
 * orphan-buyer fallbacks (cancel without refund when the placer document
 * is gone, including a dissolved fund), identical error strings (including
 * the 503-eligible FX message), and fund escrow refunds reuse the
 * historical `indexfund-bid-cancel:<orderId>` subkey so an already-applied
 * legacy refund converges as `already-applied`. Fund refunds credit the
 * stored `escrowAnchor` remainder verbatim (never recomputed via live FX),
 * matching the legacy verbatim refund under FX drift and partial fills.
 */

export type ShareOrderRefundResult = { ok: true } | { ok: false; error: string };

/** Fingerprint domain for cancel receipts; the orphan scan filters on it. */
export const SHARE_ORDER_REFUND_FINGERPRINT_DOMAIN = "share-order-refund";

export const SHARE_ORDER_REFUND_TX_DOMAIN = "share-order-refund-tx";

/** Legacy fund-refund subkey, reused so prior applies converge. */
export function fundBidCancelSubkey(orderIdHex: string): string {
  return `indexfund-bid-cancel:${orderIdHex}`;
}

export type ShareOrderRefundCashKind = "character-cash" | "corp-capital" | "fund-cash" | "none";

/**
 * Immutable resume plan pinned after the CAS claim. Every remainder,
 * amount, currency field, and party is fixed here; recovery replays these
 * figures instead of re-reading post-cancel state.
 */
export interface ShareOrderRefundPlan {
  version: 1;
  refundKey: string;
  orderIdHex: string;
  corpIdHex: string;
  orderType: "buy" | "sell";
  turn: number;
  nowIso: string;
  /** Post-claim remainder: partial fills refund/restore only what is left. */
  sharesRemaining: number;
  escrowAmount: number;
  escrowAnchor?: number;
  pricePerShare: number;
  cashKind: ShareOrderRefundCashKind;
  /** Buy refund credit to a character wallet or corp treasury. */
  cashLeg: ShareFillCashLeg | null;
  /** Buy refund credit to fund cashAnchor. */
  fundRefund: { fundIdHex: string; amountAnchor: number } | null;
  /** Sell share-restore credit for reserved inventory. */
  restoreLeg: ShareFillCapLeg | null;
  /** Refund tx row for buy refunds; null for sells and no-refund cancels. */
  tx: {
    subjectType: "character" | "corporation";
    subjectIdHex: string;
    subjectName: string;
    amount: number;
    currencyCode: string;
    escrowAmountAnchor: number;
    imperial: boolean;
  } | null;
  /** Set when the cancel completes without moving money (legacy fallback). */
  noRefundReason?:
    "placer-character-missing" | "placer-corp-missing" | "placer-fund-missing" | "sell-no-reserve";
  outcome?: ShareOrderRefundOutcome;
}

export interface ShareOrderRefundOutcome {
  refunded: number;
  sharesRestored: number;
}

export function isShareOrderRefundPlan(value: unknown): value is ShareOrderRefundPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    plan.version === 1 &&
    typeof plan.refundKey === "string" &&
    typeof plan.orderIdHex === "string" &&
    typeof plan.corpIdHex === "string" &&
    (plan.orderType === "buy" || plan.orderType === "sell") &&
    typeof plan.sharesRemaining === "number" &&
    typeof plan.escrowAmount === "number" &&
    typeof plan.cashKind === "string"
  );
}

/** Fingerprint covers the pinned remainder and parties; key reuse across orders fails closed. */
export function buildShareOrderRefundFingerprint(args: {
  orderId: ObjectId;
  orderType: "buy" | "sell";
  sharesRemaining: number;
  escrowAmount: number;
  cashKind: ShareOrderRefundCashKind;
  cashIdHex?: string;
  amount?: number;
}): string {
  const cents = (n: number): string => String(Math.round(n * 100) / 100);
  return [
    SHARE_ORDER_REFUND_FINGERPRINT_DOMAIN,
    args.orderId.toHexString(),
    args.orderType,
    `remaining:${args.sharesRemaining}`,
    `escrow:${cents(args.escrowAmount)}`,
    `kind:${args.cashKind}`,
    args.cashIdHex ?? "none",
    args.amount !== undefined ? cents(args.amount) : "none",
  ].join(":");
}

type ShareOrderRefundReceipt = MoneyFlowReceipt & { shareOrderRefundPlan?: unknown };

function receipts(db: Db): Collection<MoneyFlowReceipt> {
  return db.collection<MoneyFlowReceipt>(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION);
}

function receiptsEx(db: Db): Collection<ShareOrderRefundReceipt> {
  return db.collection<ShareOrderRefundReceipt>(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION);
}

interface OrderAccount {
  _id: ObjectId;
  appliedMoneyFlowKeys?: string[];
}

interface FundAccount {
  _id: ObjectId;
  appliedMoneyFlowKeys?: string[];
}

function mapRefundError(step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error {
  return new Error(`share-order-refund:${step.name}:${outcome}`);
}

/**
 * CAS order claim: `open` to `cancelled` with the flow key stamped. The
 * filter pins `open`, so a competing cancel or fill wins outright and this
 * attempt reports the legacy `Order is not open`. The revert restores
 * `open` (pinned on the post-claim remainder so it cannot undo a later
 * fill, though a later fill requires `open` and therefore cannot exist
 * while this claim stands).
 */
function makeOrderClaimStep(
  db: Db,
  refundKey: string,
  orderId: ObjectId,
  now: Date
): MoneyFlowStep {
  const orders = db.collection<OrderAccount>("shareOrders");
  return {
    name: "order-claim",
    apply: () =>
      applyKeyedUpdate(
        deriveMoneyFlowKey(refundKey, "order-claim"),
        {
          collection: orders,
          filter: { _id: orderId, status: "open" } as Filter<OrderAccount>,
          update: {
            $set: { status: "cancelled", lastShareOrderRefundKey: refundKey, updatedAt: now },
          },
        },
        {}
      ),
    revert: () =>
      applyKeyedUpdate(
        deriveMoneyFlowKey(refundKey, "compensate", "order-claim"),
        {
          collection: orders,
          filter: {
            _id: orderId,
            status: "cancelled",
            lastShareOrderRefundKey: refundKey,
          } as Filter<OrderAccount>,
          update: { $set: { status: "open", updatedAt: now } },
        },
        {}
      ),
  };
}

/** Fund cashAnchor refund under the historical subkey (converges with legacy applies). */
function makeFundRefundStep(
  db: Db,
  orderIdHex: string,
  fundId: ObjectId,
  amountAnchor: number,
  now: Date
): MoneyFlowStep {
  const funds = db.collection<FundAccount>("indexFunds");
  const subkey = fundBidCancelSubkey(orderIdHex);
  return {
    name: "fund-refund",
    apply: () =>
      applyKeyedUpdate(
        subkey,
        {
          collection: funds,
          filter: { _id: fundId } as Filter<FundAccount>,
          update: { $inc: { cashAnchor: amountAnchor }, $set: { updatedAt: now } },
        },
        {}
      ),
    revert: () =>
      applyKeyedUpdate(
        deriveMoneyFlowKey(subkey, "compensate", "fund-refund"),
        {
          collection: funds,
          filter: { _id: fundId } as Filter<FundAccount>,
          update: { $inc: { cashAnchor: -amountAnchor }, $set: { updatedAt: now } },
        },
        {}
      ),
  };
}

/** Step build shared by first attempt and crash recovery (from the stored plan). */
export function buildShareOrderRefundSteps(db: Db, plan: ShareOrderRefundPlan): MoneyFlowStep[] {
  const now = new Date(plan.nowIso);
  const corpId = new ObjectId(plan.corpIdHex);
  const orderId = new ObjectId(plan.orderIdHex);
  const steps: MoneyFlowStep[] = [makeOrderClaimStep(db, plan.refundKey, orderId, now)];
  if (plan.cashLeg) {
    steps.push(
      makeCashStep(
        db,
        "refund-credit",
        deriveMoneyFlowKey(plan.refundKey, "refund-credit"),
        plan.cashLeg,
        false,
        now
      )
    );
  }
  if (plan.fundRefund) {
    steps.push(
      makeFundRefundStep(
        db,
        plan.orderIdHex,
        new ObjectId(plan.fundRefund.fundIdHex),
        plan.fundRefund.amountAnchor,
        now
      )
    );
  }
  if (plan.restoreLeg && plan.sharesRemaining > 0) {
    steps.push(
      makeCapCreditStep(
        db,
        "restore-credit",
        deriveMoneyFlowKey(plan.refundKey, "restore-credit"),
        corpId,
        plan.restoreLeg,
        plan.sharesRemaining,
        now
      )
    );
  }
  return steps;
}

interface BuiltRefund {
  plan: ShareOrderRefundPlan;
  fingerprint: string;
}

/**
 * Read the post-claim order and pin the refund plan. Mirrors the legacy
 * branch structure exactly (character/corp/fund buy refunds, orphan
 * fallbacks, sell restores) with identical math; throws the legacy error
 * string when the cancel cannot proceed.
 */
async function buildRefundPlan(
  db: Db,
  refundKey: string,
  claimed: ShareOrder,
  now: Date
): Promise<BuiltRefund> {
  const currentTurn = await getCurrentTurn(db);
  const orderIdHex = claimed._id.toHexString();
  const corpIdHex = claimed.corporationId.toHexString();
  const base = {
    version: 1 as const,
    refundKey,
    orderIdHex,
    corpIdHex,
    orderType: claimed.type,
    turn: currentTurn,
    nowIso: now.toISOString(),
    sharesRemaining: claimed.sharesRemaining,
    escrowAmount: claimed.escrowAmount,
    ...(claimed.escrowAnchor !== undefined ? { escrowAnchor: claimed.escrowAnchor } : {}),
    pricePerShare: claimed.pricePerShare,
  };

  if (claimed.type === "sell") {
    if (claimed.sharesDebitedAtCreation && claimed.placerCorporationId) {
      const plan: ShareOrderRefundPlan = {
        ...base,
        cashKind: "none",
        cashLeg: null,
        fundRefund: null,
        restoreLeg: {
          field: "corporationId",
          idHex: claimed.placerCorporationId.toHexString(),
          pricePerShare: claimed.pricePerShare,
        },
        tx: null,
      };
      return {
        plan,
        fingerprint: buildShareOrderRefundFingerprint({
          orderId: claimed._id,
          orderType: "sell",
          sharesRemaining: claimed.sharesRemaining,
          escrowAmount: claimed.escrowAmount,
          cashKind: "none",
          cashIdHex: claimed.placerCorporationId.toHexString(),
          amount: claimed.sharesRemaining,
        }),
      };
    }
    if (claimed.sharesDebitedAtCreation && claimed.characterId) {
      const plan: ShareOrderRefundPlan = {
        ...base,
        cashKind: "none",
        cashLeg: null,
        fundRefund: null,
        restoreLeg: {
          field: "characterId",
          idHex: claimed.characterId.toHexString(),
          pricePerShare: claimed.pricePerShare,
        },
        tx: null,
      };
      return {
        plan,
        fingerprint: buildShareOrderRefundFingerprint({
          orderId: claimed._id,
          orderType: "sell",
          sharesRemaining: claimed.sharesRemaining,
          escrowAmount: claimed.escrowAmount,
          cashKind: "none",
          cashIdHex: claimed.characterId.toHexString(),
          amount: claimed.sharesRemaining,
        }),
      };
    }
    const plan: ShareOrderRefundPlan = {
      ...base,
      cashKind: "none",
      cashLeg: null,
      fundRefund: null,
      restoreLeg: null,
      tx: null,
      noRefundReason: "sell-no-reserve",
    };
    return {
      plan,
      fingerprint: buildShareOrderRefundFingerprint({
        orderId: claimed._id,
        orderType: "sell",
        sharesRemaining: claimed.sharesRemaining,
        escrowAmount: claimed.escrowAmount,
        cashKind: "none",
      }),
    };
  }

  // Index-fund-owned buy orders refund the stored anchor remainder
  // verbatim. The matcher decrements `escrowAnchor` proportionally on each
  // partial fill, so the stored value is exactly the unfilled escrow at
  // cancel time. Recomputing from `escrowAmount` via live FX would over- or
  // under-refund after FX drift, so this branch never touches FX. A missing
  // fund document cancels without refund, mirroring the orphan-placer
  // fallbacks below (legacy cleanup semantics).
  if (claimed.placerFundId) {
    const fundDoc = await db
      .collection("indexFunds")
      .findOne({ _id: claimed.placerFundId }, { projection: { _id: 1 } });
    if (!fundDoc) {
      const plan: ShareOrderRefundPlan = {
        ...base,
        cashKind: "none",
        cashLeg: null,
        fundRefund: null,
        restoreLeg: null,
        tx: null,
        noRefundReason: "placer-fund-missing",
      };
      return {
        plan,
        fingerprint: buildShareOrderRefundFingerprint({
          orderId: claimed._id,
          orderType: "buy",
          sharesRemaining: claimed.sharesRemaining,
          escrowAmount: claimed.escrowAmount,
          cashKind: "none",
          cashIdHex: claimed.placerFundId.toHexString(),
        }),
      };
    }
    let fundRefundAnchor = claimed.escrowAnchor;
    if (fundRefundAnchor === undefined) {
      const legacyTarget = await db
        .collection<Corporation>("corporations")
        .findOne({ _id: claimed.corporationId });
      if (!legacyTarget) {
        throw new Error("Target corporation not found");
      }
      const legacyFxRate = await getCorpFxRate(db, legacyTarget);
      fundRefundAnchor = corpLiquidCapitalToAnchor(
        claimed.escrowAmount,
        legacyTarget,
        legacyFxRate
      );
    }
    const plan: ShareOrderRefundPlan = {
      ...base,
      cashKind: "fund-cash",
      cashLeg: null,
      fundRefund: { fundIdHex: claimed.placerFundId.toHexString(), amountAnchor: fundRefundAnchor },
      restoreLeg: null,
      tx: null,
    };
    return {
      plan,
      fingerprint: buildShareOrderRefundFingerprint({
        orderId: claimed._id,
        orderType: "buy",
        sharesRemaining: claimed.sharesRemaining,
        escrowAmount: claimed.escrowAmount,
        cashKind: "fund-cash",
        cashIdHex: claimed.placerFundId.toHexString(),
        amount: fundRefundAnchor,
      }),
    };
  }

  const targetCorp = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: claimed.corporationId });
  if (!targetCorp) {
    throw new Error("Target corporation not found");
  }
  const targetFxRate = await getCorpFxRate(db, targetCorp);
  const refundAnchor = corpLiquidCapitalToAnchor(claimed.escrowAmount, targetCorp, targetFxRate);

  if (claimed.placerCorporationId) {
    const placerCorp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: claimed.placerCorporationId });
    if (!placerCorp) {
      const plan: ShareOrderRefundPlan = {
        ...base,
        cashKind: "none",
        cashLeg: null,
        fundRefund: null,
        restoreLeg: null,
        tx: null,
        noRefundReason: "placer-corp-missing",
      };
      return {
        plan,
        fingerprint: buildShareOrderRefundFingerprint({
          orderId: claimed._id,
          orderType: "buy",
          sharesRemaining: claimed.sharesRemaining,
          escrowAmount: claimed.escrowAmount,
          cashKind: "none",
          cashIdHex: claimed.placerCorporationId.toHexString(),
        }),
      };
    }
    const placerFxRate = await getCorpFxRate(db, placerCorp);
    const refundInPlacerCapital = anchorToCorpLiquidCapital(refundAnchor, placerCorp, placerFxRate);
    const currencyCode = resolveCorpLiquidCurrencyCode(placerCorp) ?? "USD";
    const plan: ShareOrderRefundPlan = {
      ...base,
      cashKind: "corp-capital",
      cashLeg: {
        collection: "corporations",
        idHex: claimed.placerCorporationId.toHexString(),
        field: "liquidCapital",
        amount: refundInPlacerCapital,
      },
      fundRefund: null,
      restoreLeg: null,
      tx: {
        subjectType: "corporation",
        subjectIdHex: claimed.placerCorporationId.toHexString(),
        subjectName: placerCorp.name,
        amount: Math.round(refundInPlacerCapital * 100) / 100,
        currencyCode,
        escrowAmountAnchor: Math.round(refundAnchor * 100) / 100,
        imperial: false,
      },
    };
    return {
      plan,
      fingerprint: buildShareOrderRefundFingerprint({
        orderId: claimed._id,
        orderType: "buy",
        sharesRemaining: claimed.sharesRemaining,
        escrowAmount: claimed.escrowAmount,
        cashKind: "corp-capital",
        cashIdHex: claimed.placerCorporationId.toHexString(),
        amount: refundInPlacerCapital,
      }),
    };
  }

  if (!claimed.characterId) {
    throw new Error("Order has no owner to refund");
  }
  const orderCharacterId = claimed.characterId;
  let charDoc = await db
    .collection<Character>("characters")
    .findOne({ _id: orderCharacterId }, { projection: { countryId: 1, name: 1 } });
  let collectionName: "characters" | "imperialCharacters" = "characters";
  let imperial = false;
  if (!charDoc) {
    const imperialDoc = await db
      .collection<ImperialCharacter>("imperialCharacters")
      .findOne({ _id: orderCharacterId }, { projection: { countryId: 1, name: 1 } });
    if (imperialDoc) {
      charDoc = imperialDoc as unknown as Character;
      collectionName = "imperialCharacters";
      imperial = true;
    }
  }
  if (!charDoc) {
    const plan: ShareOrderRefundPlan = {
      ...base,
      cashKind: "none",
      cashLeg: null,
      fundRefund: null,
      restoreLeg: null,
      tx: null,
      noRefundReason: "placer-character-missing",
    };
    return {
      plan,
      fingerprint: buildShareOrderRefundFingerprint({
        orderId: claimed._id,
        orderType: "buy",
        sharesRemaining: claimed.sharesRemaining,
        escrowAmount: claimed.escrowAmount,
        cashKind: "none",
        cashIdHex: orderCharacterId.toHexString(),
      }),
    };
  }

  const forexEnabled = await isForexEnabled();
  const homeCurrency = getHomeCurrency(charDoc as unknown as { countryId: string });
  let charFxRate = 1.0;
  if (forexEnabled) {
    const fxResult = await loadCharacterFxRate(db, homeCurrency);
    if (!fxResult.ok) {
      throw new Error("Exchange rate unavailable, try again shortly");
    }
    charFxRate = fxResult.rate;
  }
  const refundInHome = refundAnchor * charFxRate;
  const plan: ShareOrderRefundPlan = {
    ...base,
    cashKind: "character-cash",
    cashLeg: {
      collection: collectionName,
      idHex: orderCharacterId.toHexString(),
      field: personalBalanceField(homeCurrency, forexEnabled),
      amount: refundInHome,
    },
    fundRefund: null,
    restoreLeg: null,
    tx: {
      subjectType: "character",
      subjectIdHex: orderCharacterId.toHexString(),
      subjectName: (charDoc as unknown as { name?: string }).name ?? "(unknown)",
      amount: Math.round(refundInHome * 100) / 100,
      currencyCode: homeCurrency,
      escrowAmountAnchor: Math.round(refundAnchor * 100) / 100,
      imperial,
    },
  };
  return {
    plan,
    fingerprint: buildShareOrderRefundFingerprint({
      orderId: claimed._id,
      orderType: "buy",
      sharesRemaining: claimed.sharesRemaining,
      escrowAmount: claimed.escrowAmount,
      cashKind: "character-cash",
      cashIdHex: orderCharacterId.toHexString(),
      amount: refundInHome,
    }),
  };
}

/** Post-commit best-effort refund tx with a deterministic id (replays converge). */
async function emitRefundTxBestEffort(db: Db, plan: ShareOrderRefundPlan): Promise<void> {
  if (!plan.tx) return;
  const createdAt = new Date(plan.nowIso);
  const orderId = new ObjectId(plan.orderIdHex);
  const corpId = new ObjectId(plan.corpIdHex);
  const subjectId = new ObjectId(plan.tx.subjectIdHex);
  try {
    if (plan.tx.subjectType === "corporation") {
      await emitTx(
        db,
        {
          type: "stock_order_refund",
          turn: plan.turn,
          createdAt,
          subjectType: "corporation",
          subjectId,
          subjectName: plan.tx.subjectName,
          amount: plan.tx.amount,
          currencyCode: plan.tx.currencyCode as CurrencyCode,
          counterpartyType: "system",
          counterpartyName: "Order book escrow",
          meta: {
            orderId: orderId.toString(),
            orderType: plan.orderType,
            targetCorporationId: corpId.toString(),
            escrowAmountAnchor: plan.tx.escrowAmountAnchor,
          },
        },
        undefined,
        { _id: keyedInsertId(plan.refundKey, SHARE_ORDER_REFUND_TX_DOMAIN) }
      );
    } else {
      await emitTx(
        db,
        {
          type: "stock_order_refund",
          turn: plan.turn,
          createdAt,
          subjectType: "character",
          subjectId,
          subjectName: plan.tx.subjectName,
          amount: plan.tx.amount,
          currencyCode: plan.tx.currencyCode as CurrencyCode,
          counterpartyType: "system",
          counterpartyName: "Order book escrow",
          meta: {
            orderId: orderId.toString(),
            orderType: plan.orderType,
            targetCorporationId: corpId.toString(),
            escrowAmountAnchor: plan.tx.escrowAmountAnchor,
            imperial: plan.tx.imperial,
          },
        },
        undefined,
        { _id: keyedInsertId(plan.refundKey, SHARE_ORDER_REFUND_TX_DOMAIN) }
      );
    }
  } catch {
    // Best effort, like the legacy fire-and-forget row.
  }
}

function outcomeOf(plan: ShareOrderRefundPlan): ShareOrderRefundOutcome {
  return {
    refunded: plan.cashLeg?.amount ?? plan.fundRefund?.amountAnchor ?? 0,
    sharesRestored: plan.restoreLeg ? plan.sharesRemaining : 0,
  };
}

/**
 * Execute one order cancel to exactly one terminal state. The CAS claim
 * runs first (stamping the key), the plan pins the post-claim remainder,
 * and the keyed steps converge on retry. Throws MoneyFlowKeyConflictError
 * / MoneyFlowTerminalError from the claim for the route to map to 409;
 * validation failures after the claim revert it and return `{ok:false}`
 * with the legacy error string.
 */
export async function executeShareOrderRefundFlow(
  db: Db,
  order: ShareOrder,
  opts: { idempotencyKey?: string } = {}
): Promise<ShareOrderRefundResult> {
  const refundKey = opts.idempotencyKey ?? randomUUID();
  const now = new Date();
  const orderId = order._id;

  if (order.status !== "open") {
    return { ok: false, error: "Order is not open" };
  }

  // Pre-claim fingerprint from the caller's read. The stored fingerprint
  // pins this attempt's remainder; a same-key retry after the claim reads
  // the cancelled order and reconciles by key instead (see below).
  const preFingerprint = buildShareOrderRefundFingerprint({
    orderId,
    orderType: order.type,
    sharesRemaining: order.sharesRemaining,
    escrowAmount: order.escrowAmount,
    cashKind: order.placerFundId
      ? "fund-cash"
      : order.type === "sell"
        ? "none"
        : order.placerCorporationId
          ? "corp-capital"
          : "character-cash",
    cashIdHex:
      order.placerFundId?.toHexString() ??
      order.placerCorporationId?.toHexString() ??
      order.characterId?.toHexString(),
  });
  const claim = await claimMoneyFlowReceipt(receipts(db), refundKey, preFingerprint);
  if (claim === "duplicate") {
    return { ok: true };
  }
  if (claim === "in-progress") {
    return recoverShareOrderRefundByKey(db, refundKey);
  }

  // Fresh attempt: CAS the claim first, then pin the plan from the
  // post-claim read so the remainder is exact under a fill race.
  const claimStep = makeOrderClaimStep(db, refundKey, orderId, now);
  const claimOutcome = await claimStep.apply();
  if (claimOutcome !== "applied" && claimOutcome !== "already-applied") {
    await failMoneyFlowReceipt(receipts(db), refundKey, "share-order-refund:claim-race");
    return { ok: false, error: "Order is not open" };
  }
  const claimed = await db.collection<ShareOrder>("shareOrders").findOne({ _id: orderId });
  if (!claimed) {
    await failMoneyFlowReceipt(receipts(db), refundKey, "share-order-refund:order-missing");
    return { ok: false, error: "Order not found" };
  }
  let built: BuiltRefund;
  try {
    built = await buildRefundPlan(db, refundKey, claimed, now);
  } catch (error) {
    // Validation (missing target, missing owner, FX outage) leaves the
    // order open exactly like the legacy pre-claim failure: revert the
    // claim step, settle failed (this attempt moved nothing net), and
    // return the legacy error string.
    if (claimStep.revert) await claimStep.revert();
    await failMoneyFlowReceipt(
      receipts(db),
      refundKey,
      `share-order-refund:${(error as Error).message}`
    );
    return { ok: false, error: (error as Error).message || "Failed to cancel order" };
  }
  try {
    await receiptsEx(db).updateOne(
      { _id: refundKey },
      { $set: { shareOrderRefundPlan: built.plan, updatedAt: new Date() } }
    );
  } catch (planError) {
    if (claimStep.revert) await claimStep.revert();
    await failMoneyFlowReceipt(receipts(db), refundKey, "share-order-refund:plan-store");
    throw planError;
  }

  try {
    await runMoneyFlowSteps(
      receipts(db),
      refundKey,
      buildShareOrderRefundSteps(db, built.plan),
      mapRefundError
    );
  } catch (error) {
    // The prefix compensated (the order claim reverted, so the order is
    // open again); surface the step error like the legacy refund failure.
    return { ok: false, error: (error as Error).message };
  }
  const outcome = outcomeOf(built.plan);
  await receiptsEx(db).updateOne(
    { _id: refundKey },
    { $set: { "shareOrderRefundPlan.outcome": outcome, updatedAt: new Date() } }
  );
  void emitRefundTxBestEffort(db, built.plan);
  return { ok: true };
}

async function settlePlanAndEmit(
  db: Db,
  refundKey: string,
  plan: ShareOrderRefundPlan
): Promise<void> {
  const outcome = outcomeOf(plan);
  await receiptsEx(db).updateOne(
    { _id: refundKey },
    { $set: { "shareOrderRefundPlan.outcome": outcome, updatedAt: new Date() } }
  );
  void emitRefundTxBestEffort(db, plan);
}

async function runStoredPlan(
  db: Db,
  refundKey: string,
  plan: ShareOrderRefundPlan
): Promise<ShareOrderRefundRecoveryAction> {
  try {
    await runMoneyFlowSteps(
      receipts(db),
      refundKey,
      buildShareOrderRefundSteps(db, plan),
      mapRefundError
    );
  } catch {
    return "refund-incomplete";
  }
  await settlePlanAndEmit(db, refundKey, plan);
  return "refund-recovered";
}

/**
 * Crash recovery for one cancel receipt, from only the flow key: replays
 * the stored plan to convergence. A plan-less receipt stamped on a
 * cancelled order rebuilds the plan from that order (claim landed, plan
 * store did not); a plan-less receipt with no stamped order settles
 * `failed` (the claim never ran, so nothing moved).
 */
export async function recoverShareOrderRefundReceipt(
  db: Db,
  refundKey: string
): Promise<ShareOrderRefundRecoveryResult> {
  const receipt = await receiptsEx(db).findOne({ _id: refundKey });
  if (!receipt) return { refundKey, action: "skipped-missing" };
  if (receipt.status !== "in_progress") return { refundKey, action: "skipped-settled" };
  const stored = receipt.shareOrderRefundPlan;
  if (!isShareOrderRefundPlan(stored)) {
    const stamped = await db
      .collection<ShareOrder>("shareOrders")
      .findOne({ lastShareOrderRefundKey: refundKey });
    if (stamped && stamped.status === "cancelled") {
      const now = new Date();
      let built: BuiltRefund;
      try {
        built = await buildRefundPlan(db, refundKey, stamped, now);
      } catch (error) {
        const claimStep = makeOrderClaimStep(db, refundKey, stamped._id, now);
        if (claimStep.revert) await claimStep.revert();
        await failMoneyFlowReceipt(
          receipts(db),
          refundKey,
          `share-order-refund:${(error as Error).message}`
        );
        return { refundKey, action: "refund-incomplete" };
      }
      await receiptsEx(db).updateOne(
        { _id: refundKey },
        { $set: { shareOrderRefundPlan: built.plan, updatedAt: new Date() } }
      );
      return { refundKey, action: await runStoredPlan(db, refundKey, built.plan) };
    }
    await failMoneyFlowReceipt(receipts(db), refundKey, "share-order-refund:plan-never-stored");
    return { refundKey, action: "settled-failed-no-plan" };
  }
  return { refundKey, action: await runStoredPlan(db, refundKey, stored) };
}

/**
 * Route- and caller-facing recovery: maps the receipt action onto the
 * legacy cancel surface. Same-key retries converge here instead of
 * double-refunding.
 */
export async function recoverShareOrderRefundByKey(
  db: Db,
  refundKey: string
): Promise<ShareOrderRefundResult> {
  const result = await recoverShareOrderRefundReceipt(db, refundKey);
  switch (result.action) {
    case "refund-recovered":
    case "skipped-settled":
      return { ok: true };
    case "settled-failed-no-plan":
    case "skipped-missing":
      return { ok: false, error: "Order is not open" };
    case "refund-incomplete": {
      const receipt = await receiptsEx(db).findOne({ _id: refundKey });
      return { ok: false, error: receipt?.error ?? "Failed to cancel order" };
    }
  }
}

export type ShareOrderRefundRecoveryAction =
  | "refund-recovered"
  | "refund-incomplete"
  | "settled-failed-no-plan"
  | "skipped-settled"
  | "skipped-missing";

export interface ShareOrderRefundRecoveryResult {
  refundKey: string;
  action: ShareOrderRefundRecoveryAction;
}

/**
 * Bounded cancel orphan scan for the periodic driver. Recovers every
 * `in_progress` cancel receipt from its stored plan (or rebuilds the plan
 * from the stamped order when the claim landed but the plan store did
 * not). Foreign-domain receipts stay out via the fingerprint prefix.
 */
export async function recoverShareOrderRefundOrphans(
  db: Db,
  limit = 50
): Promise<ShareOrderRefundRecoveryResult[]> {
  const stuck = await receiptsEx(db)
    .find({ status: "in_progress", shareOrderRefundPlan: { $exists: true } })
    .limit(limit)
    .toArray();
  const results: ShareOrderRefundRecoveryResult[] = [];
  for (const receipt of stuck) {
    const stored = receipt.shareOrderRefundPlan;
    if (!isShareOrderRefundPlan(stored)) {
      await failMoneyFlowReceipt(receipts(db), receipt._id, "share-order-refund:plan-never-stored");
      results.push({ refundKey: receipt._id, action: "settled-failed-no-plan" });
      continue;
    }
    try {
      await runMoneyFlowSteps(
        receipts(db),
        receipt._id,
        buildShareOrderRefundSteps(db, stored),
        mapRefundError
      );
      await receiptsEx(db).updateOne(
        { _id: receipt._id },
        {
          $set: {
            "shareOrderRefundPlan.outcome": outcomeOf(stored),
            updatedAt: new Date(),
          },
        }
      );
      void emitRefundTxBestEffort(db, stored);
      results.push({ refundKey: receipt._id, action: "refund-recovered" });
    } catch {
      results.push({ refundKey: receipt._id, action: "refund-incomplete" });
    }
  }
  if (results.length >= limit) return results;
  const planless = await receiptsEx(db)
    .find({ status: "in_progress", shareOrderRefundPlan: { $exists: false } })
    .limit(limit - results.length)
    .toArray();
  for (const receipt of planless) {
    if (typeof receipt._id !== "string") continue;
    if (
      typeof receipt.fingerprint !== "string" ||
      !receipt.fingerprint.startsWith(SHARE_ORDER_REFUND_FINGERPRINT_DOMAIN)
    ) {
      continue;
    }
    results.push(await recoverShareOrderRefundReceipt(db, receipt._id));
  }
  return results;
}
