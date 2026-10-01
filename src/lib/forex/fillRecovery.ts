/**
 * Durable peer-fill for forex limit orders on standalone Mongo.
 *
 * The transactional fill path is atomic and needs nothing here. The
 * sequential fallback (standalone Mongo, no multi-document transactions) used
 * to claim the order with a bare `processing` flip and compensate only
 * caught errors: a process crash between two confirmed writes left the filler
 * debited, the poster possibly credited, and the order stuck in `processing`
 * with no retry possible and no record of what landed.
 *
 * This module fixes the crash path without duplicating the banking journal:
 *
 * 1. The claim carries the full intent (`ProcessingFillIntent`, written in
 *    the same findOneAndUpdate as the status flip), so a later attempt can
 *    finish or undo without recomputing from moved balances.
 * 2. Every forward money leg is stamped (the banking `settledKeys` pattern,
 *    forex-owned stamps): a resumed leg that already landed matches nothing
 *    and verifies as applied, so resume never double-debits or double-credits.
 * 3. Spread distribution reuses `distributeSpreadFee` with per-write stamps;
 *    the trade-history row is keyed by the stable claim key, so its insert is
 *    a no-op on replay.
 * 4. Only a stale claim is recoverable. Fresh claims (a live attempt, or a
 *    recovery already running) are never stolen.
 * 5. Rollback inverts landed legs only and restores open/partial. Anything
 *    that can be neither completed nor rolled back stays `processing` and is
 *    reported, never force-completed.
 *
 * Stable idempotency key: `forex-fill:{orderId}:{filledAmountBefore}`.
 * `filledAmount` is already the optimistic-concurrency token in the claim
 * filter, so the key is stable across retries and unique per fill.
 */

import { ObjectId } from "mongodb";
import type { ClientSession, Db, Filter, Document } from "mongodb";
import { SETTLED_KEYS_CAP, SETTLED_KEYS_FIELD } from "@/lib/banking/moneyMove";
import { buildPersonalBalanceInc } from "@/lib/currency/characterFunds";
import {
  SPREAD_FEE_FOREX_REVENUE_RATIO,
  SPREAD_FEE_RESERVE_RATIO,
} from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type {
  CurrencyOrder,
  ForexFillSpreadLegIntent,
  ProcessingFillIntent,
} from "@/lib/db/types/currencyOrder";
import { recordAudit } from "@/lib/audit/recordAudit";

/** A claim older than this with no live owner may be finished or undone. */
export const FILL_CLAIM_STALE_MS = 5 * 60 * 1000;

/** Upper bound on orders one sweeper pass touches. */
export const FILL_RECOVERY_SCAN_LIMIT = 50;

/** Stable per-fill key. `filledAmountBefore` is the claim's concurrency token. */
export function fillClaimKey(orderId: string, filledAmountBefore: number): string {
  return `forex-fill:${orderId}:${filledAmountBefore}`;
}

/** Per-claim leg stamp. The nonce keeps a re-claim after a rollback from
 * mistaking the rolled-back attempt's stamps for its own. */
export function fillLegStamp(key: string, nonce: string, leg: string): string {
  return `${key}#${nonce}#${leg}`;
}

function spreadStamps(
  key: string,
  nonce: string,
  index: number
): { revenue: string; reserve: string } {
  return {
    revenue: fillLegStamp(key, nonce, `spread${index}rev`),
    reserve: fillLegStamp(key, nonce, `spread${index}res`),
  };
}

/** True when the order holds a fill intent whose claim has gone stale. */
export function isFillClaimStale(order: CurrencyOrder, nowMs: number): boolean {
  if (order.status !== "processing" || !order.processingFillKey || !order.processingFill) {
    return false;
  }
  const claimedAt = new Date(order.processingFill.claimedAt).getTime();
  if (!Number.isFinite(claimedAt)) return false;
  return nowMs - claimedAt > FILL_CLAIM_STALE_MS;
}

export interface FillSpreadTuple {
  fee: number;
  source: CountryId;
  currency: CurrencyCode;
  dest?: CountryId;
}

export interface BuildFillIntentArgs {
  orderId: ObjectId;
  fillerId: ObjectId;
  posterId: ObjectId;
  statusBefore: "open" | "partial";
  filledAmountBefore: number;
  fillAmount: number;
  newFilledAmount: number;
  newStatus: "filled" | "partial";
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  toCurrencyAmount: number;
  posterSpread: number;
  fillerSpread: number;
  fillerTotalCost: number;
  spreadTuples: FillSpreadTuple[];
  rate: number;
  turn: number;
  now: Date;
  nonce?: string;
}

/** Assemble the durable intent from the fill's computed scalars. The money
 * math itself is unchanged from the route; this only records it. */
export function buildFillIntent(args: BuildFillIntentArgs): ProcessingFillIntent {
  const orderHex = args.orderId.toHexString();
  const nonce =
    args.nonce ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const spreadLegs: ForexFillSpreadLegIntent[] = args.spreadTuples.map((tuple) => {
    const split = {
      toReserveBalance: Math.round(tuple.fee * SPREAD_FEE_RESERVE_RATIO),
      toForexRevenue: Math.round(tuple.fee * SPREAD_FEE_FOREX_REVENUE_RATIO),
    };
    const reserveCountry = tuple.dest ?? tuple.source;
    return {
      fee: tuple.fee,
      sourceCountry: tuple.source,
      currency: tuple.currency,
      ...(tuple.dest ? { destCountry: tuple.dest } : {}),
      revenue: split.toForexRevenue,
      reserve: split.toReserveBalance,
      sameBank: getBankId(tuple.source) === getBankId(reserveCountry),
    };
  });
  return {
    key: fillClaimKey(orderHex, args.filledAmountBefore),
    nonce,
    orderId: orderHex,
    fillerId: args.fillerId.toHexString(),
    posterId: args.posterId.toHexString(),
    statusBefore: args.statusBefore,
    filledAmountBefore: args.filledAmountBefore,
    fillAmount: args.fillAmount,
    newFilledAmount: args.newFilledAmount,
    newStatus: args.newStatus,
    fromCurrency: args.fromCurrency,
    toCurrency: args.toCurrency,
    toCurrencyAmount: args.toCurrencyAmount,
    posterSpread: args.posterSpread,
    fillerSpread: args.fillerSpread,
    fillerTotalCost: args.fillerTotalCost,
    spreadLegs,
    trade: {
      buyerCharacterId: args.posterId.toHexString(),
      sellerCharacterId: args.fillerId.toHexString(),
      fromCurrency: args.fromCurrency,
      toCurrency: args.toCurrency,
      amount: args.fillAmount,
      rate: args.rate,
      spread: args.posterSpread,
      turn: args.turn,
      createdAt: args.now,
    },
    turn: args.turn,
    claimedAt: args.now,
  };
}

/**
 * Claim the order for the sequential path, writing the intent in the same
 * atomic write as the status flip. Returns the pre-claim document, or null
 * when another attempt owns the order.
 */
export async function claimFillWithIntent(
  db: Db,
  claimFilter: Filter<CurrencyOrder>,
  intent: ProcessingFillIntent,
  now: Date
): Promise<CurrencyOrder | null> {
  return db.collection<CurrencyOrder>("currencyOrders").findOneAndUpdate(
    claimFilter,
    {
      $set: {
        status: "processing",
        updatedAt: now,
        processingFillKey: intent.key,
        processingFill: intent,
      },
    },
    { returnDocument: "before" }
  );
}

type FillLegName = "filler" | "poster" | "spread" | "history";

export type FillApplyOutcome =
  | { ok: true; flipWon: boolean }
  | { ok: false; leg: FillLegName; message: string; status: 400 | 404 | 500 };

type SpreadDistributor = (
  db: Db,
  totalFee: number,
  sourceCountryId: CountryId,
  currencyCode: CurrencyCode,
  destinationCountryId?: CountryId,
  options?: {
    session?: ClientSession;
    stamps?: { revenue: string; reserve: string };
  }
) => Promise<{ destroyed: number; toCentralBank: number; toReserveBalance: number }>;

const defaultSpreadDistributor: SpreadDistributor = async (...args) => {
  const { distributeSpreadFee } = await import("@/lib/currency/spreadFees");
  return distributeSpreadFee(...args);
};

async function reverseFillSpreadFee(
  ...args: Parameters<typeof import("@/lib/currency/spreadFees").reverseSpreadFee>
): Promise<void> {
  const { reverseSpreadFee } = await import("@/lib/currency/spreadFees");
  await reverseSpreadFee(...args);
}

function fillerSettlementInc(intent: ProcessingFillIntent): Record<string, number> {
  return {
    ...buildPersonalBalanceInc(-intent.fillerTotalCost, intent.toCurrency, true),
    ...buildPersonalBalanceInc(intent.fillAmount - intent.posterSpread, intent.fromCurrency, true),
  };
}

function fillerRollbackInc(intent: ProcessingFillIntent): Record<string, number> {
  return {
    ...buildPersonalBalanceInc(intent.fillerTotalCost, intent.toCurrency, true),
    ...buildPersonalBalanceInc(
      -(intent.fillAmount - intent.posterSpread),
      intent.fromCurrency,
      true
    ),
  };
}

async function hasStamp(
  db: Db,
  collection: string,
  filter: Document,
  stamp: string
): Promise<boolean> {
  const found = await db
    .collection(collection)
    .findOne({ ...filter, [SETTLED_KEYS_FIELD]: stamp } as Filter<Document>, {
      projection: { _id: 1 },
    });
  return found !== null;
}

/**
 * Apply every forward leg of the intent idempotently, then attempt the final
 * flip. Landed legs match nothing and verify as applied, so the first attempt
 * and every resume run the same code and can never disagree about what a leg
 * does. Returns `flipWon: false` when another attempt flipped first; the
 * caller re-reads the order to learn the true state.
 */
export async function applyFillLegs(
  db: Db,
  intent: ProcessingFillIntent,
  now: Date = new Date(),
  distributeFee: SpreadDistributor = defaultSpreadDistributor
): Promise<FillApplyOutcome> {
  const fillerOid = new ObjectId(intent.fillerId);
  const posterOid = new ObjectId(intent.posterId);
  const orderOid = new ObjectId(intent.orderId);
  const fillerStamp = fillLegStamp(intent.key, intent.nonce, "filler");
  const posterStamp = fillLegStamp(intent.key, intent.nonce, "poster");

  // Filler settlement: guarded debit plus fromCurrency credit, one stamped
  // write. The $gte guard refuses an overdraw; the stamp refuses a replay.
  const fillerBalancePath = `currencyBalances.personal.${intent.toCurrency}`;
  const fillerRes = await db.collection("characters").updateOne(
    {
      _id: fillerOid,
      [fillerBalancePath]: { $gte: intent.fillerTotalCost },
      [SETTLED_KEYS_FIELD]: { $ne: fillerStamp },
    },
    {
      $inc: fillerSettlementInc(intent),
      $set: { updatedAt: now },
      $push: { [SETTLED_KEYS_FIELD]: { $each: [fillerStamp], $slice: -SETTLED_KEYS_CAP } },
    } as Document
  );
  if (fillerRes.matchedCount !== 1) {
    if (!(await hasStamp(db, "characters", { _id: fillerOid }, fillerStamp))) {
      return {
        ok: false,
        leg: "filler",
        message: `Insufficient ${intent.toCurrency} balance`,
        status: 400,
      };
    }
  }

  // Poster credit: unconditional amount, stamped so replay is a no-op.
  const posterRes = await db
    .collection("characters")
    .updateOne({ _id: posterOid, [SETTLED_KEYS_FIELD]: { $ne: posterStamp } }, {
      $inc: buildPersonalBalanceInc(intent.toCurrencyAmount, intent.toCurrency, true),
      $set: { updatedAt: now },
      $push: { [SETTLED_KEYS_FIELD]: { $each: [posterStamp], $slice: -SETTLED_KEYS_CAP } },
    } as Document);
  if (posterRes.matchedCount !== 1) {
    if (!(await hasStamp(db, "characters", { _id: posterOid }, posterStamp))) {
      return { ok: false, leg: "poster", message: "Order owner not found", status: 404 };
    }
  }

  // Spread fees: each distribution carries per-write stamps, so a crash
  // between the revenue and reserve writes resumes exactly the missing half.
  for (const [index, leg] of intent.spreadLegs.entries()) {
    try {
      await distributeFee(db, leg.fee, leg.sourceCountry, leg.currency, leg.destCountry, {
        stamps: spreadStamps(intent.key, intent.nonce, index),
      });
    } catch (error) {
      return {
        ok: false,
        leg: "spread",
        message: error instanceof Error ? error.message : String(error),
        status: 500,
      };
    }
  }

  // History: keyed by the stable claim key, so a replay insert is a no-op.
  try {
    await db.collection<{ _id: string } & Document>("tradeHistory").insertOne({
      _id: intent.key,
      buyerCharacterId: new ObjectId(intent.trade.buyerCharacterId),
      sellerCharacterId: new ObjectId(intent.trade.sellerCharacterId),
      fromCurrency: intent.trade.fromCurrency,
      toCurrency: intent.trade.toCurrency,
      amount: intent.trade.amount,
      rate: intent.trade.rate,
      spread: intent.trade.spread,
      turn: intent.trade.turn,
      createdAt: intent.trade.createdAt,
      source: "limit_order",
    });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code !== 11000) {
      return {
        ok: false,
        leg: "history",
        message: error instanceof Error ? error.message : String(error),
        status: 500,
      };
    }
  }

  // Final flip, guarded on the pre-fill state. Clearing the intent in the
  // same write makes replay-after-success a no-op: the order is no longer
  // `processing` with this key.
  const flipRes = await db.collection<CurrencyOrder>("currencyOrders").updateOne(
    { _id: orderOid, status: "processing", filledAmount: intent.filledAmountBefore },
    {
      $set: { status: intent.newStatus, updatedAt: now },
      $inc: { filledAmount: intent.fillAmount, spreadCharged: intent.posterSpread },
      $unset: { processingFillKey: "", processingFill: "" },
    }
  );
  return { ok: true, flipWon: flipRes.matchedCount === 1 };
}

export interface FillLegState {
  filler: boolean;
  poster: boolean;
  spread: boolean[];
  history: boolean;
}

/** Read which legs of the intent demonstrably landed, from the stamps. */
export async function verifyFillLegs(db: Db, intent: ProcessingFillIntent): Promise<FillLegState> {
  const fillerStamp = fillLegStamp(intent.key, intent.nonce, "filler");
  const posterStamp = fillLegStamp(intent.key, intent.nonce, "poster");
  const [filler, poster] = await Promise.all([
    hasStamp(db, "characters", { _id: new ObjectId(intent.fillerId) }, fillerStamp),
    hasStamp(db, "characters", { _id: new ObjectId(intent.posterId) }, posterStamp),
  ]);
  const spread: boolean[] = [];
  for (const [index, leg] of intent.spreadLegs.entries()) {
    if (leg.fee <= 0) {
      spread.push(true);
      continue;
    }
    const stamps = spreadStamps(intent.key, intent.nonce, index);
    const sourceBankId = getBankId(leg.sourceCountry);
    const reserveBankId = getBankId(leg.destCountry ?? leg.sourceCountry);
    if (leg.sameBank) {
      spread.push(await hasStamp(db, "centralBanks", { _id: sourceBankId }, stamps.revenue));
      continue;
    }
    const needRevenue = leg.revenue !== 0;
    const needReserve = leg.reserve > 0;
    const [revenueLanded, reserveLanded] = await Promise.all([
      needRevenue
        ? hasStamp(db, "centralBanks", { _id: sourceBankId }, stamps.revenue)
        : Promise.resolve(true),
      needReserve
        ? hasStamp(db, "centralBanks", { _id: reserveBankId }, stamps.reserve)
        : Promise.resolve(true),
    ]);
    spread.push(revenueLanded && reserveLanded);
  }
  const history =
    (await db
      .collection<{ _id: string } & Document>("tradeHistory")
      .findOne({ _id: intent.key }, { projection: { _id: 1 } })) !== null;
  return { filler, poster, spread, history };
}

function allLegsApplied(state: FillLegState): boolean {
  return state.filler && state.poster && state.spread.every(Boolean) && state.history;
}

function orderCompleted(order: CurrencyOrder | null, intent: ProcessingFillIntent): boolean {
  return (
    order !== null &&
    order.status === intent.newStatus &&
    order.filledAmount === intent.newFilledAmount &&
    !order.processingFillKey
  );
}

export type RecoverFillOutcome =
  | { outcome: "completed"; fillAmount: number; orderStatus: "filled" | "partial" }
  | { outcome: "rolled-back" }
  | { outcome: "live-claim" }
  | { outcome: "recovery-in-progress" }
  | { outcome: "nothing-to-do" }
  | { outcome: "unresolvable"; error: string };

/**
 * Take rollback ownership of a stale claim. Completion needs none (every
 * forward write is idempotent), but rollback reverses unconditionally, so
 * exactly one recoverer may run it. Returns the ownership token, or null
 * when another live recovery owns the claim.
 */
async function takeRecoveryOwnership(
  db: Db,
  order: CurrencyOrder,
  intent: ProcessingFillIntent,
  now: Date
): Promise<string | null> {
  const current = order.processingFill;
  if (
    current?.recoveryKey &&
    current.recoveryAt &&
    now.getTime() - new Date(current.recoveryAt).getTime() < FILL_CLAIM_STALE_MS
  ) {
    return null;
  }
  const token = `recover-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const filter = (
    current?.recoveryKey
      ? {
          _id: order._id,
          status: "processing",
          processingFillKey: intent.key,
          "processingFill.recoveryKey": current.recoveryKey,
        }
      : {
          _id: order._id,
          status: "processing",
          processingFillKey: intent.key,
          "processingFill.recoveryKey": { $exists: false },
        }
  ) as Filter<CurrencyOrder>;
  const res = await db.collection<CurrencyOrder>("currencyOrders").updateOne(filter, {
    $set: { "processingFill.recoveryKey": token, "processingFill.recoveryAt": now },
  });
  return res.matchedCount === 1 ? token : null;
}

function auditFillRecovery(intent: ProcessingFillIntent, outcome: string, error?: string): void {
  recordAudit({
    source: "api",
    action: "forex.fill.recover",
    category: "market",
    subject: {
      type: "currencyOrder",
      id: new ObjectId(intent.orderId),
      name: `${intent.fromCurrency}->${intent.toCurrency}`,
    },
    counterparty: { type: "character", id: new ObjectId(intent.fillerId), name: undefined },
    amount: intent.fillAmount,
    currencyCode: intent.fromCurrency,
    delta: [
      { field: "recovery", before: "processing", after: outcome },
      { field: "fillAmount", before: null, after: intent.fillAmount },
    ],
    ...(error ? { reason: error } : {}),
    outcome: outcome === "completed" || outcome === "rolled-back" ? "ok" : "error",
  });
}

/**
 * Finish or undo a crashed peer fill. Idempotent: safe to call from any fill
 * or cancel attempt that meets a stale `processing` claim, from the turn
 * sweeper, and from the admin recover route.
 *
 * Once any money leg has landed the fill completes forward; when nothing
 * moved it rolls back to open/partial. States that can be neither completed
 * nor rolled back stay `processing` and are reported, never force-completed.
 */
export async function recoverFillClaim(
  db: Db,
  orderId: ObjectId,
  now: Date = new Date()
): Promise<RecoverFillOutcome> {
  const order = await db.collection<CurrencyOrder>("currencyOrders").findOne({ _id: orderId });
  if (
    !order ||
    order.status !== "processing" ||
    !order.processingFillKey ||
    !order.processingFill
  ) {
    return { outcome: "nothing-to-do" };
  }
  const intent = order.processingFill;
  if (intent.key !== order.processingFillKey) {
    return { outcome: "unresolvable", error: "fill intent key does not match the claim" };
  }
  if (!isFillClaimStale(order, now.getTime())) {
    return { outcome: "live-claim" };
  }

  // Verify before moving anything: recovery completes forward only when a
  // money leg demonstrably landed. When nothing moved, restoring the order
  // must not move money either — a resumed debit the record cannot prove
  // would mint value to the poster from nothing.
  const pre = await verifyFillLegs(db, intent);
  if (!pre.filler && !pre.poster) {
    const owned = await takeRecoveryOwnership(db, order, intent, now);
    if (!owned) return { outcome: "recovery-in-progress" };
    try {
      await reverseLandedFillLegs(db, intent, now);
      await restoreFillClaim(db, intent, now);
    } catch (error) {
      return {
        outcome: "unresolvable",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    auditFillRecovery(intent, "rolled-back");
    return { outcome: "rolled-back" };
  }

  // Forward pass, safe under concurrency: every write is idempotent.
  const applied = await applyFillLegs(db, intent, now);
  if (applied.ok && applied.flipWon) {
    auditFillRecovery(intent, "completed");
    return { outcome: "completed", fillAmount: intent.fillAmount, orderStatus: intent.newStatus };
  }
  const reread = await db.collection<CurrencyOrder>("currencyOrders").findOne({ _id: orderId });
  if (orderCompleted(reread, intent)) {
    return { outcome: "completed", fillAmount: intent.fillAmount, orderStatus: intent.newStatus };
  }
  const state = await verifyFillLegs(db, intent);
  if (allLegsApplied(state)) {
    // Every leg demonstrably landed but the flip did not stick: either the
    // claim moved under us (reread would have shown completed) or the flip
    // raced. Money has moved, so rolling back is no longer the safe side;
    // retry the guarded flip once under ownership instead of undoing.
    const owned = await takeRecoveryOwnership(db, reread ?? order, intent, now);
    if (!owned) return { outcome: "recovery-in-progress" };
    const flip = await db.collection<CurrencyOrder>("currencyOrders").updateOne(
      { _id: orderId, status: "processing", filledAmount: intent.filledAmountBefore },
      {
        $set: { status: intent.newStatus, updatedAt: now },
        $inc: { filledAmount: intent.fillAmount, spreadCharged: intent.posterSpread },
        $unset: { processingFillKey: "", processingFill: "" },
      }
    );
    if (flip.matchedCount === 1) {
      auditFillRecovery(intent, "completed");
      return { outcome: "completed", fillAmount: intent.fillAmount, orderStatus: intent.newStatus };
    }
    const settled = await db.collection<CurrencyOrder>("currencyOrders").findOne({ _id: orderId });
    if (orderCompleted(settled, intent)) {
      return { outcome: "completed", fillAmount: intent.fillAmount, orderStatus: intent.newStatus };
    }
    return { outcome: "unresolvable", error: "all fill legs applied but the final flip refused" };
  }

  // Not everything landed: roll back the legs that did, under ownership.
  const owned = await takeRecoveryOwnership(db, reread ?? order, intent, now);
  if (!owned) return { outcome: "recovery-in-progress" };
  // Re-verify under ownership: a concurrent recoverer may have finished.
  const current = await db.collection<CurrencyOrder>("currencyOrders").findOne({ _id: orderId });
  if (orderCompleted(current, intent)) {
    return { outcome: "completed", fillAmount: intent.fillAmount, orderStatus: intent.newStatus };
  }
  const ownedState = await verifyFillLegs(db, intent);
  if (allLegsApplied(ownedState)) {
    const flip = await db.collection<CurrencyOrder>("currencyOrders").updateOne(
      { _id: orderId, status: "processing", filledAmount: intent.filledAmountBefore },
      {
        $set: { status: intent.newStatus, updatedAt: now },
        $inc: { filledAmount: intent.fillAmount, spreadCharged: intent.posterSpread },
        $unset: { processingFillKey: "", processingFill: "" },
      }
    );
    if (flip.matchedCount === 1) {
      auditFillRecovery(intent, "completed");
      return { outcome: "completed", fillAmount: intent.fillAmount, orderStatus: intent.newStatus };
    }
    return { outcome: "unresolvable", error: "fill completed under recovery but the flip refused" };
  }

  try {
    await reverseLandedFillLegs(db, intent, now);
    await restoreFillClaim(db, intent, now);
  } catch (error) {
    return {
      outcome: "unresolvable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
  auditFillRecovery(intent, "rolled-back");
  return { outcome: "rolled-back" };
}

/**
 * Reverse every leg of the intent that demonstrably landed, then delete the
 * keyed history row. Shared by crash recovery and by the live attempt's
 * error-path compensation, so the two can never disagree about what "undo"
 * means. Throws when a landed leg cannot be reversed; the claim stays
 * `processing` and the failure is reported, never force-completed.
 */
export async function reverseLandedFillLegs(
  db: Db,
  intent: ProcessingFillIntent,
  now: Date = new Date()
): Promise<void> {
  const errors: unknown[] = [];
  const state = await verifyFillLegs(db, intent);
  if (state.filler) {
    const res = await db
      .collection("characters")
      .updateOne(
        { _id: new ObjectId(intent.fillerId) },
        { $inc: fillerRollbackInc(intent), $set: { updatedAt: now } }
      );
    if (res.matchedCount !== 1) {
      errors.push(new Error("filler debit landed but the filler is gone"));
    }
  }
  if (state.poster) {
    const res = await db.collection("characters").updateOne(
      { _id: new ObjectId(intent.posterId) },
      {
        $inc: buildPersonalBalanceInc(-intent.toCurrencyAmount, intent.toCurrency, true),
        $set: { updatedAt: now },
      }
    );
    if (res.matchedCount !== 1) {
      errors.push(new Error("poster credit landed but the poster is gone"));
    }
  }
  // Complete-then-reverse: finish any half-distributed spread leg
  // idempotently first, so the reversal removes exactly what landed.
  for (const [index, leg] of intent.spreadLegs.entries()) {
    try {
      await defaultSpreadDistributor(
        db,
        leg.fee,
        leg.sourceCountry,
        leg.currency,
        leg.destCountry,
        {
          stamps: spreadStamps(intent.key, intent.nonce, index),
        }
      );
      await reverseFillSpreadFee(db, leg.fee, leg.sourceCountry, leg.currency, leg.destCountry);
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await db.collection<{ _id: string } & Document>("tradeHistory").deleteOne({ _id: intent.key });
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "One or more landed fill legs could not be reversed");
  }
}

/**
 * Restore a claimed order to its pre-fill status and clear the intent.
 * Guarded on this claim still owning the order.
 */
export async function restoreFillClaim(
  db: Db,
  intent: ProcessingFillIntent,
  now: Date = new Date()
): Promise<void> {
  const restored = await db.collection<CurrencyOrder>("currencyOrders").updateOne(
    { _id: new ObjectId(intent.orderId), status: "processing", processingFillKey: intent.key },
    {
      $set: { status: intent.statusBefore, updatedAt: now },
      $unset: { processingFillKey: "", processingFill: "" },
    }
  );
  if (restored.matchedCount !== 1) {
    throw new Error("Forex order status could not be restored after a failed fill");
  }
}

export interface FillRecoverySummary {
  scanned: number;
  completed: string[];
  rolledBack: string[];
  unresolvable: Array<{ orderId: string; error: string }>;
}

/**
 * Sweeper entry point (forex turn + admin recover route): finish or undo
 * every stale intent-carrying `processing` order. Fresh claims are left
 * alone; unresolvable intents stay visible in the summary and on the order.
 */
export async function recoverStaleFillClaims(
  db: Db,
  now: Date = new Date()
): Promise<FillRecoverySummary> {
  const summary: FillRecoverySummary = {
    scanned: 0,
    completed: [],
    rolledBack: [],
    unresolvable: [],
  };
  const stuck = await db
    .collection<CurrencyOrder>("currencyOrders")
    .find({ status: "processing", processingFillKey: { $exists: true } })
    .limit(FILL_RECOVERY_SCAN_LIMIT)
    .toArray();
  for (const order of stuck) {
    summary.scanned += 1;
    if (!isFillClaimStale(order, now.getTime())) continue;
    try {
      const result = await recoverFillClaim(db, order._id, now);
      if (result.outcome === "completed") summary.completed.push(order._id.toHexString());
      else if (result.outcome === "rolled-back") summary.rolledBack.push(order._id.toHexString());
      else if (result.outcome === "unresolvable") {
        summary.unresolvable.push({ orderId: order._id.toHexString(), error: result.error });
      }
    } catch (error) {
      summary.unresolvable.push({
        orderId: order._id.toHexString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return summary;
}

/**
 * Crash-hardened cancel refund: stamped, so a cancel that crashes after the
 * refund and is reset to open by the turn sweeper does not refund twice on
 * the retry. Returns true when this call delivered the refund.
 */
export async function applyCancelRefund(
  db: Db,
  characterId: ObjectId,
  currency: CurrencyCode,
  amount: number,
  cancelKey: string,
  now: Date = new Date()
): Promise<boolean> {
  if (amount <= 0) return true;
  const stamp = `${cancelKey}#refund`;
  const res = await db
    .collection("characters")
    .updateOne({ _id: characterId, [SETTLED_KEYS_FIELD]: { $ne: stamp } }, {
      $inc: buildPersonalBalanceInc(amount, currency, true),
      $set: { updatedAt: now },
      $push: { [SETTLED_KEYS_FIELD]: { $each: [stamp], $slice: -SETTLED_KEYS_CAP } },
    } as Document);
  return res.matchedCount === 1;
}

/** Stable cancel idempotency key. The escrow amount is fixed at creation, so
 * the order id alone identifies the refund. */
export function cancelClaimKey(orderId: string): string {
  return `forex-cancel:${orderId}`;
}
