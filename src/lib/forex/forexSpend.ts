import { randomUUID } from "node:crypto";
import { ObjectId, type ClientSession, type Collection, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import {
  DIRECT_TRADE_SPREAD,
  INTERVENTION_FAILURE_INFAMY,
  LIMIT_ORDER_SPREAD,
  SPREAD_FEE_CENTRAL_BANK_RATIO,
  SPREAD_FEE_RESERVE_RATIO,
  type CurrencyCode,
  type CurrencyCyclePressureRegime,
} from "@/lib/constants/currencies";
import type { InterventionPolicy, InterventionRecord } from "@/lib/db/types/exchangeRate";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  applyIdempotentLeg,
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  deriveMoneyFlowKey,
  failMoneyFlowReceipt,
  insertKeyedDoc,
  keyedInsertId,
  makeInsertStep,
  makeLegStep,
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  runMoneyFlowSteps,
  type MoneyFlowLegOutcome,
  type MoneyFlowReceipt,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { getBankId } from "@/lib/centralBank/helpers";
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
export async function applyForexFillSpend(db: Db, input: ForexFillInput): Promise<ForexFillResult> {
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
      const error = input.kind === "limit" ? FOREX_FILL_ORDER_MISSING : FOREX_DIRECT_ORDER_MISSING;
      return fail(error);
    }
    if (input.kind === "limit" ? order.type !== "limit" : order.type !== "direct") {
      const error =
        input.kind === "limit" ? `${FOREX_FILL_UNAVAILABLE}:not-limit` : FOREX_DIRECT_WRONG_TYPE;
      return fail(error);
    }
    const statusOpen =
      input.kind === "limit"
        ? order.status === "open" || order.status === "partial"
        : order.status === "open";
    if (!statusOpen) {
      const error =
        input.kind === "limit" ? `${FOREX_FILL_UNAVAILABLE}:not-open` : FOREX_DIRECT_UNAVAILABLE;
      return fail(error);
    }

    const remaining = order.amount - order.filledAmount;
    const fillAmount =
      input.requestedAmount !== undefined ? Math.min(input.requestedAmount, remaining) : remaining;
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
      const error = input.kind === "limit" ? FOREX_FILL_INSUFFICIENT : FOREX_DIRECT_INSUFFICIENT;
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
                deriveMoneyFlowKey(key, "compensate", "maker-credit"),
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
        ? {
            _id: order._id,
            status: { $in: ["open", "partial"] as const },
            filledAmount: order.filledAmount,
          }
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
          deriveMoneyFlowKey(key, "compensate", "order-fill"),
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
    if (order.status !== "open" && order.status !== "partial" && (fresh || !cancelledByUs)) {
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
          deriveMoneyFlowKey(key, "compensate", "escrow-refund"),
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
              deriveMoneyFlowKey(key, "compensate", "order-cancel"),
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

// ── Turn triggered-limit fills ──────────────────────────────────────────────

/** Lost the order-settle race (prefix compensated when money moved, else failed clean). */
export const FOREX_TURN_FILL_RACED = "FOREX_TURN_FILL_RACED";
/** Fill history step failed after money moved (prefix compensated). */
export const FOREX_TURN_FILL_RECORD = "FOREX_TURN_FILL_RECORD";
/** Spread step failed after money moved (prefix compensated). */
export const FOREX_TURN_FILL_SPREAD = "FOREX_TURN_FILL_SPREAD";

/**
 * Deterministic per-turn key for a triggered-limit fill, so a same-turn
 * retry (turn re-entry after a crash elsewhere in the phase) converges under
 * the key guards instead of filling twice. A later turn fills under a new
 * key — but only when the order is still open, i.e. this attempt moved
 * nothing (the guarded settle is what takes it out of the scan).
 */
export function forexTurnFillKey(turn: number, orderId: ObjectId): string {
  return `forex-turn-fill:${turn}:${orderId.toHexString()}`;
}

/**
 * Fingerprint for a turn fill: the operation identity (order + turn) plus
 * the remainder it attempts. Rate and derived amounts live in the stored
 * plan, not here: the turn recomputes them from live rates, so a same-key
 * crash recovery must reconcile the stored plan instead of failing closed
 * on recompute drift.
 */
export function forexTurnFillFingerprint(
  orderId: ObjectId,
  turn: number,
  priorFilledAmount: number,
  fillAmount: number
): string {
  return `forex-turn-fill:${orderId.toHexString()}:${turn}:${priorFilledAmount}:${fillAmount}`;
}

export interface ForexTurnFillInput {
  orderId: ObjectId;
  /** Cross rate from the turn's frozen rate map (toCurrency per fromCurrency). */
  crossRate: number;
  turn: number;
  now: Date;
  fingerprint: string;
  /**
   * Deterministic key from {@link forexTurnFillKey} when called from the
   * turn. Omit to mint one (tests / one-off callers).
   */
  idempotencyKey?: string;
}

export type ForexTurnFillOutcome = "filled" | "expired" | "skipped";

export interface ForexTurnFillResult {
  duplicate: boolean;
  /**
   * `filled`: escrow converted and credited. `expired`: the owner row is
   * gone, so the escrow died with the account — spread still collected and
   * history written, mirroring the legacy deleted-character path. `skipped`:
   * no live remainder or no usable rate — nothing written, no receipt.
   */
  outcome: ForexTurnFillOutcome;
  fillAmount: number;
  toAmount: number;
  /** Cross rate the fill converted at (plan rate; feeds fill notifications). */
  filledRate: number;
  spreadAmount: number;
  /** Central-bank share of the spread (legacy totalSpreadRevenue accounting). */
  centralBankShare: number;
  orderStatus: CurrencyOrder["status"];
}

/**
 * Crash-resume plan persisted on the flow receipt right after the fresh
 * claim, before any money moves. A same-key retry rebuilds its steps from
 * THIS plan, never from the caller's live input: post-crash input is a
 * remainder (a settled fill reads empty, a crashed one re-reads the same
 * row), and running the remainder would compensate at remainder amounts if
 * the resume itself failed.
 *
 * Amounts replicate the legacy turn-fill math exactly (same operations in
 * the same order): spread off the top at LIMIT_ORDER_SPREAD, conversion of
 * the net remainder at the turn's cross rate, floor-based reserve slice off
 * the central-bank share. Deliberately NOT splitSpreadFee (round-based):
 * that helper serves the market-maker/peer-fill paths and computes
 * different slices for non-round spreads.
 */
interface ForexTurnFillStoredPlan {
  version: 1;
  orderIdHex: string;
  turn: number;
  characterIdHex: string;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  priorStatus: CurrencyOrder["status"];
  orderAmount: number;
  priorFilledAmount: number;
  priorSpreadCharged: number;
  priorFilledRate: number | null;
  priorUpdatedAtIso: string;
  fillAmount: number;
  crossRate: number;
  spreadAmount: number;
  netAmount: number;
  toAmount: number;
  toReserveBalance: number;
  toForexRevenue: number;
  fromBankId: string | null;
  reserveBankId: string | null;
  historyIdHex: string;
  ownerMissing: boolean;
  nowIso: string;
}

function isTurnFillPlan(value: unknown): value is ForexTurnFillStoredPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    plan.version === 1 &&
    typeof plan.orderIdHex === "string" &&
    typeof plan.turn === "number" &&
    typeof plan.characterIdHex === "string" &&
    typeof plan.fromCurrency === "string" &&
    typeof plan.toCurrency === "string" &&
    typeof plan.fillAmount === "number" &&
    typeof plan.orderAmount === "number" &&
    typeof plan.crossRate === "number" &&
    typeof plan.spreadAmount === "number" &&
    typeof plan.netAmount === "number" &&
    typeof plan.toAmount === "number" &&
    typeof plan.historyIdHex === "string" &&
    typeof plan.ownerMissing === "boolean"
  );
}

/**
 * A live retry input is a plausible remainder of the stored attempt when it
 * names the same order on the same turn and its remainder is consistent
 * with the stored attempt (untouched, or exactly the stored fill already
 * settled). Anything else under the same key is a genuinely different fill
 * and stays a key conflict (fail closed).
 */
function isRemainderOfTurnFillPlan(
  orderId: ObjectId,
  turn: number,
  liveFilledAmount: number,
  plan: ForexTurnFillStoredPlan
): boolean {
  if (orderId.toHexString() !== plan.orderIdHex) return false;
  if (turn !== plan.turn) return false;
  return (
    liveFilledAmount === plan.priorFilledAmount ||
    liveFilledAmount === plan.priorFilledAmount + plan.fillAmount
  );
}

/** Receipt rows carry the resume plan under this field (never in the shared type). */
type ForexTurnFillReceipt = MoneyFlowReceipt & { forexTurnFillPlan?: unknown };

interface NormalizedTurnFillPlan extends ForexTurnFillStoredPlan {
  orderId: ObjectId;
  characterId: ObjectId;
  historyId: ObjectId;
  priorUpdatedAt: Date;
  now: Date;
}

function normalizeTurnFillPlan(plan: ForexTurnFillStoredPlan): NormalizedTurnFillPlan {
  return {
    ...plan,
    orderId: new ObjectId(plan.orderIdHex),
    characterId: new ObjectId(plan.characterIdHex),
    historyId: new ObjectId(plan.historyIdHex),
    priorUpdatedAt: new Date(plan.priorUpdatedAtIso),
    now: new Date(plan.nowIso),
  };
}

function planFromLive(args: {
  order: CurrencyOrder;
  crossRate: number;
  turn: number;
  now: Date;
  fillAmount: number;
  ownerMissing: boolean;
  historyId: ObjectId;
}): ForexTurnFillStoredPlan {
  const { order, crossRate, fillAmount } = args;
  // Legacy op order, replicated exactly (see plan doc comment).
  const spreadAmount = fillAmount * LIMIT_ORDER_SPREAD;
  const netAmount = fillAmount - spreadAmount;
  const toAmount = netAmount * crossRate;
  const centralBankShare = spreadAmount * SPREAD_FEE_CENTRAL_BANK_RATIO;
  const toReserveBalance = Math.floor(spreadAmount * SPREAD_FEE_RESERVE_RATIO);
  const toForexRevenue = centralBankShare - toReserveBalance;
  const fromCountryId = getCountryForCurrency(order.fromCurrency);
  const toCountryId = getCountryForCurrency(order.toCurrency);
  return {
    version: 1,
    orderIdHex: order._id.toHexString(),
    turn: args.turn,
    characterIdHex: order.characterId.toHexString(),
    fromCurrency: order.fromCurrency,
    toCurrency: order.toCurrency,
    priorStatus: order.status,
    orderAmount: order.amount,
    priorFilledAmount: order.filledAmount,
    priorSpreadCharged: order.spreadCharged,
    priorFilledRate: order.filledRate ?? null,
    priorUpdatedAtIso: order.updatedAt.toISOString(),
    fillAmount,
    crossRate,
    spreadAmount,
    netAmount,
    toAmount,
    toReserveBalance,
    toForexRevenue,
    fromBankId: fromCountryId ? getBankId(fromCountryId) : null,
    reserveBankId: (() => {
      if (!fromCountryId) return null;
      const reserveCountry = toCountryId ?? fromCountryId;
      return getBankId(reserveCountry);
    })(),
    historyIdHex: args.historyId.toHexString(),
    ownerMissing: args.ownerMissing,
    nowIso: args.now.toISOString(),
  };
}

function mapTurnFillError(step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical surface: a lost order race was a silent skip in
  // the turn scan (claim matched nothing); here the guarded settle rejects
  // with an empty prefix, so the receipt settles `failed` and the turn
  // driver skips on this sentinel. Anything after money moved compensates
  // the prefix instead of stranding a half-landed fill.
  if (step.name === "order-settle") return new Error(`${FOREX_TURN_FILL_RACED}:${outcome}`);
  if (step.name === "trade-record") return new Error(`${FOREX_TURN_FILL_RECORD}:${outcome}`);
  return new Error(`${FOREX_TURN_FILL_SPREAD}:${step.name}:${outcome}`);
}

function negateTurnFillInc(inc: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(inc).map(([field, delta]) => [field, -delta]));
}

/**
 * One central-bank spread slice as a revertible step, mirroring the legacy
 * turn-fill bank writes (existence-ensuring insert for the legacy
 * `upsert: true`, then a keyed `$inc`): forexRevenue stays with the
 * fromCurrency country's bank, the reserve slice accrues to the destination
 * country's bank as a foreign reserve in the outflow currency.
 */
function makeTurnFillSpreadStep(
  key: string,
  banks: Collection<{ _id: string }>,
  name: string,
  bankId: string,
  inc: Record<string, number>
): MoneyFlowStep {
  const revertInc = negateTurnFillInc(inc);
  return {
    name,
    apply: async (options) => {
      const opts = options ?? {};
      await insertKeyedDoc(banks, { _id: bankId }, opts);
      return applyKeyedUpdate(
        key,
        { collection: banks, filter: { _id: bankId }, update: { $inc: inc } },
        opts
      );
    },
    revert: (options) =>
      applyKeyedUpdate(
        deriveMoneyFlowKey(key, "compensate", name),
        { collection: banks, filter: { _id: bankId }, update: { $inc: revertInc } },
        options ?? {}
      ),
  };
}

/**
 * The legacy turn-fill spread routing as keyed steps, preserving its exact
 * split and write pattern: same-bank merges into one `$inc` (zero slices
 * dropped — `$inc` by zero is a no-op, so dropping them changes no
 * balance), cross-bank always writes forexRevenue to the source bank and
 * writes the reserve slice only when positive. No bank route (unknown
 * currency) yields no steps — the legacy path skipped distribution the
 * same way while still crediting and recording the fill.
 */
function turnFillSpreadSteps(db: Db, key: string, plan: NormalizedTurnFillPlan): MoneyFlowStep[] {
  if (!plan.fromBankId || !plan.reserveBankId) return [];
  const banks = db.collection<{ _id: string }>("centralBanks");
  if (plan.reserveBankId === plan.fromBankId) {
    const inc: Record<string, number> = {};
    if (plan.toForexRevenue !== 0) inc.forexRevenue = plan.toForexRevenue;
    if (plan.toReserveBalance !== 0) {
      inc[`spreadFeeReserveBalances.${plan.fromCurrency}`] = plan.toReserveBalance;
    }
    if (Object.keys(inc).length === 0) return [];
    return [makeTurnFillSpreadStep(key, banks, "spread-home", plan.fromBankId, inc)];
  }
  const steps = [
    makeTurnFillSpreadStep(key, banks, "spread-revenue", plan.fromBankId, {
      forexRevenue: plan.toForexRevenue,
    }),
  ];
  if (plan.toReserveBalance > 0) {
    steps.push(
      makeTurnFillSpreadStep(key, banks, "spread-reserve", plan.reserveBankId, {
        [`spreadFeeReserveBalances.${plan.fromCurrency}`]: plan.toReserveBalance,
      })
    );
  }
  return steps;
}

function buildTurnFillSteps(db: Db, key: string, plan: NormalizedTurnFillPlan): MoneyFlowStep[] {
  const characters = db.collection<Character>("characters");
  const orders = db.collection<CurrencyOrder>("currencyOrders");
  const history = db.collection<TradeHistoryEntry>("tradeHistory");

  // The owner row can vanish between the plan-time pre-read and the credit
  // (legacy `modifiedCount === 0` path). Flipping to the expired-settle
  // keeps the legacy outcome — spread still collected, history written,
  // order released — instead of compensating a fill that already moved
  // money. The flag re-derives live on every run, so a resume converges
  // even when the stored plan predates the deletion.
  let ownerGone = plan.ownerMissing;

  const creditStep: MoneyFlowStep = {
    name: "fill-credit",
    apply: async (stepOpts) => {
      const opts = stepOpts ?? {};
      // No-op convergences: the legacy path `$inc`ed by zero as a no-op,
      // and a vanished owner credits nothing while the settle below still
      // expires the order.
      if (ownerGone || !(plan.toAmount > 0)) return "applied";
      const outcome = await applyIdempotentLeg(
        key,
        {
          name: "fill-credit",
          collection: characters,
          docId: plan.characterId,
          field: personalField(plan.toCurrency),
          delta: plan.toAmount,
        },
        opts
      );
      if (outcome === "missing") {
        ownerGone = true;
        return "applied";
      }
      return outcome;
    },
    revert: (stepOpts) => {
      // A flipped or planned miss never moved money — nothing to undo.
      // Reverting a real credit negates the exact fill credit.
      if (ownerGone) return Promise.resolve("already-applied" as MoneyFlowLegOutcome);
      return applyIdempotentLeg(
        deriveMoneyFlowKey(key, "compensate", "fill-credit"),
        {
          name: "fill-credit",
          collection: characters,
          docId: plan.characterId,
          field: personalField(plan.toCurrency),
          delta: -plan.toAmount,
        },
        stepOpts ?? {}
      );
    },
  };

  const newFilledAmount = plan.priorFilledAmount + plan.fillAmount;
  // Legacy comparison, replicated exactly: the turn always fills the full
  // remainder, so this lands `filled`; a resumed partial-remainder plan
  // keeps its honest status instead.
  const newStatus: CurrencyOrder["status"] =
    newFilledAmount >= plan.orderAmount ? "filled" : "partial";

  const settleStep: MoneyFlowStep = {
    name: "order-settle",
    apply: (stepOpts) => {
      const opts = stepOpts ?? {};
      if (ownerGone) {
        return applyKeyedUpdate(
          key,
          {
            collection: orders,
            filter: {
              _id: plan.orderId,
              status: { $in: ["open", "partial"] as const },
              filledAmount: plan.priorFilledAmount,
            },
            update: { $set: { status: "expired" as const, updatedAt: plan.now } },
          },
          opts
        );
      }
      // The turn always fills the full remainder, so the terminal status is
      // `filled`; the filledAmount exact-match guard arbitrates races with
      // cancels, peer fills, and expiry (the loser compensates its prefix).
      return applyKeyedUpdate(
        key,
        {
          collection: orders,
          filter: {
            _id: plan.orderId,
            status: { $in: ["open", "partial"] as const },
            filledAmount: plan.priorFilledAmount,
          },
          update: {
            $set: {
              status: newStatus,
              filledAmount: newFilledAmount,
              filledRate: plan.crossRate,
              updatedAt: plan.now,
            },
            $inc: { spreadCharged: plan.spreadAmount },
          },
        },
        opts
      );
    },
    revert: (stepOpts) => {
      const opts = stepOpts ?? {};
      const restoreSet: Record<string, unknown> = {
        status: plan.priorStatus,
        filledAmount: plan.priorFilledAmount,
        spreadCharged: plan.priorSpreadCharged,
        updatedAt: plan.priorUpdatedAt,
      };
      if (plan.priorFilledRate != null) restoreSet.filledRate = plan.priorFilledRate;
      return applyKeyedUpdate(
        deriveMoneyFlowKey(key, "compensate", "order-settle"),
        {
          collection: orders,
          filter: { _id: plan.orderId },
          update: {
            $set: restoreSet,
            ...(plan.priorFilledRate == null ? { $unset: { filledRate: "" } } : {}),
            $inc: { spreadCharged: -plan.spreadAmount },
          },
        },
        opts
      );
    },
  };

  return [
    creditStep,
    settleStep,
    ...turnFillSpreadSteps(db, key, plan),
    makeInsertStep("trade-record", history, {
      _id: plan.historyId,
      buyerCharacterId: plan.characterId,
      sellerCharacterId: null,
      fromCurrency: plan.fromCurrency,
      toCurrency: plan.toCurrency,
      amount: plan.netAmount,
      rate: plan.crossRate,
      spread: plan.spreadAmount,
      turn: plan.turn,
      createdAt: plan.now,
      source: "limit_order",
    } as TradeHistoryEntry),
  ];
}

/**
 * Settle a triggered limit order against the market maker at the turn's
 * cross rate, exactly once on every topology (issue #1672).
 *
 * Conservation: the maker escrowed `amount` fromCurrency at creation. The
 * fill converts the full remainder: spread off the top (central-bank
 * slices), net remainder converted at the cross rate and credited. No taker
 * side exists — the market maker is the counterparty.
 *
 * Pre-claim skips (no receipt, no writes — the legacy scan `continue`d the
 * same way): missing/non-limit/closed order, empty remainder, unusable
 * rate. A fresh claim that then loses the settle race settles `failed`
 * (nothing applied — truthful) and the turn driver skips on the raced
 * sentinel; the winner's outcome stands.
 */
export async function applyForexTurnFillSpend(
  db: Db,
  input: ForexTurnFillInput
): Promise<ForexTurnFillResult> {
  if (!input.orderId) throw new TypeError("Forex turn fill spend needs orderId");
  if (!Number.isFinite(input.turn)) throw new TypeError("Forex turn fill spend needs turn");
  const key = resolveKey(input.idempotencyKey, "Forex turn fill");
  const historyId = keyedInsertId(key, "forex-turn-fill");

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const receiptCollection = receipts as unknown as Collection<ForexTurnFillReceipt>;
  const characters = db.collection<Character>("characters");
  const orders = db.collection<CurrencyOrder>("currencyOrders");

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};

    const runPlan = async (plan: NormalizedTurnFillPlan): Promise<ForexTurnFillResult> => {
      await runMoneyFlowSteps(
        receipts,
        key,
        buildTurnFillSteps(db, key, plan),
        mapTurnFillError,
        opts
      );
      const settled = await orders.findOne(
        { _id: plan.orderId },
        { ...opts, projection: { status: 1 } }
      );
      const status = (settled?.status ?? "filled") as CurrencyOrder["status"];
      return {
        duplicate: false as boolean,
        outcome: (status === "expired" ? "expired" : "filled") as ForexTurnFillOutcome,
        fillAmount: plan.fillAmount,
        toAmount: plan.toAmount,
        filledRate: plan.crossRate,
        spreadAmount: plan.spreadAmount,
        centralBankShare: plan.spreadAmount * SPREAD_FEE_CENTRAL_BANK_RATIO,
        orderStatus: status,
      };
    };

    // Pre-claim live read: pure skips stay writeless (no receipt), exactly
    // like the legacy scan continuing past unfillable orders — UNLESS this
    // key already owns an attempt. A same-key retry after the settle landed
    // re-reads a filled order (empty remainder), and a retry after an
    // owner-gone expiry re-reads a closed one: both take the skip path below
    // while the receipt holds a completed or in-progress attempt that must
    // replay/resume instead of stranding. Terminal receipts fail closed.
    const live = await orders.findOne({ _id: input.orderId }, opts);
    const reconcileSkippedAttempt = async (): Promise<ForexTurnFillResult | null> => {
      const existing = await receiptCollection.findOne({ _id: key }, opts);
      if (!existing) return null;
      if (existing.status === "completed") {
        const stored = existing.forexTurnFillPlan;
        if (
          !isTurnFillPlan(stored) ||
          stored.orderIdHex !== input.orderId.toHexString() ||
          stored.turn !== input.turn
        ) {
          throw new MoneyFlowKeyConflictError(key);
        }
        return replayTurnFillOutcome(db, key, opts);
      }
      if (existing.status === "failed" || existing.status === "compensated") {
        throw new MoneyFlowTerminalError(key, existing.status);
      }
      const stored = existing.forexTurnFillPlan;
      // Crashed between the claim insert and the plan write: nothing applied
      // yet, and the live row is unfillable — the orphan TTLs away while the
      // scan treats the row as any other unfillable one.
      if (!isTurnFillPlan(stored)) return null;
      if (
        live &&
        !isRemainderOfTurnFillPlan(input.orderId, input.turn, live.filledAmount, stored)
      ) {
        throw new MoneyFlowKeyConflictError(key);
      }
      const result = await runPlan(normalizeTurnFillPlan(stored));
      return { ...result, duplicate: true as boolean };
    };
    const skipped = async (orderStatus: CurrencyOrder["status"]): Promise<ForexTurnFillResult> => {
      const resumed = await reconcileSkippedAttempt();
      if (resumed) return resumed;
      return {
        duplicate: false as boolean,
        outcome: "skipped" as ForexTurnFillOutcome,
        fillAmount: 0,
        toAmount: 0,
        filledRate: 0,
        spreadAmount: 0,
        centralBankShare: 0,
        orderStatus,
      };
    };
    if (!live || live.type !== "limit" || (live.status !== "open" && live.status !== "partial")) {
      return skipped((live?.status ?? "open") as CurrencyOrder["status"]);
    }
    const fillAmount = live.amount - live.filledAmount;
    if (!(fillAmount > 0)) {
      return skipped(live.status);
    }
    if (!Number.isFinite(input.crossRate) || input.crossRate <= 0) {
      return skipped(live.status);
    }

    let claim: Awaited<ReturnType<typeof claimMoneyFlowReceipt>>;
    try {
      claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    } catch (err) {
      if (!(err instanceof MoneyFlowKeyConflictError)) throw err;
      // Same-key retry whose recomputed remainder no longer matches the
      // stored fingerprint (e.g. the settle already landed, so the live
      // remainder reads empty): resume the STORED plan when the live input
      // is its remainder instead of stranding the receipt. Anything else
      // under the same key is a genuinely different fill — conflict stands.
      const existing = await receiptCollection.findOne({ _id: key }, opts);
      if (!existing || existing.status !== "in_progress") throw err;
      const stored = existing.forexTurnFillPlan;
      if (!isTurnFillPlan(stored)) {
        // Crashed between the claim insert and the plan write below:
        // nothing applied yet (the plan lands before the first step), so
        // reconciling the live input under the stored fingerprint is exact.
        const retry = await claimMoneyFlowReceipt(receipts, key, existing.fingerprint, opts);
        if (retry === "duplicate") {
          return replayTurnFillOutcome(db, key, opts);
        }
        const owner = await characters.findOne({ _id: live.characterId }, opts);
        await receiptCollection.updateOne(
          { _id: key },
          {
            $set: {
              forexTurnFillPlan: planFromLive({
                order: live,
                crossRate: input.crossRate,
                turn: input.turn,
                now: input.now,
                fillAmount,
                ownerMissing: !owner,
                historyId,
              }),
              updatedAt: new Date(),
            },
          },
          opts
        );
        const plan = normalizeTurnFillPlan(
          (await receiptCollection.findOne({ _id: key }, opts))
            ?.forexTurnFillPlan as ForexTurnFillStoredPlan
        );
        const result = await runPlan(plan);
        return { ...result, duplicate: true as boolean };
      }
      if (!isRemainderOfTurnFillPlan(input.orderId, input.turn, live.filledAmount, stored)) {
        throw err;
      }
      const result = await runPlan(normalizeTurnFillPlan(stored));
      return { ...result, duplicate: true as boolean };
    }

    if (claim === "duplicate") {
      return replayTurnFillOutcome(db, key, opts);
    }
    if (claim === "in-progress") {
      const existing = await receiptCollection.findOne({ _id: key }, opts);
      const stored = existing?.forexTurnFillPlan;
      if (isTurnFillPlan(stored)) {
        // Same fingerprint, so the live input names the same fill:
        // reconcile it through the stored plan's keyed steps
        // (already-applied legs skip).
        const result = await runPlan(normalizeTurnFillPlan(stored));
        return { ...result, duplicate: true as boolean };
      }
      // No plan yet: the crash landed between the claim insert and the
      // plan write, so nothing applied — reconcile the live input under
      // the stored fingerprint.
      const retry = await claimMoneyFlowReceipt(receipts, key, existing!.fingerprint, opts);
      if (retry === "duplicate") {
        return replayTurnFillOutcome(db, key, opts);
      }
      const owner = await characters.findOne({ _id: live.characterId }, opts);
      const freshPlan = planFromLive({
        order: live,
        crossRate: input.crossRate,
        turn: input.turn,
        now: input.now,
        fillAmount,
        ownerMissing: !owner,
        historyId,
      });
      await receiptCollection.updateOne(
        { _id: key },
        { $set: { forexTurnFillPlan: freshPlan, updatedAt: new Date() } },
        opts
      );
      const result = await runPlan(normalizeTurnFillPlan(freshPlan));
      return { ...result, duplicate: true as boolean };
    }

    // A fresh claim owns the attempt. A concurrent winner between the
    // pre-claim read and the steps loses at the guarded settle below: empty
    // prefix settles `failed`, a moved-money prefix compensates — either
    // way the winner's outcome stands and this key stays fail-closed.
    const owner = await characters.findOne({ _id: live.characterId }, opts);
    const storedPlan = planFromLive({
      order: live,
      crossRate: input.crossRate,
      turn: input.turn,
      now: input.now,
      fillAmount: live.amount - live.filledAmount,
      ownerMissing: !owner,
      historyId,
    });
    // Persist the resume plan before the first step: a crash from here on
    // resumes this exact plan under the same key.
    try {
      await receiptCollection.updateOne(
        { _id: key },
        { $set: { forexTurnFillPlan: storedPlan, updatedAt: new Date() } },
        opts
      );
    } catch (planError) {
      await failMoneyFlowReceipt(receipts, key, `${FOREX_TURN_FILL_RECORD}:plan-store`, opts);
      throw planError;
    }

    const result = await runPlan(normalizeTurnFillPlan(storedPlan));
    return { ...result, duplicate: false as boolean };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}

/**
 * Replay the stored outcome of a completed turn fill without touching
 * balances or live state: the history row is deterministic per key, and the
 * amounts come from the stored plan. Throws when the receipt settled
 * `failed`/`compensated` (fail closed) or when the stored attempt names a
 * different order (fail closed on cross-order key reuse).
 */
async function replayTurnFillOutcome(
  db: Db,
  key: string,
  opts: { session?: ClientSession }
): Promise<ForexTurnFillResult> {
  const receiptCollection = (await getMoneyFlowReceiptsCollection(
    db
  )) as unknown as Collection<ForexTurnFillReceipt>;
  const existing = await receiptCollection.findOne({ _id: key }, opts);
  const stored = existing?.forexTurnFillPlan;
  if (!isTurnFillPlan(stored)) throw new Error("FOREX_TURN_FILL_RECEIPT_ORPHANED");
  const history = db.collection<TradeHistoryEntry>("tradeHistory");
  const recorded = await history.findOne({ _id: new ObjectId(stored.historyIdHex) }, opts);
  if (!recorded) throw new Error("FOREX_TURN_FILL_RECEIPT_ORPHANED");
  const orders = db.collection<CurrencyOrder>("currencyOrders");
  const live = await orders.findOne(
    { _id: new ObjectId(stored.orderIdHex) },
    { ...opts, projection: { status: 1 } }
  );
  return {
    duplicate: true as boolean,
    outcome: (live?.status === "expired" ? "expired" : "filled") as ForexTurnFillOutcome,
    fillAmount: stored.fillAmount,
    toAmount: stored.toAmount,
    filledRate: stored.crossRate,
    spreadAmount: stored.spreadAmount,
    centralBankShare: stored.spreadAmount * SPREAD_FEE_CENTRAL_BANK_RATIO,
    orderStatus: (live?.status ?? "filled") as CurrencyOrder["status"],
  };
}

/**
 * Key-only crash recovery for turn fills (issue #1672): the turn driver
 * re-drives `in_progress` turn-fill receipts from prior turns through their
 * stored plans before scanning, so a crash between the steps of one turn's
 * fill converges on the next turn instead of stranding (transition without
 * credit) or double-paying (credit without transition, refilled under a new
 * key).
 *
 * Returns null when there is nothing to resume (no receipt, an already-
 * `completed` receipt, or an `in_progress` receipt with no usable stored
 * plan — the scan then fresh-fills the still-open order under the new
 * turn's key). Throws `MoneyFlowTerminalError` when the receipt settled
 * `failed`/`compensated`.
 */
export async function resumeForexTurnFillByKey(
  db: Db,
  key: string
): Promise<(ForexTurnFillResult & { orderId: ObjectId }) | null> {
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Forex turn fill idempotency key must be 1-128 characters");
  }
  if (!key.startsWith("forex-turn-fill:")) return null;
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const receiptCollection = receipts as unknown as Collection<ForexTurnFillReceipt>;
  const existing = await receiptCollection.findOne({ _id: key });
  if (!existing) return null;
  if (existing.status === "completed") return null;
  if (existing.status === "failed" || existing.status === "compensated") {
    throw new MoneyFlowTerminalError(key, existing.status);
  }
  if (existing.status !== "in_progress") return null;
  const stored = existing.forexTurnFillPlan;
  // Crashed between the claim insert and the plan write: nothing applied
  // yet, and the order is still open — the scan fresh-fills it under the
  // new turn's key. The orphaned receipt TTLs away.
  if (!isTurnFillPlan(stored)) return null;
  const plan = normalizeTurnFillPlan(stored);
  const mapError = (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error =>
    mapTurnFillError(step, outcome);
  const runResume = async (session?: ClientSession): Promise<ForexTurnFillResult> => {
    const opts = session ? { session } : {};
    await runMoneyFlowSteps(receipts, key, buildTurnFillSteps(db, key, plan), mapError, opts);
    const orders = db.collection<CurrencyOrder>("currencyOrders");
    const settled = await orders.findOne(
      { _id: plan.orderId },
      { ...opts, projection: { status: 1 } }
    );
    const status = (settled?.status ?? "filled") as CurrencyOrder["status"];
    return {
      duplicate: true as boolean,
      outcome: (status === "expired" ? "expired" : "filled") as ForexTurnFillOutcome,
      fillAmount: plan.fillAmount,
      toAmount: plan.toAmount,
      filledRate: plan.crossRate,
      spreadAmount: plan.spreadAmount,
      centralBankShare: plan.spreadAmount * SPREAD_FEE_CENTRAL_BANK_RATIO,
      orderStatus: status,
    };
  };
  const result = await runWithOptionalTransaction(
    async (session) => runResume(session),
    async () => runResume()
  );
  return { ...result, orderId: plan.orderId };
}

// ── Turn expiry refunds ─────────────────────────────────────────────────────

/** Expire cannot run: missing order. */
export const FOREX_EXPIRE_ORDER_MISSING = "FOREX_EXPIRE_ORDER_MISSING";
/** Expire cannot run: not open/partial (legacy already-expired row included), not due, or lost the settle race. */
export const FOREX_EXPIRE_UNAVAILABLE = "FOREX_EXPIRE_UNAVAILABLE";

/**
 * Stable order-derived key for an expiry, so retries across turns converge
 * under the key guards instead of refunding twice. Expiration is once-only
 * per order (open/partial → expired is terminal), so the key deliberately
 * carries NO turn: a per-turn key would let a later turn refund an order a
 * prior turn already expired.
 */
export function forexExpireKey(orderId: ObjectId): string {
  return `forex-expire:${orderId.toHexString()}`;
}

/**
 * Fingerprint for an expiry: the operation identity (the order). The refund
 * amount re-derives from the frozen expired row on every run, so it stays
 * out of the fingerprint — a same-key retry always matches.
 */
export function forexExpireFingerprint(orderId: ObjectId): string {
  return `forex-expire:${orderId.toHexString()}`;
}

export interface ForexExpireInput {
  orderId: ObjectId;
  /**
   * Turn the driver is expiring for. When provided, a fresh attempt on an
   * order whose `expiresAtTurn` is still in the future fails closed
   * (`UNAVAILABLE:not-due`) instead of refunding early; a resumed
   * `in-progress` attempt reconciles through the keyed steps regardless.
   */
  turn?: number;
  now: Date;
  fingerprint: string;
  /**
   * Deterministic key from {@link forexExpireKey} when called from the
   * turn. Omit to mint one (tests / one-off callers).
   */
  idempotencyKey?: string;
}

export interface ForexExpireResult {
  duplicate: boolean;
  refundedAmount: number;
  refundedCurrency: CurrencyCode;
  orderStatus: CurrencyOrder["status"];
  /**
   * True when this call's guarded transition moved the order to `expired`.
   * The turn driver tallies exactly this, mirroring the legacy
   * `updateMany.modifiedCount` count.
   */
  transitionApplied: boolean;
}

function expireNotDue(order: CurrencyOrder, turn: number): boolean {
  return (
    typeof order.expiresAtTurn !== "number" ||
    !Number.isFinite(order.expiresAtTurn) ||
    order.expiresAtTurn > turn
  );
}

/** Steps for one expiry: terminal transition first, escrow refund second. */
function buildExpireSteps(
  key: string,
  order: CurrencyOrder,
  now: Date,
  db: Db
): { steps: MoneyFlowStep[]; state: { refunded: number; transitionApplied: boolean } } {
  const characters = db.collection<Character>("characters");
  const orders = db.collection<CurrencyOrder>("currencyOrders");
  const state = { refunded: 0, transitionApplied: false };
  const priorStatus = order.status;
  const priorUpdatedAt = order.updatedAt;

  const refundStep: MoneyFlowStep = {
    name: "escrow-refund",
    apply: async (stepOpts) => {
      const stepOptions = stepOpts ?? {};
      // Read after the transition: the expired row is frozen (only this
      // flow's transition could have moved it here), so this is the exact
      // remainder. Keyed, so a retry converges instead of refunding twice.
      const frozen = await orders.findOne({ _id: order._id }, stepOptions);
      if (!frozen) {
        state.refunded = 0;
        return "already-applied";
      }
      const remainder = frozen.amount - frozen.filledAmount;
      state.refunded = Number.isFinite(remainder) ? Math.max(0, remainder) : 0;
      if (!(state.refunded > 0)) return "applied";
      const outcome = await applyIdempotentLeg(
        key,
        {
          name: "escrow-refund",
          collection: characters,
          docId: frozen.characterId,
          field: personalField(frozen.fromCurrency),
          delta: state.refunded,
        },
        stepOptions
      );
      // The legacy bulk refund never checked the owner write, so a vanished
      // account credits nothing while the order still releases.
      return outcome === "missing" ? "applied" : outcome;
    },
    revert: (stepOpts) =>
      applyIdempotentLeg(
        deriveMoneyFlowKey(key, "compensate", "escrow-refund"),
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

  const steps: MoneyFlowStep[] = [
    {
      name: "order-expire",
      apply: async (stepOpts) => {
        const outcome = await applyKeyedUpdate(
          key,
          {
            collection: orders,
            filter: { _id: order._id, status: { $in: ["open", "partial"] as const } },
            update: { $set: { status: "expired" as const, updatedAt: now } },
          },
          stepOpts ?? {}
        );
        if (outcome === "applied") state.transitionApplied = true;
        return outcome;
      },
      revert: (stepOpts) =>
        applyKeyedUpdate(
          deriveMoneyFlowKey(key, "compensate", "order-expire"),
          {
            collection: orders,
            filter: { _id: order._id },
            update: { $set: { status: priorStatus, updatedAt: priorUpdatedAt } },
          },
          stepOpts ?? {}
        ),
    } satisfies MoneyFlowStep,
    refundStep,
  ];
  return { steps, state };
}

function mapExpireError(step: MoneyFlowStep, outcome: MoneyFlowLegOutcome): Error {
  // The transition is the first step, so an empty prefix means a lost race
  // (a concurrent fill, cancel, or expiry won) or a vanished order — the
  // winner's outcome stands. The refund step never fails (missing owner and
  // empty/malformed remainders converge as no-ops).
  return new Error(`${FOREX_EXPIRE_UNAVAILABLE}:${step.name}:${outcome}`);
}

/**
 * Expire one stale order and refund its remaining escrow, exactly once on
 * every topology (issue #1672).
 *
 * Conservation: the owner escrowed `amount` fromCurrency at creation and
 * `filledAmount` already left escrow through fills. The refund credits
 * `amount - filledAmount` to `currencyBalances.personal.<fromCurrency>` —
 * the same field the legacy unkeyed bulkWrite credited — and a vanished
 * owner credits nothing (legacy no-op parity) while the order still
 * releases. Malformed or non-positive remainders credit nothing and still
 * complete, mirroring the legacy `refundAmount > 0` gate.
 */
export async function applyForexExpireSpend(
  db: Db,
  input: ForexExpireInput
): Promise<ForexExpireResult> {
  if (!input.orderId) throw new TypeError("Forex expire spend needs orderId");
  const key =
    input.idempotencyKey !== undefined
      ? resolveKey(input.idempotencyKey, "Forex expire")
      : forexExpireKey(input.orderId);

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const orders = db.collection<CurrencyOrder>("currencyOrders");
  const now = input.now;

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    // A fresh claim owns the attempt, so a validation failure settles the
    // receipt `failed` (nothing applied yet — truthful). A resumed
    // `in-progress` claim never settles here: the crashed prefix may have
    // moved money, so it reconciles through the keyed steps below instead —
    // including an expiry this key already transitioned (the transition
    // converges, the refund reads the frozen row).
    const fresh = claim === "fresh";
    const fail = async (sentinel: string): Promise<never> => {
      if (fresh) await failMoneyFlowReceipt(receipts, key, sentinel, opts);
      throw new Error(sentinel);
    };
    if (claim === "duplicate") {
      const live = await orders.findOne({ _id: input.orderId }, opts);
      if (!live) return fail(FOREX_EXPIRE_ORDER_MISSING);
      const remainder = live.amount - live.filledAmount;
      return {
        duplicate: true as boolean,
        refundedAmount: Number.isFinite(remainder) ? Math.max(0, remainder) : 0,
        refundedCurrency: live.fromCurrency,
        orderStatus: live.status,
        transitionApplied: false as boolean,
      };
    }

    const order = await orders.findOne({ _id: input.orderId }, opts);
    if (!order) return fail(FOREX_EXPIRE_ORDER_MISSING);
    const cancelledByUs = order.appliedMoneyFlowKeys?.includes(key) ?? false;
    if (order.status !== "open" && order.status !== "partial" && (fresh || !cancelledByUs)) {
      return fail(FOREX_EXPIRE_UNAVAILABLE);
    }
    if (fresh && input.turn !== undefined && expireNotDue(order, input.turn)) {
      return fail(`${FOREX_EXPIRE_UNAVAILABLE}:not-due`);
    }

    const { steps, state } = buildExpireSteps(key, order, now, db);
    await runMoneyFlowSteps(receipts, key, steps, mapExpireError, opts);
    const settled = await orders.findOne(
      { _id: input.orderId },
      { ...opts, projection: { status: 1, fromCurrency: 1 } }
    );
    return {
      duplicate: claim === "in-progress",
      refundedAmount: state.refunded,
      refundedCurrency: order.fromCurrency,
      orderStatus: (settled?.status ?? "expired") as CurrencyOrder["status"],
      transitionApplied: state.transitionApplied,
    };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}

/**
 * Key-only crash recovery for expiries (issue #1672): the turn driver
 * re-drives `in_progress` expire receipts through their keyed steps before
 * scanning, so a crash between the transition and the refund converges on
 * the next turn instead of stranding an expired-but-unrefunded order the
 * scan (which only matches open/partial) would never pick up again.
 *
 * Returns null when there is nothing to resume (an unrelated key, no
 * receipt, or an already-`completed` receipt). Throws
 * `MoneyFlowTerminalError` when the receipt settled `failed`/`compensated`.
 */
export async function resumeForexExpireByKey(
  db: Db,
  key: string
): Promise<(ForexExpireResult & { orderId: ObjectId }) | null> {
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Forex expire idempotency key must be 1-128 characters");
  }
  const prefix = "forex-expire:";
  if (!key.startsWith(prefix)) return null;
  let orderId: ObjectId;
  try {
    orderId = new ObjectId(key.slice(prefix.length));
  } catch {
    return null;
  }
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const existing = await receipts.findOne({ _id: key });
  if (!existing) return null;
  if (existing.status === "completed") return null;
  if (existing.status === "failed" || existing.status === "compensated") {
    throw new MoneyFlowTerminalError(key, existing.status);
  }
  if (existing.status !== "in_progress") return null;
  const runResume = async (session?: ClientSession): Promise<ForexExpireResult> => {
    const opts = session ? { session } : {};
    const orders = db.collection<CurrencyOrder>("currencyOrders");
    const order = await orders.findOne({ _id: orderId }, opts);
    if (!order) {
      await failMoneyFlowReceipt(receipts, key, FOREX_EXPIRE_ORDER_MISSING, opts);
      throw new Error(FOREX_EXPIRE_ORDER_MISSING);
    }
    // No turn gate and no status gate here: the crashed attempt owns this
    // order under this key, so reconcile whatever it left — the keyed
    // transition converges when the order is already expired, and a
    // concurrent winner's terminal state surfaces through the steps.
    const { steps, state } = buildExpireSteps(key, order, order.updatedAt, db);
    await runMoneyFlowSteps(receipts, key, steps, mapExpireError, opts);
    const settled = await orders.findOne({ _id: orderId }, { ...opts, projection: { status: 1 } });
    return {
      duplicate: true as boolean,
      refundedAmount: state.refunded,
      refundedCurrency: order.fromCurrency,
      orderStatus: (settled?.status ?? "expired") as CurrencyOrder["status"],
      transitionApplied: state.transitionApplied,
    };
  };
  const result = await runWithOptionalTransaction(
    async (session) => runResume(session),
    async () => runResume()
  );
  return { ...result, orderId };
}

// ── Turn intervention (chair standing policy) ───────────────────────────────

/** Intervention cannot run: the rate writeback lost its document. */
export const FOREX_INTERVENTION_RATE = "FOREX_INTERVENTION_RATE";
/** Intervention cannot run: the reserve draw lost its bank document. */
export const FOREX_INTERVENTION_RESERVE = "FOREX_INTERVENTION_RESERVE";
/** Intervention cannot run: the infamy write lost its bank document. */
export const FOREX_INTERVENTION_INFAMY = "FOREX_INTERVENTION_INFAMY";
/** Completed intervention receipt without a usable stored plan. */
export const FOREX_INTERVENTION_RECEIPT_ORPHANED = "FOREX_INTERVENTION_RECEIPT_ORPHANED";

/**
 * Deterministic key for one currency's intervention in one turn, so retries
 * of the same turn converge under the key guards instead of drawing reserves
 * twice. Per (turn, country) there is exactly one intervention event, so the
 * key carries nothing else — economics live in the stored plan, never in the
 * key, because a same-turn retry recomputes them with fresh jitter.
 */
export function forexInterventionKey(turn: number, countryId: string): string {
  return `forex-intervention:${turn}:${countryId}`;
}

/**
 * Fingerprint for an intervention: the operation identity (turn + country).
 * Derived amounts re-derive with jitter on every computation, so they stay
 * out of the fingerprint — a same-key retry always matches and reconciles
 * through the stored plan instead of failing closed on recompute drift.
 */
export function forexInterventionFingerprint(turn: number, countryId: string): string {
  return `forex-intervention:${turn}:${countryId}`;
}

/**
 * The turn driver's pure intervention computation, as plain data. Null when
 * the rate is in band (or no policy ran): a writeless no-op unless a receipt
 * already exists for this key, in which case the stored attempt replays.
 */
export interface ForexInterventionSpendOutcome {
  rate: number;
  macroTarget: number;
  /** Audit record for recentInterventions — null when no spend happened. */
  record: InterventionRecord | null;
  /** Reserve draw deltas (negative numbers, legacy funding-plan values). */
  forexRevenueDelta: number;
  reserveBalanceDelta: number;
  spreadFeeReserveDeltas: Partial<Record<CurrencyCode, number>>;
  /** True when a failure-infamy charge applies to the seated chair. */
  infamyCharged: boolean;
  /** Hex of the seated chair, or null during a vacancy (no mail). */
  chairCharacterIdHex: string | null;
}

export interface ForexInterventionPrior {
  rate: number;
  macroTarget: number;
  buyVolume24: number;
  sellVolume24: number;
  cyclePressureRegime: CurrencyCyclePressureRegime | null;
  cyclePressureUntilTurn: number | null;
  /** Policy row as read before this turn's write (always present when engaged). */
  policy: InterventionPolicy;
  hardPeg: number | null;
  updatedAtIso: string;
  chairInfamy: number;
}

export interface ForexInterventionInput {
  countryId: string;
  /** Central-bank document id (getBankId — shared-bank countries share one doc). */
  bankId: string;
  turn: number;
  fingerprint: string;
  /**
   * Deterministic key from {@link forexInterventionKey} when called from the
   * turn. Omit to mint one (tests / one-off callers).
   */
  idempotencyKey?: string;
  outcome: ForexInterventionSpendOutcome | null;
  /**
   * The full legacy rate writeback, built by the driver (single construction
   * site for the bare and keyed paths, so observable rate/history semantics
   * cannot drift between them).
   */
  rateSet: Record<string, unknown>;
  rateUnset?: Record<string, "">;
  prior: ForexInterventionPrior;
}

export type ForexInterventionFlowOutcome = "applied" | "noop";

export interface ForexInterventionResult {
  duplicate: boolean;
  /**
   * True when this call completed the keyed flow (fresh or resumed). The
   * driver sends the failure mail exactly then — never on a writeless noop
   * and never on a duplicate replay (mail already went out or was lost in
   * the same crash window the fill notifications accept).
   */
  completedNow: boolean;
  /**
   * `applied`: the keyed flow completed (fresh, resumed, or replayed) — the
   * rate write converged, no bare write needed. `noop`: nothing written, no
   * receipt — the driver does the legacy bare rate write.
   */
  outcome: ForexInterventionFlowOutcome;
  /** Post-intervention rate (stored plan value on resume/replay). */
  rate: number;
  macroTarget: number;
  record: InterventionRecord | null;
  infamyCharged: boolean;
  chairCharacterIdHex: string | null;
}

/**
 * Crash-resume plan persisted on the flow receipt right after the fresh
 * claim, before any money moves. A same-key retry rebuilds its steps from
 * THIS plan, never from the caller's live input: post-crash input is a
 * jittered recompute, and running it would double-draw reserves or strand a
 * second policy record.
 *
 * The full post-write rate document is NOT stored (rateHistory alone is ~240
 * snapshots): the revert restores the small prior scalars and pops the one
 * appended snapshot, which is exact because this flow is the only writer
 * that appends to this row between its own apply and its own revert.
 */
interface ForexInterventionStoredPlan {
  version: 1;
  countryId: string;
  bankId: string;
  turn: number;
  rate: number;
  macroTarget: number;
  rateSet: Record<string, unknown>;
  rateUnset: Record<string, "">;
  priorRate: number;
  priorMacroTarget: number;
  priorBuyVolume24: number;
  priorSellVolume24: number;
  priorCyclePressureRegime: CurrencyCyclePressureRegime | null;
  priorCyclePressureUntilTurn: number | null;
  priorPolicy: InterventionPolicy;
  priorHardPeg: number | null;
  priorUpdatedAtIso: string;
  priorChairInfamy: number;
  forexRevenueDelta: number;
  reserveBalanceDelta: number;
  /** Nonzero spread-fee reserve deltas only ($inc by zero is a no-op). */
  spreadDeltas: Record<string, number>;
  infamyCharged: boolean;
  chairCharacterIdHex: string | null;
  record: InterventionRecord | null;
}

function isInterventionPlan(value: unknown): value is ForexInterventionStoredPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    plan.version === 1 &&
    typeof plan.countryId === "string" &&
    typeof plan.bankId === "string" &&
    typeof plan.turn === "number" &&
    typeof plan.rate === "number" &&
    typeof plan.macroTarget === "number" &&
    plan.rateSet !== null &&
    typeof plan.rateSet === "object" &&
    plan.priorPolicy !== null &&
    typeof plan.priorPolicy === "object" &&
    typeof plan.forexRevenueDelta === "number" &&
    typeof plan.reserveBalanceDelta === "number" &&
    plan.spreadDeltas !== null &&
    typeof plan.spreadDeltas === "object" &&
    typeof plan.infamyCharged === "boolean" &&
    (plan.chairCharacterIdHex === null || typeof plan.chairCharacterIdHex === "string") &&
    (plan.record === null || (typeof plan.record === "object" && plan.record !== null))
  );
}

/** Receipt rows carry the resume plan under this field (never in the shared type). */
type ForexInterventionReceipt = MoneyFlowReceipt & { forexInterventionPlan?: unknown };

function planFromInput(input: ForexInterventionInput): ForexInterventionStoredPlan {
  const outcome = input.outcome!;
  const spreadDeltas: Record<string, number> = {};
  for (const [currency, delta] of Object.entries(outcome.spreadFeeReserveDeltas)) {
    if (typeof delta === "number" && delta !== 0) spreadDeltas[currency] = delta;
  }
  return {
    version: 1,
    countryId: input.countryId,
    bankId: input.bankId,
    turn: input.turn,
    rate: outcome.rate,
    macroTarget: outcome.macroTarget,
    rateSet: input.rateSet,
    rateUnset: input.rateUnset ?? {},
    priorRate: input.prior.rate,
    priorMacroTarget: input.prior.macroTarget,
    priorBuyVolume24: input.prior.buyVolume24,
    priorSellVolume24: input.prior.sellVolume24,
    priorCyclePressureRegime: input.prior.cyclePressureRegime,
    priorCyclePressureUntilTurn: input.prior.cyclePressureUntilTurn,
    priorPolicy: input.prior.policy,
    priorHardPeg: input.prior.hardPeg,
    priorUpdatedAtIso: input.prior.updatedAtIso,
    priorChairInfamy: input.prior.chairInfamy,
    forexRevenueDelta: outcome.forexRevenueDelta,
    reserveBalanceDelta: outcome.reserveBalanceDelta,
    spreadDeltas,
    infamyCharged: outcome.infamyCharged,
    chairCharacterIdHex: outcome.chairCharacterIdHex,
    record: outcome.record,
  };
}

function resultFromPlan(
  plan: ForexInterventionStoredPlan,
  duplicate: boolean,
  completedNow: boolean
): ForexInterventionResult {
  return {
    duplicate,
    completedNow,
    outcome: "applied",
    rate: plan.rate,
    macroTarget: plan.macroTarget,
    record: plan.record,
    infamyCharged: plan.infamyCharged,
    chairCharacterIdHex: plan.chairCharacterIdHex,
  };
}

function mapInterventionError(step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error {
  // The rate write is the first step, so an empty prefix means the rate row
  // vanished mid-turn (legacy ignored the miss and kept spending — here it
  // settles `failed`, fail closed, with the sentinel on the receipt for ops).
  // Anything after money moved compensates the prefix instead of stranding a
  // defended rate with undrawn reserves.
  if (step.name === "rate-write") return new Error(`${FOREX_INTERVENTION_RATE}:${outcome}`);
  if (step.name === "reserve-draw") return new Error(`${FOREX_INTERVENTION_RESERVE}:${outcome}`);
  return new Error(`${FOREX_INTERVENTION_INFAMY}:${outcome}`);
}

/**
 * Steps for one intervention, in legacy phase order: rate writeback first
 * (so a partial failure leaves exchange rates intact rather than
 * half-updated), then the combined reserve-draw/infamy bank write. The bank
 * write ensures its document first (legacy `upsert: true` parity).
 */
function buildInterventionSteps(
  db: Db,
  key: string,
  plan: ForexInterventionStoredPlan
): MoneyFlowStep[] {
  const rates = db.collection<{ _id: string }>("exchangeRates");
  const banks = db.collection<{ _id: string }>("centralBanks");
  const steps: MoneyFlowStep[] = [];

  const revertSet: Record<string, unknown> = {
    rate: plan.priorRate,
    macroTarget: plan.priorMacroTarget,
    buyVolume24: plan.priorBuyVolume24,
    sellVolume24: plan.priorSellVolume24,
    interventionPolicy: plan.priorPolicy,
    updatedAt: new Date(plan.priorUpdatedAtIso),
  };
  const revertUnset: Record<string, ""> = {};
  if (plan.priorCyclePressureRegime == null) revertUnset.cyclePressureRegime = "";
  else revertSet.cyclePressureRegime = plan.priorCyclePressureRegime;
  if (plan.priorCyclePressureUntilTurn == null) revertUnset.cyclePressureUntilTurn = "";
  else revertSet.cyclePressureUntilTurn = plan.priorCyclePressureUntilTurn;
  if (plan.priorHardPeg == null) revertUnset.hardPeg = "";
  else revertSet.hardPeg = plan.priorHardPeg;

  steps.push({
    name: "rate-write",
    apply: (stepOpts) =>
      applyKeyedUpdate(
        key,
        {
          collection: rates,
          filter: { _id: plan.countryId },
          update: {
            $set: plan.rateSet,
            ...(Object.keys(plan.rateUnset).length > 0 ? { $unset: plan.rateUnset } : {}),
          },
        },
        stepOpts ?? {}
      ),
    revert: (stepOpts) =>
      applyKeyedUpdate(
        deriveMoneyFlowKey(key, "compensate", "rate-write"),
        {
          collection: rates,
          filter: { _id: plan.countryId },
          update: {
            $set: revertSet,
            // The forward write appends exactly one snapshot (and drops the
            // oldest only when already at cap), so popping restores the prior
            // array exactly without storing ~240 snapshots on the receipt.
            $pop: { rateHistory: 1 },
            ...(Object.keys(revertUnset).length > 0 ? { $unset: revertUnset } : {}),
          },
        },
        stepOpts ?? {}
      ),
  } satisfies MoneyFlowStep);

  // One bank write mirroring the legacy single updateOne exactly: the nonzero
  // reserve $inc slices plus the infamy $set ride in the same atomic write,
  // so the observable write shape (and the crash surface) is unchanged.
  const bankInc: Record<string, number> = {};
  if (plan.forexRevenueDelta !== 0) bankInc.forexRevenue = plan.forexRevenueDelta;
  if (plan.reserveBalanceDelta !== 0) bankInc.reserveBalance = plan.reserveBalanceDelta;
  for (const [currency, delta] of Object.entries(plan.spreadDeltas)) {
    bankInc[`spreadFeeReserveBalances.${currency}`] = delta;
  }
  const hasInc = Object.keys(bankInc).length > 0;
  const hasSet = plan.infamyCharged;
  if (hasInc || hasSet) {
    const infamyAfter = Math.min(100, plan.priorChairInfamy + INTERVENTION_FAILURE_INFAMY);
    const bankNegInc = Object.fromEntries(
      Object.entries(bankInc).map(([name, amount]) => [name, -amount])
    );
    // Money primary: the combined write keeps the legacy `reserve-draw`
    // sentinel; the infamy-only write keeps `infamy-set`.
    const stepName = hasInc ? "reserve-draw" : "infamy-set";
    steps.push({
      name: stepName,
      apply: async (stepOpts) => {
        const opts = stepOpts ?? {};
        // Legacy `upsert: true` parity: a bank row deleted mid-turn is
        // recreated before the write instead of failing the turn on it.
        await insertKeyedDoc(banks, { _id: plan.bankId }, opts);
        return applyKeyedUpdate(
          key,
          {
            collection: banks,
            filter: { _id: plan.bankId },
            update: {
              ...(hasInc ? { $inc: bankInc } : {}),
              ...(hasSet ? { $set: { chairInfamy: infamyAfter } } : {}),
            },
          },
          opts
        );
      },
      revert: (stepOpts) =>
        applyKeyedUpdate(
          deriveMoneyFlowKey(key, "compensate", stepName),
          {
            collection: banks,
            filter: { _id: plan.bankId },
            update: {
              ...(hasInc ? { $inc: bankNegInc } : {}),
              ...(hasSet ? { $set: { chairInfamy: plan.priorChairInfamy } } : {}),
            },
          },
          stepOpts ?? {}
        ),
    } satisfies MoneyFlowStep);
  }

  return steps;
}

/**
 * Persist one currency's intervention (rate writeback + reserve draw + infamy
 * charge) so standalone Mongo retries converge exactly once (issue #1672).
 *
 * Engagement: a computed outcome with an audit record or an infamy charge
 * runs the keyed steps under a deterministic per-turn key, with the resume
 * plan persisted on the receipt at claim time. Anything else (null outcome,
 * or a breached-but-broke bank with no record and no charge) is a writeless
 * no-op with no receipt — the driver does the legacy bare rate write.
 *
 * A same-key retry never runs the live input: the stored plan wins, because
 * the live input is a jittered recompute of the same event. Pre-claim skips
 * stay writeless exactly like the legacy scan continuing past in-band
 * currencies.
 */
export async function applyForexInterventionSpend(
  db: Db,
  input: ForexInterventionInput
): Promise<ForexInterventionResult> {
  if (!input.countryId) throw new TypeError("Forex intervention spend needs countryId");
  if (!input.bankId) throw new TypeError("Forex intervention spend needs bankId");
  if (!Number.isFinite(input.turn)) throw new TypeError("Forex intervention spend needs turn");
  const key =
    input.idempotencyKey !== undefined
      ? resolveKey(input.idempotencyKey, "Forex intervention")
      : forexInterventionKey(input.turn, input.countryId);

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const receiptCollection = receipts as unknown as Collection<ForexInterventionReceipt>;

  const engaged =
    input.outcome !== null && (input.outcome.record !== null || input.outcome.infamyCharged);
  const noop = (duplicate: boolean): ForexInterventionResult => ({
    duplicate,
    completedNow: false,
    outcome: "noop",
    rate: input.outcome?.rate ?? 0,
    macroTarget: input.outcome?.macroTarget ?? 0,
    record: null,
    infamyCharged: false,
    chairCharacterIdHex: null,
  });

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};

    const runPlan = async (
      plan: ForexInterventionStoredPlan,
      duplicate: boolean
    ): Promise<ForexInterventionResult> => {
      await runMoneyFlowSteps(
        receipts,
        key,
        buildInterventionSteps(db, key, plan),
        mapInterventionError,
        opts
      );
      return resultFromPlan(plan, duplicate, true);
    };

    // Pre-claim live read: an existing receipt owns this event, so reconcile
    // it — a same-key retry after the writeback landed re-reads nothing
    // usable, and running the live jittered recompute would double-draw.
    const existing = await receiptCollection.findOne({ _id: key }, opts);
    if (existing) {
      if (existing.fingerprint !== input.fingerprint) throw new MoneyFlowKeyConflictError(key);
      if (existing.status === "completed") {
        return replayInterventionOutcome(db, key, opts);
      }
      if (existing.status === "failed" || existing.status === "compensated") {
        throw new MoneyFlowTerminalError(key, existing.status);
      }
      const stored = existing.forexInterventionPlan;
      const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
      if (claim === "duplicate") {
        return replayInterventionOutcome(db, key, opts);
      }
      if (isInterventionPlan(stored)) {
        return runPlan(stored, true);
      }
      // Crashed between the claim insert and the plan write: nothing applied
      // yet (the plan lands before the first step), so reconcile the live
      // input under the stored fingerprint — or stay writeless when the live
      // input is a no-op, leaving the orphan to TTL away.
      if (!engaged) return noop(true);
      const freshPlan = planFromInput(input);
      await receiptCollection.updateOne(
        { _id: key },
        { $set: { forexInterventionPlan: freshPlan, updatedAt: new Date() } },
        opts
      );
      return runPlan(freshPlan, true);
    }

    // No receipt and no engagement: writeless, exactly like the legacy path
    // writing only the bare rate row (which the driver still does).
    if (!engaged) return noop(false);

    // A fresh claim owns the attempt. A concurrent worker racing between the
    // pre-claim read and here loses the insert and reconciles above on its
    // own retry — both converge on one plan because the stored plan wins.
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    if (claim !== "fresh") {
      const raced = await receiptCollection.findOne({ _id: key }, opts);
      if (!raced) throw new Error("MONEY_FLOW_RECEIPT_LOST");
      if (raced.fingerprint !== input.fingerprint) throw new MoneyFlowKeyConflictError(key);
      if (raced.status === "completed") {
        return replayInterventionOutcome(db, key, opts);
      }
      if (raced.status === "failed" || raced.status === "compensated") {
        throw new MoneyFlowTerminalError(key, raced.status);
      }
      const stored = raced.forexInterventionPlan;
      if (isInterventionPlan(stored)) {
        return runPlan(stored, true);
      }
      if (!engaged) return noop(true);
      const freshPlan = planFromInput(input);
      await receiptCollection.updateOne(
        { _id: key },
        { $set: { forexInterventionPlan: freshPlan, updatedAt: new Date() } },
        opts
      );
      return runPlan(freshPlan, true);
    }

    const storedPlan = planFromInput(input);
    // Persist the resume plan before the first step: a crash from here on
    // resumes this exact plan under the same key.
    try {
      await receiptCollection.updateOne(
        { _id: key },
        { $set: { forexInterventionPlan: storedPlan, updatedAt: new Date() } },
        opts
      );
    } catch (planError) {
      await failMoneyFlowReceipt(receipts, key, `${FOREX_INTERVENTION_RATE}:plan-store`, opts);
      throw planError;
    }

    return runPlan(storedPlan, false);
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}

/**
 * Replay the stored outcome of a completed intervention without touching
 * balances or live state: every amount comes from the stored plan. Throws
 * when the stored plan is unusable (fail closed) or when the receipt settled
 * `failed`/`compensated`.
 */
async function replayInterventionOutcome(
  db: Db,
  key: string,
  opts: { session?: ClientSession }
): Promise<ForexInterventionResult> {
  const receiptCollection = (await getMoneyFlowReceiptsCollection(
    db
  )) as unknown as Collection<ForexInterventionReceipt>;
  const existing = await receiptCollection.findOne({ _id: key }, opts);
  const stored = existing?.forexInterventionPlan;
  if (!isInterventionPlan(stored)) throw new Error(FOREX_INTERVENTION_RECEIPT_ORPHANED);
  return resultFromPlan(stored, true, false);
}

/**
 * Key-only crash recovery for interventions (issue #1672): the turn driver
 * re-drives `in_progress` intervention receipts through their stored plans
 * before its country loop, so a crash between the rate writeback and the
 * reserve draw converges on the next turn instead of stranding a defended
 * rate with undrawn reserves (free defense) or double-drawing on a naive
 * recompute.
 *
 * Returns null when there is nothing to resume (an unrelated key, no
 * receipt, an already-`completed` receipt, or an `in_progress` receipt with
 * no usable stored plan — the loop then adopts the live input under the same
 * key). Throws `MoneyFlowTerminalError` when the receipt settled
 * `failed`/`compensated`.
 */
export async function resumeForexInterventionByKey(
  db: Db,
  key: string
): Promise<(ForexInterventionResult & { countryId: string }) | null> {
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Forex intervention idempotency key must be 1-128 characters");
  }
  const prefix = "forex-intervention:";
  if (!key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  const separator = rest.indexOf(":");
  if (separator < 0) return null;
  const turn = Number(rest.slice(0, separator));
  const countryId = rest.slice(separator + 1);
  if (!Number.isFinite(turn) || countryId.length === 0) return null;
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const receiptCollection = receipts as unknown as Collection<ForexInterventionReceipt>;
  const existing = await receiptCollection.findOne({ _id: key });
  if (!existing) return null;
  if (existing.status === "completed") return null;
  if (existing.status === "failed" || existing.status === "compensated") {
    throw new MoneyFlowTerminalError(key, existing.status);
  }
  if (existing.status !== "in_progress") return null;
  const stored = existing.forexInterventionPlan;
  if (!isInterventionPlan(stored)) return null;
  if (stored.countryId !== countryId || stored.turn !== turn) return null;
  const runResume = async (session?: ClientSession): Promise<ForexInterventionResult> => {
    const opts = session ? { session } : {};
    await runMoneyFlowSteps(
      receipts,
      key,
      buildInterventionSteps(db, key, stored),
      mapInterventionError,
      opts
    );
    return resultFromPlan(stored, true, true);
  };
  const result = await runWithOptionalTransaction(
    async (session) => runResume(session),
    async () => runResume()
  );
  return { ...result, countryId };
}
