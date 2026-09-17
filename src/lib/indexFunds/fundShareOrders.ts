import { randomUUID } from "node:crypto";
import { ObjectId, type Db, type Filter } from "mongodb";
import type { Corporation, IndexFund, IndexFundTransaction, ShareOrder } from "@/lib/db/types";
import { corpLiquidCapitalToAnchor } from "@/lib/currency/corporationCapital";
import { insertFundTransaction } from "@/lib/indexFunds/fundQueries";
import {
  applyKeyedUpdate,
  deriveMoneyFlowKey,
  insertKeyedDoc,
  keyedInsertId,
  type MoneyFlowAccount,
} from "@/lib/db/nonAtomicMoneyFlow";

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

export interface PlaceFundShareBuyOrderInput {
  fund: Pick<IndexFund, "_id" | "name" | "anchorCurrencyCode">;
  corp: Pick<Corporation, "_id" | "liquidCurrencyCode" | "countryId">;
  shares: number;
  /** Premium limit price in the target corp's local currency. */
  limitPriceLocal: number;
  /** FX rate (local per 1 ₳) for the target corp's home currency. */
  fxRate: number;
  liquidityQuote?: { turn: number; referencePrice: number };
  /**
   * When set, the escrow transaction row is pushed here instead of inserted,
   * for a caller placing many bids that writes them in one insertMany.
   * The row is pushed only when the order insert freshly applied, never on
   * a same-key replay (which already recorded it).
   */
  txSink?: Omit<IndexFundTransaction, "_id">[];
  /**
   * Caller-supplied idempotency key. The rebalance pass derives one per bid
   * leg from its parent key so a same-pass retry resumes instead of
   * double-escrowing. Omit to mint one: the attempt is still guarded by the
   * atomic debit, but a retry mints a new key and is treated as a new bid.
   */
  keyOptions?: { idempotencyKey?: string };
}

export interface PlaceFundShareBuyOrderResult {
  ok: boolean;
  orderId?: ObjectId;
  reason?: string;
  /**
   * True when the order already existed under this key (a same-key replay
   * converged without moving money). Callers tally placements only when
   * this is false.
   */
  duplicate?: boolean;
}

/**
 * Place a resting index-fund-owned limit buy order. Debits the fund's
 * `cashAnchor` by the anchor escrow up front, then inserts an `open` buy
 * `ShareOrder` carrying `placerFundId`, the corp-local `escrowAmount`, and the
 * debited `escrowAnchor`. No `characterId` is set.
 *
 * Crash-safe placement (issue #1672): the escrow debit carries an
 * amount-bound idempotent sub-operation key and the order `_id` derives from
 * the flow key, so a crash between the debit and the insert resumes to
 * exactly one debit and one order instead of stranding escrow with no order
 * (the legacy debit-then-insert left exactly that strand on a crash). A
 * same-key retry with the SAME amounts converges; a same-key retry with
 * different amounts debits and inserts separately (money-conserved, never
 * confused with the first attempt) because both the subkey and the order id
 * bind the amounts.
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

  const key = input.keyOptions?.idempotencyKey !== undefined
    ? input.keyOptions.idempotencyKey
    : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Fund bid idempotency key must be 1-128 characters");
  }
  const escrowCents = String(Math.round(escrowAnchor * 100) / 100);
  const debitSubkey = deriveMoneyFlowKey(key, "escrow", escrowCents);
  const funds = db.collection<MoneyFlowAccount>("indexFunds");

  const debitOutcome = await applyKeyedUpdate(
    debitSubkey,
    {
      collection: funds,
      filter: { _id: fund._id, cashAnchor: { $gte: escrowAnchor } } as Filter<MoneyFlowAccount>,
      update: {
        $inc: { cashAnchor: -escrowAnchor },
        $set: { updatedAt: new Date() },
      },
    }
  );
  if (debitOutcome !== "applied" && debitOutcome !== "already-applied") {
    return { ok: false, reason: "Insufficient fund cash for escrow" };
  }

  const now = new Date();
  const orderId = keyedInsertId(key, `indexfund-bid-order:${escrowCents}`);
  const insertOutcome = await (async () => {
    try {
      return await insertKeyedDoc(db.collection<ShareOrder>("shareOrders"), {
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
      });
    } catch (err) {
      // Roll the escrow back if we couldn't persist the order. The
      // compensation carries its own key so a retried refund converges.
      await applyKeyedUpdate(
        deriveMoneyFlowKey(debitSubkey, "compensate", "escrow"),
        {
          collection: funds,
          filter: { _id: fund._id } as Filter<MoneyFlowAccount>,
          update: {
            $inc: { cashAnchor: escrowAnchor },
            $set: { updatedAt: new Date() },
          },
        }
      );
      throw err;
    }
  })();

  if (insertOutcome === "applied") {
    const escrowTx = {
      fundId: fund._id,
      kind: "public_float_buy" as const,
      corporationId: corp._id,
      shares,
      amountAnchor: escrowAnchor,
      note: "limit_buy_order_escrow",
      createdAt: now,
    };
    if (input.txSink) input.txSink.push(escrowTx);
    else await insertFundTransaction(db, escrowTx);
  }

  return { ok: true, orderId, duplicate: insertOutcome === "already-applied" };
}

export interface PlaceFundShareSellOrderInput {
  fund: Pick<IndexFund, "_id" | "name" | "holdings">;
  corp: Pick<Corporation, "_id">;
  shares: number;
  /** Ask price in the target corporation's local currency. */
  limitPriceLocal: number;
  liquidityQuote?: { turn: number; referencePrice: number };
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
  const { fund, corp, shares, limitPriceLocal } = input;
  if (!Number.isFinite(shares) || shares <= 0) {
    return { ok: false, reason: "Invalid share quantity" };
  }
  if (!Number.isFinite(limitPriceLocal) || limitPriceLocal <= 0) {
    return { ok: false, reason: "Invalid limit price" };
  }

  const holding = fund.holdings.find((row) => row.corporationId.toString() === corp._id.toString());
  const openAsks = await db
    .collection<ShareOrder>("shareOrders")
    .find({
      placerFundId: fund._id,
      corporationId: corp._id,
      type: "sell",
      status: "open",
    })
    .toArray();
  const reserved = openAsks.reduce((sum, order) => sum + order.sharesRemaining, 0);
  if ((holding?.shares ?? 0) - reserved < shares) {
    return { ok: false, reason: "Insufficient unreserved fund shares" };
  }

  const now = new Date();
  const orderId = new ObjectId();
  await db.collection<ShareOrder>("shareOrders").insertOne({
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
  });

  return { ok: true, orderId };
}

/**
 * Cancel an open/partially-filled fund-owned buy order. Marks it `cancelled`
 * and refunds the remaining `escrowAnchor` to the fund's `cashAnchor`.
 *
 * The matcher decrements `escrowAnchor` proportionally on each partial fill, so
 * the stored value is exactly the un-filled escrow at cancel time — refund it
 * verbatim. No-op if the order is missing, not a fund order, or already closed.
 */
export async function cancelFundShareOrder(db: Db, orderId: ObjectId): Promise<void> {
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
    // Keyed refund (issue #1672): a crash between the claim above and the
    // refund used to strand escrow forever (a retry finds the order already
    // `cancelled` and no-ops). The refund carries a key derived from the
    // order id, so a resumed cancel refunds exactly once.
    await applyKeyedUpdate(
      `indexfund-bid-cancel:${orderId.toHexString()}`,
      {
        collection: db.collection<MoneyFlowAccount>("indexFunds"),
        filter: { _id: claimed.placerFundId } as Filter<MoneyFlowAccount>,
        update: {
          $inc: { cashAnchor: refundAnchor },
          $set: { updatedAt: new Date() },
        },
      }
    );
  }
}
