import { ObjectId, type Db } from "mongodb";
import type { Corporation, IndexFund, ShareOrder } from "@/lib/db/types";
import { corpLiquidCapitalToAnchor } from "@/lib/currency/corporationCapital";
import { insertFundTransaction } from "@/lib/indexFunds/fundQueries";

/**
 * Index-fund-owned order-book buy orders.
 *
 * Funds may place limit *buy* orders against a corporation's public float that
 * rest on the order book and fill in the turn matcher (`fillPendingShareOrders`)
 * when the market price falls to/under the limit. Sells are handled by the
 * existing float-sell / redemption paths, so only buy placement + cancel live
 * here.
 *
 * Money conservation: at placement the fund's `cashAnchor` is debited (atomic,
 * balance-gated) by the full anchor escrow. On fill the matcher refunds the
 * unused portion (`escrow − actualCost`) back to `cashAnchor` and routes the
 * actual cost into the issuer treasury — exactly mirroring a character buy. On
 * cancel the remaining (un-filled) escrow is refunded to `cashAnchor`.
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

  const now = new Date();
  const orderId = new ObjectId();
  try {
    await db.collection<ShareOrder>("shareOrders").insertOne({
      _id: orderId,
      corporationId: corp._id,
      placerFundId: fund._id,
      type: "buy",
      shares,
      sharesRemaining: shares,
      pricePerShare: limitPriceLocal,
      escrowAmount,
      escrowAnchor,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });

    await insertFundTransaction(db, {
      fundId: fund._id,
      kind: "public_float_buy",
      corporationId: corp._id,
      shares,
      amountAnchor: escrowAnchor,
      note: "limit_buy_order_escrow",
      createdAt: now,
    });
  } catch (err) {
    // Roll the escrow back if we couldn't persist the order.
    await refundFundCashAnchor(db, fund._id, escrowAnchor);
    throw err;
  }

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
    await refundFundCashAnchor(db, claimed.placerFundId, refundAnchor);
  }
}
