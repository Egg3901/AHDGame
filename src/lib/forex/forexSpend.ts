import { randomUUID } from "node:crypto";
import type { ClientSession, Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import {
  DIRECT_TRADE_SPREAD,
  LIMIT_ORDER_SPREAD,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  applyIdempotentLeg,
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  failMoneyFlowReceipt,
  keyedInsertId,
  makeInsertStep,
  makeLegStep,
  runMoneyFlowSteps,
  type MoneyFlowLegOutcome,
  type MoneyFlowOptions,
  type MoneyFlowStep,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import {
  calculateSpreadFee,
  makeSpreadDistributionStepsForFees,
  type SpreadDistributionSpec,
} from "@/lib/currency/spreadFees";
import { getCountryForCurrency } from "@/lib/currency/marketMaker";
import type { Character, CurrencyOrder, TradeHistoryEntry } from "@/lib/db/types";

/** Escrow debit failed: balance raced, or the character row is gone. */
export const FOREX_ORDER_INSUFFICIENT = "FOREX_ORDER_INSUFFICIENT";
/** Order-row insert failed after the escrow landed (prefix compensated). */
export const FOREX_ORDER_RECORD = "FOREX_ORDER_RECORD";
/** Peer fill cannot run: missing order, wrong type/status, or empty remainder. */
export const FOREX_FILL_ORDER_MISSING = "FOREX_FILL_ORDER_MISSING";
export const FOREX_FILL_UNAVAILABLE = "FOREX_FILL_UNAVAILABLE";
/** Taker balance failed (pre-check or raced at step time). */
export const FOREX_FILL_INSUFFICIENT = "FOREX_FILL_INSUFFICIENT";
/** Fill lost the order-step race after moving money (prefix compensated). */
export const FOREX_FILL_RACED = "FOREX_FILL_RACED";
/** Poster row is gone (taker leg refunded by compensation). */
export const FOREX_FILL_OWNER_MISSING = "FOREX_FILL_OWNER_MISSING";
/** Fill history/spread step failed after money moved (prefix compensated). */
export const FOREX_FILL_RECORD = "FOREX_FILL_RECORD";
export const FOREX_FILL_SPREAD = "FOREX_FILL_SPREAD";
/** Cancel/decline cannot run: missing order or not open/partial. */
export const FOREX_CANCEL_ORDER_MISSING = "FOREX_CANCEL_ORDER_MISSING";
export const FOREX_CANCEL_UNAVAILABLE = "FOREX_CANCEL_UNAVAILABLE";
/** Direct accept cannot run: missing/wrong-type/closed request, poor target. */
export const FOREX_DIRECT_ORDER_MISSING = "FOREX_DIRECT_ORDER_MISSING";
export const FOREX_DIRECT_WRONG_TYPE = "FOREX_DIRECT_WRONG_TYPE";
export const FOREX_DIRECT_UNAVAILABLE = "FOREX_DIRECT_UNAVAILABLE";
export const FOREX_DIRECT_INSUFFICIENT = "FOREX_DIRECT_INSUFFICIENT";
export const FOREX_DIRECT_RECORD = "FOREX_DIRECT_RECORD";
export const FOREX_DIRECT_SPREAD = "FOREX_DIRECT_SPREAD";

function resolveKey(idempotencyKey: string | undefined, label: string): string {
  const key = idempotencyKey !== undefined ? idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError(`${label} idempotency key must be 1-128 characters`);
  }
  return key;
}

function personalField(currency: CurrencyCode): string {
  return `currencyBalances.personal.${currency}`;
}

function personalBalance(
  doc: { currencyBalances?: { personal?: Partial<Record<CurrencyCode, number>> } } | null,
  currency: CurrencyCode
): number {
  return doc?.currencyBalances?.personal?.[currency] ?? 0;
}

// ── Order creation (limit orders + direct requests) ─────────────────────────

export interface ForexOrderCreateInput {
  characterId: ObjectId;
  characterName: string;
  countryId: CountryId;
  orderType: "limit" | "direct";
  direction: "buy" | "sell";
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  /** Amount of fromCurrency escrowed. */
  amount: number;
  /** Worst acceptable rate (limit) or proposed rate (direct). */
  limitRate: number;
  targetCharacterId?: ObjectId;
  targetCharacterName?: string;
  expiresAtTurn?: number;
  now: Date;
  /**
   * Caller-chosen fingerprint of the intended order, built from stable
   * request inputs (never from the turn-derived expiry math — use the raw
   * `expiresInTurns` input so a same-key retry on a later turn still matches).
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same order replays the stored order id instead of
   * escrowing again. Omit to mint one.
   */
  idempotencyKey?: string;
}

function mapOrderCreateError(step: MoneyFlowStep, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical surface: a failed escrow debit was `Insufficient
  // <ccy> balance` (400). A failed order insert refunded the escrow and threw
  // (500); compensation does the refund here.
  if (step.name === "escrow-debit") return new Error(`${FOREX_ORDER_INSUFFICIENT}:${outcome}`);
  return new Error(`${FOREX_ORDER_RECORD}:${outcome}`);
}

/**
 * Escrow fromCurrency and record a limit order or direct-trade request so the
 * result is exactly-once on every topology (issue #1672). The order `_id`
 * derives from the key, so a client retry replays the same order id instead
 * of opening a second escrowed order.
 *
 * Under real transactions the debit, the order insert, and the idempotency
 * receipt join the transaction and commit atomically, preserving the old
 * behavior. On a standalone deployment the fallback runs the same writes as
 * keyed idempotent steps: a crash between the debit and the insert leaves an
 * `in_progress` receipt, and retrying with the same key reconciles to exactly
 * one escrowed order. A retry after a terminal failure throws
 * `MoneyFlowTerminalError` (fail closed); a new attempt needs a new key.
 */
export async function applyForexOrderCreateSpend(
  db: Db,
  input: ForexOrderCreateInput
): Promise<{ duplicate: boolean; orderId: ObjectId }> {
  if (!input.characterId) throw new TypeError("Forex order spend needs characterId");
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new RangeError("Forex order amount must be positive");
  }
  if (!Number.isFinite(input.limitRate) || input.limitRate <= 0) {
    throw new RangeError("Forex order rate must be positive");
  }
  const key = resolveKey(input.idempotencyKey, "Forex order");
  const orderId = keyedInsertId(key, "forex-order");

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const characters = db.collection<Character>("characters");
  const orders = db.collection<CurrencyOrder>("currencyOrders");
  const now = input.now;

  const order: CurrencyOrder = {
    _id: orderId,
    characterId: input.characterId,
    characterName: input.characterName,
    countryId: input.countryId,
    type: input.orderType,
    direction: input.direction,
    fromCurrency: input.fromCurrency,
    toCurrency: input.toCurrency,
    amount: input.amount,
    limitRate: input.limitRate,
    ...(input.targetCharacterId ? { targetCharacterId: input.targetCharacterId } : {}),
    ...(input.targetCharacterName ? { targetCharacterName: input.targetCharacterName } : {}),
    // Mirror the legacy construction (key present with an undefined value
    // when no expiry was requested) so the stored BSON shape is unchanged.
    expiresAtTurn: input.expiresAtTurn,
    status: "open",
    filledAmount: 0,
    spreadCharged: 0,
    createdAt: now,
    updatedAt: now,
  };

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    if (claim === "duplicate") return { duplicate: true as boolean, orderId };
    await runMoneyFlowSteps(
      receipts,
      key,
      [
        makeLegStep(key, {
          name: "escrow-debit",
          collection: characters,
          docId: input.characterId,
          field: personalField(input.fromCurrency),
          delta: -input.amount,
          minBalance: input.amount,
        }),
        makeInsertStep("order-row", orders, order),
      ],
      mapOrderCreateError,
      opts
    );
    return { duplicate: claim === "in-progress", orderId };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}

// ── Fills (peer limit fills + direct-trade accepts) ──────────────────────────

export type ForexFillKind = "limit" | "direct";

export interface ForexFillInput {
  kind: ForexFillKind;
  orderId: ObjectId;
  /** Filler (limit) or target (direct) character taking the other side. */
  takerCharacterId: ObjectId;
  /** Amount of the order's fromCurrency to fill; omit for the full remainder. */
  requestedAmount?: number;
  now: Date;
  turn: number;
  /**
   * Caller-chosen fingerprint of the intended fill
   * (e.g. `forex-fill:<orderId>:<takerId>:<requested ?? "full">`). A retry
   * presenting the same key with a different fingerprint is rejected instead
   * of returning the stored outcome for the wrong fill.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same fill replays the stored outcome instead of
   * moving money again. Omit to mint one.
   */
  idempotencyKey?: string;
}

export interface ForexFillResult {
  duplicate: boolean;
  fillAmount: number;
  rate: number;
  /** Spread skimmed from the maker's escrow (fromCurrency). */
  makerSpread: number;
  /** Spread paid by the taker on top (toCurrency). */
  takerSpread: number;
  orderStatus: CurrencyOrder["status"];
}

function mapFillError(kind: ForexFillKind) {
  const insufficient = kind === "limit" ? FOREX_FILL_INSUFFICIENT : FOREX_DIRECT_INSUFFICIENT;
  const raced = kind === "limit" ? FOREX_FILL_RACED : FOREX_DIRECT_UNAVAILABLE;
  const record = kind === "limit" ? FOREX_FILL_RECORD : FOREX_DIRECT_RECORD;
  const spread = kind === "limit" ? FOREX_FILL_SPREAD : FOREX_DIRECT_SPREAD;
  // Limit only: a missing poster was `Order owner not found` (404). The
  // direct maker-credit maps a vanished sender to already-applied itself, so
  // this outcome is unreachable there.
  const ownerMissing = kind === "limit" ? FOREX_FILL_OWNER_MISSING : record;
  return (step: MoneyFlowStep, outcome: MoneyFlowLegOutcome): Error => {
    // Preserve the historical surface: a raced taker debit was `Insufficient
    // <ccy> balance` (400); a lost order race was `Order was already filled
    // by another trader` / `Trade request is no longer open` (400); a
    // missing poster was `Order owner not found` (404, limit only — the
    // direct path never checked the sender credit). Anything after money
    // moved compensates the prefix instead of stranding a half-landed fill.
    if (step.name === "taker-settle") return new Error(`${insufficient}:${outcome}`);
    if (step.name === "maker-credit") return new Error(`${ownerMissing}:${outcome}`);
    if (step.name === "order-fill") return new Error(`${raced}:${outcome}`);
    if (step.name === "trade-record") return new Error(`${record}:${outcome}`);
    return new Error(`${spread}:${step.name}:${outcome}`);
  };
}

/**
 * Fill (or partially fill) another player's limit order, or accept a direct
 * trade request, so the result is exactly-once on every topology (issue
 * #1672).
 *
 * Conservation: the maker escrowed `amount` fromCurrency at creation. The
 * taker pays `toCurrencyAmount + takerSpread`; the taker receives
 * `fillAmount - makerSpread` and the maker's CB slice routes `makerSpread`
 * (so `fillAmount` out of escrow splits exactly into taker credit + CB
 * slice), while the maker receives `toCurrencyAmount`. Spreads keep the
 * historical half-each split and the historical
 * `distributeSpreadFee` routing, now as keyed steps so a same-key retry or a
 * concurrent fill/cancel race cannot double-route a slice the skim collected
 * once.
 *
 * Races: the order transition is one atomic guarded write (status +
 * `filledAmount` exact match for limit fills, status for direct accepts), so
 * a concurrent fill or cancel either wins outright or guard-rejects and
 * compensates its own legs — the loser never leaves money moved. The legacy
 * `processing` intermediate status is gone: it only ever marked crashed
 * attempts, and the `in_progress` receipt now owns that job (the turn's
 * stuck-`processing` recovery is untouched and still heals legacy rows).
 */
export async function applyForexFillSpend(
  db: Db,
  input: ForexFillInput
): Promise<ForexFillResult> {
  if (!input.orderId || !input.takerCharacterId) {
    throw new TypeError("Forex fill spend needs orderId and takerCharacterId");
  }
  if (input.requestedAmount !== undefined && !Number.isFinite(input.requestedAmount)) {
    throw new RangeError("Forex fill amount must be finite");
  }
  const key = resolveKey(input.idempotencyKey, "Forex fill");
  const historyId = keyedInsertId(key, input.kind === "limit" ? "forex-fill" : "forex-direct");
  const spreadRate = input.kind === "limit" ? LIMIT_ORDER_SPREAD : DIRECT_TRADE_SPREAD;
  const halfSpreadRate = spreadRate / 2;

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const characters = db.collection<Character>("characters");
  const orders = db.collection<CurrencyOrder>("currencyOrders");
  const history = db.collection<TradeHistoryEntry>("tradeHistory");
  const now = input.now;

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    // A fresh claim owns the attempt, so a validation failure settles the
    // receipt `failed` (nothing applied yet — truthful). A resumed
    // `in-progress` claim never settles here: the crashed prefix may have
    // moved money, so it reconciles through the keyed steps below instead.
    const fresh = claim === "fresh";
    const fail = async (sentinel: string): Promise<never> => {
      if (fresh) await failMoneyFlowReceipt(receipts, key, sentinel, opts);
      throw new Error(sentinel);
    };
    if (claim === "duplicate") {
      // Replay the stored outcome without touching balances or live state:
      // the history row is deterministic per key, and the taker spread
      // recomputes exactly from its stored amount + rate.
      const stored = await history.findOne({ _id: historyId }, opts);
      if (!stored) throw new Error("FOREX_FILL_RECEIPT_ORPHANED");
      const storedTakerSpread = calculateSpreadFee(
        stored.amount * stored.rate,
        (input.kind === "limit" ? LIMIT_ORDER_SPREAD : DIRECT_TRADE_SPREAD) / 2
      );
      const live = await orders.findOne(
        { _id: input.orderId },
        { ...opts, projection: { status: 1 } }
      );
      return {
        duplicate: true as boolean,
        fillAmount: stored.amount,
        rate: stored.rate,
        makerSpread: stored.spread,
        takerSpread: storedTakerSpread,
        orderStatus: (live?.status ?? "filled") as CurrencyOrder["status"],
      };
    }

    const order = await orders.findOne({ _id: input.orderId }, opts);
    if (!order) {
      const error =
        input.kind === "limit" ? FOREX_FILL_ORDER_MISSING : FOREX_DIRECT_ORDER_MISSING;
      return fail(error);
    }
    if (input.kind === "limit" ? order.type !== "limit" : order.type !== "direct") {
      const error =
        input.kind === "limit"
          ? `${FOREX_FILL_UNAVAILABLE}:not-limit`
          : FOREX_DIRECT_WRONG_TYPE;
      return fail(error);
    }
    const statusOpen =
      input.kind === "limit"
        ? order.status === "open" || order.status === "partial"
        : order.status === "open";
    if (!statusOpen) {
      const error =
        input.kind === "limit"
          ? `${FOREX_FILL_UNAVAILABLE}:not-open`
          : FOREX_DIRECT_UNAVAILABLE;
      return fail(error);
    }

    const remaining = order.amount - order.filledAmount;
    const fillAmount =
      input.requestedAmount !== undefined
        ? Math.min(input.requestedAmount, remaining)
        : remaining;
    if (!(fillAmount > 0)) {
      const error =
        input.kind === "limit" ? `${FOREX_FILL_UNAVAILABLE}:empty` : FOREX_DIRECT_UNAVAILABLE;
      return fail(error);
    }

    const rate = order.limitRate;
    if (rate === undefined) {
      return fail(
        input.kind === "limit" ? `${FOREX_FILL_UNAVAILABLE}:no-rate` : FOREX_DIRECT_UNAVAILABLE
      );
    }
    // The taker provides toCurrency and receives fromCurrency at the order's
    // rate; each side pays half the spread in its own denomination.
    const toCurrencyAmount = fillAmount * rate;
    const makerSpread = calculateSpreadFee(fillAmount, halfSpreadRate);
    const takerSpread = calculateSpreadFee(toCurrencyAmount, halfSpreadRate);
    const takerTotalCost = toCurrencyAmount + takerSpread;
    const takerCredit = fillAmount - makerSpread;

    const taker = await characters.findOne({ _id: input.takerCharacterId }, opts);
    const takerHave = personalBalance(taker, order.toCurrency);
    if (takerHave < takerTotalCost) {
      const error =
        input.kind === "limit" ? FOREX_FILL_INSUFFICIENT : FOREX_DIRECT_INSUFFICIENT;
      // Embed the fresh need/have so routes render the historical
      // `Need <ceil>, have <floor>` message from exact numbers.
      return fail(`${error}:precheck:${takerTotalCost}:${takerHave}`);
    }

    const newFilledAmount = order.filledAmount + fillAmount;
    const newStatus: CurrencyOrder["status"] =
      input.kind === "direct" || newFilledAmount >= order.amount ? "filled" : "partial";

    const fromCountryId = getCountryForCurrency(order.fromCurrency);
    const toCountryId = getCountryForCurrency(order.toCurrency);

    // Half-spread routing specs for the merged per-bank spread steps below.
    const spreadSpecs: SpreadDistributionSpec[] = [];
    if (fromCountryId) {
      spreadSpecs.push({
        totalFee: makerSpread,
        sourceCountryId: fromCountryId,
        currencyCode: order.fromCurrency,
        ...(toCountryId ? { destinationCountryId: toCountryId } : {}),
      });
    }
    if (toCountryId) {
      spreadSpecs.push({
        totalFee: takerSpread,
        sourceCountryId: toCountryId,
        currencyCode: order.toCurrency,
        ...(fromCountryId ? { destinationCountryId: fromCountryId } : {}),
      });
    }

    const makerStep: MoneyFlowStep =
      input.kind === "direct"
        ? {
            // The legacy direct-accept never checked the sender credit, so a
            // vanished sender still settles (its escrow died with the
            // account); anything credited to a live account reverts normally.
            name: "maker-credit",
            apply: async (stepOpts) => {
              const outcome = await applyIdempotentLeg(
                key,
                {
                  name: "maker-credit",
                  collection: characters,
                  docId: order.characterId,
                  field: personalField(order.toCurrency),
                  delta: toCurrencyAmount,
                },
                stepOpts ?? {}
              );
              return outcome === "missing" ? "already-applied" : outcome;
            },
            revert: (stepOpts) =>
              applyIdempotentLeg(
                `${key}:compensate:maker-credit`,
                {
                  name: "maker-credit",
                  collection: characters,
                  docId: order.characterId,
                  field: personalField(order.toCurrency),
                  delta: -toCurrencyAmount,
                },
                stepOpts ?? {}
              ),
          }
        : makeLegStep(key, {
            name: "maker-credit",
            collection: characters,
            docId: order.characterId,
            field: personalField(order.toCurrency),
            delta: toCurrencyAmount,
          });

    const orderFilter =
      input.kind === "limit"
        ? { _id: order._id, status: { $in: ["open", "partial"] as const }, filledAmount: order.filledAmount }
        : { _id: order._id, status: "open" as const };
    const orderUpdate =
      input.kind === "limit"
        ? {
            $inc: { filledAmount: fillAmount, spreadCharged: makerSpread },
            $set: { status: newStatus, updatedAt: now },
          }
        : {
            // Mirror the legacy accept write (snapshot `$set`, not `$inc`).
            $set: {
              status: newStatus,
              filledAmount: order.amount,
              filledRate: rate,
              spreadCharged: makerSpread,
              updatedAt: now,
            },
          };
    const orderInverse =
      input.kind === "limit"
        ? {
            $inc: { filledAmount: -fillAmount, spreadCharged: -makerSpread },
            $set: { status: order.status, updatedAt: order.updatedAt },
          }
        : {
            $set: {
              status: order.status,
              filledAmount: order.filledAmount,
              spreadCharged: order.spreadCharged,
              updatedAt: order.updatedAt,
            },
            $unset: { filledRate: "" },
          };
    const orderStep: MoneyFlowStep = {
      name: "order-fill",
      apply: (stepOpts) =>
        applyKeyedUpdate(
          key,
          { collection: orders, filter: orderFilter, update: orderUpdate },
          stepOpts ?? {}
        ),
      revert: (stepOpts) =>
        applyKeyedUpdate(
          `${key}:compensate:order-fill`,
          { collection: orders, filter: { _id: order._id }, update: orderInverse },
          stepOpts ?? {}
        ),
    };

    await runMoneyFlowSteps(
      receipts,
      key,
      [
        makeLegStep(key, {
          name: "taker-settle",
          collection: characters,
          docId: input.takerCharacterId,
          field: personalField(order.toCurrency),
          delta: -takerTotalCost,
          minBalance: takerTotalCost,
          extraIncs: { [personalField(order.fromCurrency)]: takerCredit },
        }),
        makerStep,
        orderStep,
        makeInsertStep("trade-record", history, {
          _id: historyId,
          buyerCharacterId: order.characterId,
          sellerCharacterId: input.takerCharacterId,
          fromCurrency: order.fromCurrency,
          toCurrency: order.toCurrency,
          amount: fillAmount,
          rate,
          spread: makerSpread,
          turn: input.turn,
          createdAt: now,
          source: input.kind === "limit" ? "limit_order" : "direct",
        } as TradeHistoryEntry),
        // Both half-spread slices route under this key, so they merge per
        // bank: two same-bank steps would collide on the `$ne: key` guard and
        // the second slice would be silently skipped (see
        // makeSpreadDistributionSteps).
        ...makeSpreadDistributionStepsForFees(db, key, spreadSpecs),
      ],
      mapFillError(input.kind),
      opts
    );
    return {
      duplicate: claim === "in-progress",
      fillAmount,
      rate,
      makerSpread,
      takerSpread,
      orderStatus: newStatus,
    };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}

// ── Cancels (limit cancel + direct-trade decline) ────────────────────────────

export interface ForexCancelInput {
  orderId: ObjectId;
  now: Date;
  /**
   * Caller-chosen fingerprint of the intended cancel
   * (e.g. `forex-cancel:<orderId>:<ownerId>` or
   * `forex-decline:<orderId>:<targetId>`).
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same cancel replays the stored refund instead of
   * refunding again. Omit to mint one.
   */
  idempotencyKey?: string;
}

export interface ForexCancelResult {
  duplicate: boolean;
  refundedAmount: number;
  refundedCurrency: CurrencyCode;
}

/**
 * Cancel an open/partial limit order (or decline a direct request) and refund
 * the remaining escrow, exactly once on every topology (issue #1672).
 *
 * Race design: the cancel transition is one atomic guarded write
 * (open/partial → cancelled), so a concurrent fill either already moved the
 * order (this cancel guard-rejects with nothing applied, preserving the
 * historical `Only open or partial orders can be cancelled` /
 * `Trade request is no longer open`) or loses its own order step and
 * compensates. The refund amount is read AFTER the transition applies, from
 * the frozen cancelled row — a partial fill landing between the route's
 * pre-read and the transition refunds the true remainder, never a stale one.
 * No `processing` intermediate status: the `in_progress` receipt owns crashed
 * attempts (the turn's stuck-`processing` recovery is untouched).
 *
 * The legacy cancel refunded into a vanished account silently (no
 * matchedCount check), so a missing character maps to an applied no-op here:
 * the escrow died with the account and the order must still release.
 */
export async function applyForexCancelSpend(
  db: Db,
  input: ForexCancelInput
): Promise<ForexCancelResult> {
  if (!input.orderId) throw new TypeError("Forex cancel spend needs orderId");
  const key = resolveKey(input.idempotencyKey, "Forex cancel");

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const characters = db.collection<Character>("characters");
  const orders = db.collection<CurrencyOrder>("currencyOrders");
  const now = input.now;

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    // A fresh claim owns the attempt, so a validation failure settles the
    // receipt `failed` (nothing applied yet — truthful). A resumed
    // `in-progress` claim never settles here: the crashed prefix may have
    // moved money, so it reconciles through the keyed steps below instead —
    // including a cancel this key already transitioned (the transition
    // converges, the refund reads the frozen row).
    const fresh = claim === "fresh";
    const fail = async (sentinel: string): Promise<never> => {
      if (fresh) await failMoneyFlowReceipt(receipts, key, sentinel, opts);
      throw new Error(sentinel);
    };
    if (claim === "duplicate") {
      const live = await orders.findOne({ _id: input.orderId }, opts);
      if (!live) return fail(FOREX_CANCEL_ORDER_MISSING);
      return {
        duplicate: true as boolean,
        refundedAmount: Math.max(0, live.amount - live.filledAmount),
        refundedCurrency: live.fromCurrency,
      };
    }

    const order = await orders.findOne({ _id: input.orderId }, opts);
    if (!order) return fail(FOREX_CANCEL_ORDER_MISSING);
    const cancelledByUs = order.appliedMoneyFlowKeys?.includes(key) ?? false;
    if (
      order.status !== "open" &&
      order.status !== "partial" &&
      (fresh || !cancelledByUs)
    ) {
      return fail(FOREX_CANCEL_UNAVAILABLE);
    }
    const priorStatus = order.status;
    const priorUpdatedAt = order.updatedAt;
    // Exact refunded amount, stashed by the refund step's post-transition
    // read so the response echoes what moved (not the pre-transition read).
    let refunded: number | null = null;

    const refundStep: MoneyFlowStep = {
      name: "escrow-refund",
      apply: async (stepOpts) => {
        const stepOptions = stepOpts ?? {};
        // Read after the transition: the cancelled row is frozen (only this
        // flow's transition could have moved it here), so this is the exact
        // remainder even if a fill landed between the route's pre-read and
        // the transition. Keyed, so a retry converges instead of refunding
        // twice.
        const frozen = await orders.findOne({ _id: order._id }, stepOptions);
        if (!frozen) {
          refunded = 0;
          return "already-applied";
        }
        const refund = frozen.amount - frozen.filledAmount;
        refunded = Math.max(0, refund);
        if (!(refund > 0)) return "applied";
        const outcome = await applyIdempotentLeg(
          key,
          {
            name: "escrow-refund",
            collection: characters,
            docId: frozen.characterId,
            field: personalField(frozen.fromCurrency),
            delta: refund,
          },
          stepOptions
        );
        return outcome === "missing" ? "applied" : outcome;
      },
      revert: (stepOpts) =>
        applyIdempotentLeg(
          `${key}:compensate:escrow-refund`,
          {
            name: "escrow-refund",
            collection: characters,
            docId: order.characterId,
            field: personalField(order.fromCurrency),
            // Best-effort inverse of the pre-read remainder: the refund step
            // is terminal (nothing runs after it), so this only runs if a
            // future step is ever added and fails.
            delta: -(order.amount - order.filledAmount),
          },
          stepOpts ?? {}
        ),
    };

    await runMoneyFlowSteps(
      receipts,
      key,
      [
        {
          name: "order-cancel",
          apply: (stepOpts) =>
            applyKeyedUpdate(
              key,
              {
                collection: orders,
                filter: { _id: order._id, status: { $in: ["open", "partial"] as const } },
                update: { $set: { status: "cancelled" as const, updatedAt: now } },
              },
              stepOpts ?? {}
            ),
          revert: (stepOpts) =>
            applyKeyedUpdate(
              `${key}:compensate:order-cancel`,
              {
                collection: orders,
                filter: { _id: order._id },
                update: { $set: { status: priorStatus, updatedAt: priorUpdatedAt } },
              },
              stepOpts ?? {}
            ),
        } satisfies MoneyFlowStep,
        refundStep,
      ],
      (step, outcome) => new Error(`FOREX_CANCEL_${step.name}:${outcome}`),
      opts
    );
    return {
      duplicate: claim === "in-progress",
      refundedAmount: refunded ?? Math.max(0, order.amount - order.filledAmount),
      refundedCurrency: order.fromCurrency,
    };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}
