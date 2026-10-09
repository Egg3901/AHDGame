import { ObjectId, type Db } from "mongodb";
import type { Corporation, IndexFund, IndexFundTransaction, ShareOrder } from "@/lib/db/types";
import { corpLiquidCapitalToAnchor } from "@/lib/currency/corporationCapital";
import { insertFundTransaction } from "@/lib/indexFunds/fundQueries";
import { emitTx, type TxInput } from "@/lib/financialTxLog/emit";
import type { TxThresholds } from "@/lib/db/types/financialTxLog";

/**
 * Index-fund-owned order-book buy orders.
 *
 * Funds may place limit *buy* orders against a corporation's public float that
 * rest on the order book. They fill either when the turn matcher sees the
 * market price at or below the limit, or when a shareholder submits a market
 * sell that the quote can cover. Sell quote placement and cancellation live
 * here as well.
 *
 * Money conservation: at placement the fund's `cashAnchor` is debited (atomic,
 * balance-gated) by the full anchor escrow. On fill the matcher refunds the
 * unused portion (`escrow − actualCost`) back to `cashAnchor`. A float fill
 * routes cost to the issuer; a shareholder market sell routes escrow to that
 * seller. On cancel the remaining unfilled escrow returns to `cashAnchor`.
 */

/**
 * Atomically debit `amountAnchor` from a fund's `cashAnchor`, gated on a
 * sufficient balance. Returns false when the fund can't cover it (no mutation).
 */
async function atomicallyDebitFundCashAnchor(
  db: Db,
  fundId: ObjectId,
  amountAnchor: number
): Promise<boolean> {
  if (!Number.isFinite(amountAnchor) || amountAnchor <= 0) return false;
  const res = await db
    .collection<IndexFund>("indexFunds")
    .updateOne(
      { _id: fundId, cashAnchor: { $gte: amountAnchor } },
      { $inc: { cashAnchor: -amountAnchor }, $set: { updatedAt: new Date() } }
    );
  return res.matchedCount > 0;
}

/** Refund `amountAnchor` back to a fund's `cashAnchor`. */
async function refundFundCashAnchor(db: Db, fundId: ObjectId, amountAnchor: number): Promise<void> {
  if (!Number.isFinite(amountAnchor) || amountAnchor <= 0) return;
  await db
    .collection<IndexFund>("indexFunds")
    .updateOne(
      { _id: fundId },
      { $inc: { cashAnchor: amountAnchor }, $set: { updatedAt: new Date() } }
    );
}

export interface PlaceFundShareBuyOrderInput {
  fund: Pick<IndexFund, "_id" | "name" | "anchorCurrencyCode">;
  corp: Pick<Corporation, "_id" | "liquidCurrencyCode" | "countryId">;
  shares: number;
  /** Premium limit price in the target corp's local currency. */
  limitPriceLocal: number;
  /** FX rate (local per 1 ₳) for the target corp's home currency. */
  fxRate: number;
  /** Game turn stamped on the ledger escrow row (#992 tranche 4). */
  turn: number;
  /** Reused for a turn pass placing many fund bids. */
  thresholds?: TxThresholds;
  /** Reused turn cadence for transaction expiry during a quote pass. */
  turnLengthMinutes?: number;
  liquidityQuote?: { turn: number; referencePrice: number };
  /**
   * When set, the escrow transaction row is pushed here instead of inserted,
   * for a caller placing many bids that writes them in one insertMany.
   */
  txSink?: Omit<IndexFundTransaction, "_id">[];
  /** Caller flushes escrow ledger rows after completed bid placements. */
  ledgerSink?: TxInput[];
}

export interface PlaceFundShareBuyOrderResult {
  ok: boolean;
  orderId?: ObjectId;
  reason?: string;
}

/**
 * Place a resting index-fund-owned limit buy order. Debits the fund's
 * `cashAnchor` by the anchor escrow up front, then inserts an `open` buy
 * `ShareOrder` carrying `placerFundId`, the corp-local `escrowAmount`, and the
 * debited `escrowAnchor`. No `characterId` is set.
 */
export async function placeFundShareBuyOrder(
  db: Db,
  input: PlaceFundShareBuyOrderInput
): Promise<PlaceFundShareBuyOrderResult> {
  const { fund, corp, shares, limitPriceLocal, fxRate } = input;

  if (!Number.isFinite(shares) || shares <= 0) {
    return { ok: false, reason: "Invalid share quantity" };
  }
  if (!Number.isFinite(limitPriceLocal) || limitPriceLocal <= 0) {
    return { ok: false, reason: "Invalid limit price" };
  }

  // Escrow is stored in the corp's local currency (Option B) so partial fills
  // subtract cleanly. The fund pays from cashAnchor (₳), so convert local → ₳.
  const escrowAmount = shares * limitPriceLocal;
  const escrowAnchor = corpLiquidCapitalToAnchor(escrowAmount, corp, fxRate);

  const debited = await atomicallyDebitFundCashAnchor(db, fund._id, escrowAnchor);
  if (!debited) {
    return { ok: false, reason: "Insufficient fund cash for escrow" };
  }

  const orderId = new ObjectId();
  const rows = fundBuyOrderRows(input, orderId, escrowAmount, escrowAnchor, new Date());
  try {
    await db.collection<ShareOrder>("shareOrders").insertOne(rows.order);
    if (input.txSink) input.txSink.push(rows.escrowTx);
    else await insertFundTransaction(db, rows.escrowTx);
    if (input.ledgerSink) input.ledgerSink.push(rows.ledgerEntry);
    else
      await emitTx(db, rows.ledgerEntry, input.thresholds, {
        turnLengthMinutes: input.turnLengthMinutes,
      });
  } catch (err) {
    // Roll the escrow back if we couldn't persist the order.
    await refundFundCashAnchor(db, fund._id, escrowAnchor);
    throw err;
  }

  return { ok: true, orderId };
}

/** The resting order, escrow transaction and escrow ledger row of one fund bid. */
function fundBuyOrderRows(
  input: PlaceFundShareBuyOrderInput,
  orderId: ObjectId,
  escrowAmount: number,
  escrowAnchor: number,
  now: Date
): {
  order: ShareOrder;
  escrowTx: Omit<IndexFundTransaction, "_id">;
  ledgerEntry: TxInput;
} {
  const { fund, corp, shares, limitPriceLocal } = input;
  const order = {
    _id: orderId,
    corporationId: corp._id,
    placerFundId: fund._id,
    type: "buy",
    shares,
    sharesRemaining: shares,
    pricePerShare: limitPriceLocal,
    escrowAmount,
    escrowAnchor,
    ...(input.liquidityQuote
      ? {
          liquidityProvider: true,
          liquidityQuotedTurn: input.liquidityQuote.turn,
          liquidityReferencePrice: input.liquidityQuote.referencePrice,
        }
      : {}),
    status: "open",
    createdAt: now,
    updatedAt: now,
  } as ShareOrder;
  const escrowTx = {
    fundId: fund._id,
    kind: "public_float_buy" as const,
    corporationId: corp._id,
    shares,
    amountAnchor: escrowAnchor,
    note: "limit_buy_order_escrow",
    createdAt: now,
  };
  // #992 tranche 4: fund-subject escrow leg. The debit already moved
  // cashAnchor, so this row evidences it (same order_escrow reason as the
  // character/corporation placement rows; the refund shares it so a
  // placement nets against its own cancel per currency). Fund-subject rows
  // never mirror, so this is the only ledger row for the debit.
  const ledgerEntry: TxInput = {
    type: "stock_order_escrow",
    turn: input.turn,
    createdAt: now,
    subjectType: "fund",
    subjectId: fund._id,
    subjectName: fund.name,
    amount: -escrowAnchor,
    anchorAmount: -escrowAnchor,
    currencyCode: fund.anchorCurrencyCode,
    counterpartyType: "system",
    counterpartyName: "Order book escrow",
    meta: {
      orderId: orderId.toString(),
      orderType: "buy",
      targetCorporationId: corp._id.toString(),
      escrowAmountAnchor: escrowAnchor,
    },
  };
  return { order, escrowTx, ledgerEntry };
}

export interface FundQuotePlacement {
  bid: PlaceFundShareBuyOrderInput;
  /** Ask placed only after this pair's bid lands, as in the one-at-a-time path. */
  ask?: Omit<PlaceFundShareSellOrderInput, "fund" | "reservedOpenShares">;
}

/**
 * Place one fund's bid/ask quote pairs in a fixed number of round trips. The
 * one-at-a-time path debits each bid's escrow against the running balance and
 * skips a pair whose bid it cannot fund; this replays exactly that decision
 * sequence in memory from the fund's current cash, then takes the whole
 * escrow in one balance-guarded debit and inserts every order together.
 * Returns null (nothing written) if the cash moved underneath, so the caller
 * can fall back to placing the quotes one at a time.
 */
export async function placeFundQuotesBatch(
  db: Db,
  fund: Pick<IndexFund, "_id" | "name" | "anchorCurrencyCode" | "holdings">,
  placements: readonly FundQuotePlacement[],
  reservedSharesByCorp: Map<string, number>
): Promise<{
  results: { bid: PlaceFundShareBuyOrderResult; ask?: PlaceFundShareBuyOrderResult }[];
  escrowTxs: Omit<IndexFundTransaction, "_id">[];
  ledgerEntries: TxInput[];
} | null> {
  const current = await db
    .collection<IndexFund>("indexFunds")
    .findOne({ _id: fund._id }, { projection: { cashAnchor: 1 } });
  if (!current) return null;
  let cash = current.cashAnchor;
  let totalEscrow = 0;
  const reserved = new Map(reservedSharesByCorp);
  const now = new Date();
  const orders: ShareOrder[] = [];
  const escrowTxs: Omit<IndexFundTransaction, "_id">[] = [];
  const ledgerEntries: TxInput[] = [];
  const results: { bid: PlaceFundShareBuyOrderResult; ask?: PlaceFundShareBuyOrderResult }[] = [];
  for (const { bid, ask } of placements) {
    const { shares, limitPriceLocal, corp, fxRate } = bid;
    if (!Number.isFinite(shares) || shares <= 0) {
      results.push({ bid: { ok: false, reason: "Invalid share quantity" } });
      continue;
    }
    if (!Number.isFinite(limitPriceLocal) || limitPriceLocal <= 0) {
      results.push({ bid: { ok: false, reason: "Invalid limit price" } });
      continue;
    }
    const escrowAmount = shares * limitPriceLocal;
    const escrowAnchor = corpLiquidCapitalToAnchor(escrowAmount, corp, fxRate);
    // Same gate as atomicallyDebitFundCashAnchor, against the running balance.
    if (!Number.isFinite(escrowAnchor) || escrowAnchor <= 0 || !(cash >= escrowAnchor)) {
      results.push({ bid: { ok: false, reason: "Insufficient fund cash for escrow" } });
      continue;
    }
    cash -= escrowAnchor;
    totalEscrow += escrowAnchor;
    const orderId = new ObjectId();
    const rows = fundBuyOrderRows({ ...bid, fund }, orderId, escrowAmount, escrowAnchor, now);
    orders.push(rows.order);
    escrowTxs.push(rows.escrowTx);
    ledgerEntries.push(rows.ledgerEntry);
    const result: { bid: PlaceFundShareBuyOrderResult; ask?: PlaceFundShareBuyOrderResult } = {
      bid: { ok: true, orderId },
    };
    if (ask) {
      const corpKey = ask.corp._id.toString();
      const held = reserved.get(corpKey) ?? 0;
      const decision = fundSellOrderDecision(fund, { ...ask, reservedOpenShares: held });
      if (!decision.ok) {
        result.ask = decision;
      } else {
        const askId = new ObjectId();
        orders.push(fundSellOrderDoc({ ...ask, fund }, askId, now));
        reserved.set(corpKey, held + ask.shares);
        result.ask = { ok: true, orderId: askId };
      }
    }
    results.push(result);
  }
  if (totalEscrow > 0) {
    const debited = await db
      .collection<IndexFund>("indexFunds")
      .updateOne(
        { _id: fund._id, cashAnchor: current.cashAnchor },
        { $inc: { cashAnchor: -totalEscrow }, $set: { updatedAt: now } }
      );
    if (!debited.matchedCount) return null;
  }
  if (orders.length) {
    try {
      await db.collection<ShareOrder>("shareOrders").insertMany(orders, { ordered: true });
    } catch (err) {
      // Roll back the escrow of every bid whose order did not persist.
      const landed = new Set(
        (
          await db
            .collection<ShareOrder>("shareOrders")
            .find({ _id: { $in: orders.map((order) => order._id) } }, { projection: { _id: 1 } })
            .toArray()
        ).map((row) => row._id.toString())
      );
      const lost = orders
        .filter((order) => order.type === "buy" && !landed.has(order._id.toString()))
        .reduce((sum, order) => sum + (order.escrowAnchor ?? 0), 0);
      await refundFundCashAnchor(db, fund._id, lost);
      throw err;
    }
  }
  for (const [key, value] of reserved) reservedSharesByCorp.set(key, value);
  return { results, escrowTxs, ledgerEntries };
}

export interface PlaceFundShareSellOrderInput {
  fund: Pick<IndexFund, "_id" | "name" | "holdings">;
  corp: Pick<Corporation, "_id">;
  shares: number;
  /** Ask price in the target corporation's local currency. */
  limitPriceLocal: number;
  liquidityQuote?: { turn: number; referencePrice: number };
  /** Open asks already loaded by a caller placing several quotes for this fund. */
  reservedOpenShares?: number;
}

/**
 * Place an executable fund-owned ask without moving inventory at quote time.
 * Existing open asks reserve their remaining shares for the availability
 * check. Settlement performs guarded debits against both the cap table and the
 * fund holdings ledger, so a concurrent redemption cannot create shares.
 */
export async function placeFundShareSellOrder(
  db: Db,
  input: PlaceFundShareSellOrderInput
): Promise<PlaceFundShareBuyOrderResult> {
  const { fund, corp } = input;
  const reserved =
    input.reservedOpenShares ??
    (
      await db
        .collection<ShareOrder>("shareOrders")
        .find({
          placerFundId: fund._id,
          corporationId: corp._id,
          type: "sell",
          status: "open",
        })
        .toArray()
    ).reduce((sum, order) => sum + order.sharesRemaining, 0);
  const decision = fundSellOrderDecision(fund, { ...input, reservedOpenShares: reserved });
  if (!decision.ok) return decision;

  const orderId = new ObjectId();
  await db
    .collection<ShareOrder>("shareOrders")
    .insertOne(fundSellOrderDoc(input, orderId, new Date()));
  return { ok: true, orderId };
}

/** Validation and inventory check of one fund ask, given its open reservations. */
function fundSellOrderDecision(
  fund: Pick<IndexFund, "holdings">,
  input: Pick<PlaceFundShareSellOrderInput, "corp" | "shares" | "limitPriceLocal"> & {
    reservedOpenShares: number;
  }
): PlaceFundShareBuyOrderResult {
  const { corp, shares, limitPriceLocal } = input;
  if (!Number.isFinite(shares) || shares <= 0) {
    return { ok: false, reason: "Invalid share quantity" };
  }
  if (!Number.isFinite(limitPriceLocal) || limitPriceLocal <= 0) {
    return { ok: false, reason: "Invalid limit price" };
  }
  const holding = fund.holdings.find((row) => row.corporationId.toString() === corp._id.toString());
  if ((holding?.shares ?? 0) - input.reservedOpenShares < shares) {
    return { ok: false, reason: "Insufficient unreserved fund shares" };
  }
  return { ok: true };
}

function fundSellOrderDoc(
  input: Pick<
    PlaceFundShareSellOrderInput,
    "fund" | "corp" | "shares" | "limitPriceLocal" | "liquidityQuote"
  >,
  orderId: ObjectId,
  now: Date
): ShareOrder {
  const { fund, corp, shares, limitPriceLocal } = input;
  return {
    _id: orderId,
    corporationId: corp._id,
    placerFundId: fund._id,
    type: "sell",
    shares,
    sharesRemaining: shares,
    pricePerShare: limitPriceLocal,
    escrowAmount: 0,
    ...(input.liquidityQuote
      ? {
          liquidityProvider: true,
          liquidityQuotedTurn: input.liquidityQuote.turn,
          liquidityReferencePrice: input.liquidityQuote.referencePrice,
        }
      : {}),
    status: "open",
    createdAt: now,
    updatedAt: now,
  } as ShareOrder;
}

/**
 * Cancel an open/partially-filled fund-owned buy order. Marks it `cancelled`
 * and refunds the remaining `escrowAnchor` to the fund's `cashAnchor`.
 *
 * The matcher decrements `escrowAnchor` proportionally on each partial fill, so
 * the stored value is exactly the un-filled escrow at cancel time — refund it
 * verbatim. No-op if the order is missing, not a fund order, or already closed.
 */
export async function cancelFundShareOrder(
  db: Db,
  orderId: ObjectId,
  turn?: number,
  options?: {
    /** Preloaded thresholds for the refund row; avoids a per-cancel read. */
    thresholds?: TxThresholds;
    /** Preloaded turn cadence for the transaction expiry date. */
    turnLengthMinutes?: number;
    /** Preloaded fund metadata; used only when it matches the claimed order. */
    fund?: Pick<IndexFund, "_id" | "name" | "anchorCurrencyCode">;
    /** Caller flushes refund rows after all completed cancellations. */
    ledgerSink?: TxInput[];
  }
): Promise<void> {
  // Atomically claim the order so a concurrent fill/cancel can't double-refund.
  const claimed = await db
    .collection<ShareOrder>("shareOrders")
    .findOneAndUpdate(
      { _id: orderId, status: "open" },
      { $set: { status: "cancelled", updatedAt: new Date() } },
      { returnDocument: "before" }
    );

  if (!claimed) return;
  if (!claimed.placerFundId) {
    // Not a fund order — restore status; this helper only handles fund orders.
    await db
      .collection<ShareOrder>("shareOrders")
      .updateOne({ _id: orderId, status: "cancelled" }, { $set: { status: "open" } });
    return;
  }

  const refundAnchor = claimed.escrowAnchor ?? 0;
  if (refundAnchor > 0) {
    await refundFundCashAnchor(db, claimed.placerFundId, refundAnchor);
    // #992 tranche 4: fund-subject refund leg for the cash just credited back.
    // Same order_escrow reason as the placement row so the pair nets per
    // currency. The claim above guarantees exactly one refund per order, so
    // exactly one row. No-op refunds (fully-filled escrow already zeroed)
    // move no cash and emit nothing.
    if (turn !== undefined) {
      const fund =
        options?.fund?._id.toString() === claimed.placerFundId.toString()
          ? options.fund
          : await db
              .collection<IndexFund>("indexFunds")
              .findOne(
                { _id: claimed.placerFundId },
                { projection: { name: 1, anchorCurrencyCode: 1 } }
              );
      if (fund) {
        const now = new Date();
        const ledgerEntry: TxInput = {
          type: "stock_order_refund",
          turn,
          createdAt: now,
          subjectType: "fund",
          subjectId: claimed.placerFundId,
          subjectName: fund.name,
          amount: refundAnchor,
          anchorAmount: refundAnchor,
          currencyCode: fund.anchorCurrencyCode,
          counterpartyType: "system",
          counterpartyName: "Order book escrow",
          meta: {
            orderId: orderId.toString(),
            orderType: claimed.type,
            targetCorporationId: claimed.corporationId.toString(),
            escrowAmountAnchor: refundAnchor,
          },
        };
        if (options?.ledgerSink) options.ledgerSink.push(ledgerEntry);
        else
          await emitTx(db, ledgerEntry, options?.thresholds, {
            turnLengthMinutes: options?.turnLengthMinutes,
          });
      }
    }
  }
}

/**
 * Cancel many open orders of one fund in three round trips: claim them in one
 * bulk write, read back exactly which claims landed, refund their remaining
 * escrow in one credit. Same claim-then-refund order, refund amounts and
 * refund rows as {@link cancelFundShareOrder} one at a time; an order another
 * worker already filled or cancelled is left alone. Returns true once the
 * orders are handled.
 */
export async function cancelFundShareOrdersBatch(
  db: Db,
  fund: Pick<IndexFund, "_id" | "name" | "anchorCurrencyCode">,
  orderIds: readonly ObjectId[],
  turn: number | undefined,
  options: { ledgerSink: TxInput[] }
): Promise<boolean> {
  if (!orderIds.length) return true;
  const claimId = new ObjectId();
  const now = new Date();
  await db.collection<ShareOrder>("shareOrders").bulkWrite(
    orderIds.map((_id) => ({
      updateOne: {
        filter: { _id, status: "open", placerFundId: fund._id },
        update: { $set: { status: "cancelled", updatedAt: now, cancelClaimId: claimId } },
      },
    })),
    { ordered: false }
  );
  const position = new Map(orderIds.map((id, i) => [id.toString(), i]));
  const claimed = (
    await db
      .collection<ShareOrder>("shareOrders")
      .find(
        { _id: { $in: [...orderIds] }, cancelClaimId: claimId },
        { projection: { _id: 1, type: 1, corporationId: 1, escrowAnchor: 1 } }
      )
      .toArray()
  ).sort((a, b) => (position.get(a._id.toString()) ?? 0) - (position.get(b._id.toString()) ?? 0));
  const refunds = claimed.filter((order) => (order.escrowAnchor ?? 0) > 0);
  const refundAnchor = refunds.reduce((sum, order) => sum + (order.escrowAnchor ?? 0), 0);
  if (refundAnchor > 0) await refundFundCashAnchor(db, fund._id, refundAnchor);
  if (turn === undefined) return true;
  for (const order of refunds) {
    const amount = order.escrowAnchor ?? 0;
    options.ledgerSink.push({
      type: "stock_order_refund",
      turn,
      createdAt: now,
      subjectType: "fund",
      subjectId: fund._id,
      subjectName: fund.name,
      amount,
      anchorAmount: amount,
      currencyCode: fund.anchorCurrencyCode,
      counterpartyType: "system",
      counterpartyName: "Order book escrow",
      meta: {
        orderId: order._id.toString(),
        orderType: order.type,
        targetCorporationId: order.corporationId.toString(),
        escrowAmountAnchor: amount,
      },
    });
  }
  return true;
}
