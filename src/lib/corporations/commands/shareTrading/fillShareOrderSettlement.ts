/**
 * Settlement helpers for fillShareOrder — extracted verbatim (pure code
 * motion; no behavior change). Live production money-path code: the
 * buy-order settlement branch, party-name resolvers, and the post-fill
 * totalShares invariant correction.
 */
import { NextResponse } from "next/server";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Corporation, ShareListing, ShareOrder } from "@/lib/db/types";
import {
  creditShares,
  creditSharesToFund,
  creditSharesToImperial,
  creditSharesToCorp,
  debitShares,
  debitSharesFromCorp,
  debitSharesFromFund,
  debitSharesFromImperial,
} from "@/lib/corporations/shareholderOps";
import { buildPersonalBalanceInc } from "@/lib/currency/characterFunds";
import { emitTx } from "@/lib/financialTxLog/emit";
import { computeAccountedShares } from "@/lib/corporations/shareInvariant";
import type { CurrencyCode } from "@/lib/constants/currencies";

export const resolveCharName = async (
  db: Db,
  id: ObjectId,
  isImperial: boolean
): Promise<string> => {
  const coll = isImperial ? "imperialCharacters" : "characters";
  const doc = await db
    .collection<{ _id: ObjectId; name?: string }>(coll)
    .findOne({ _id: id }, { projection: { name: 1 } });
  return doc?.name ?? (isImperial ? "Unknown imperial" : "Unknown character");
};

export const resolveCorpName = async (db: Db, id: ObjectId): Promise<string> => {
  const doc = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: id }, { projection: { name: 1 } });
  return doc?.name ?? "Unknown corporation";
};

/**
 * Settle a fill against a BUY order — the filler is selling; the buyer's
 * money is already in escrow. Transfers shares from the filler to the buyer
 * (fund, corp, or character) and releases escrow to the filler, with full
 * compensating rollback on failure. Returns an error response, or null on
 * success.
 */
export async function settleBuyOrderFill(args: {
  db: Db;
  corporation: Corporation;
  order: ShareOrder;
  orderCharacterId: ShareOrder["characterId"];
  buyOrderBuyerCorp: Pick<Corporation, "_id" | "name"> | null;
  shares: number;
  total: number;
  totalInFillerHome: number;
  fillerId: ObjectId;
  fillerName: string;
  fillerCollectionName: "characters" | "imperialCharacters";
  fillerHomeCurrency: CurrencyCode;
  isImperialFiller: boolean;
  forexEnabled: boolean;
  currentTurn: number;
  now: Date;
  restoreClaimedOrder: () => Promise<void>;
}): Promise<NextResponse | null> {
  const {
    db,
    corporation,
    order,
    orderCharacterId,
    buyOrderBuyerCorp,
    shares,
    total,
    totalInFillerHome,
    fillerId,
    fillerName,
    fillerCollectionName,
    fillerHomeCurrency,
    isImperialFiller,
    forexEnabled,
    currentTurn,
    now,
    restoreClaimedOrder,
  } = args;

  const fillerAvgCost =
    corporation.shareholders?.find((sh) =>
      isImperialFiller ? sh.imperialCharacterId?.equals(fillerId) : sh.characterId?.equals(fillerId)
    )?.avgCostPerShare ?? order.pricePerShare;
  let sellerSharesDebited = false;
  let buyerSharesCredited = false;
  let fillerEscrowReleased = false;
  try {
    // Transfer shares from filler to buyer (fund, corp, or character)
    const debitFillerShares = async () => {
      const remaining = isImperialFiller
        ? await debitSharesFromImperial(
            db,
            corporation._id,
            fillerId,
            shares,
            { $set: { updatedAt: now } },
            { requireSufficient: true }
          )
        : await debitShares(
            db,
            corporation._id,
            fillerId,
            shares,
            { $set: { updatedAt: now } },
            { requireSufficient: true }
          );
      return remaining;
    };

    if (order.placerFundId) {
      const remaining = await debitFillerShares();
      if (remaining < 0) {
        await restoreClaimedOrder();
        return NextResponse.json(
          { error: "You no longer have enough shares to fill this order" },
          { status: 409 }
        );
      }
      sellerSharesDebited = true;
      // pricePerShare for cost-basis is stored in anchor (₳) to match turn-engine behaviour.
      const fillPriceAnchor = shares > 0 ? total / shares : 0;
      await creditSharesToFund(db, corporation._id, order.placerFundId, shares, fillPriceAnchor, {
        $set: { updatedAt: now },
      });
      buyerSharesCredited = true;
    } else if (order.placerCorporationId) {
      const remaining = await debitFillerShares();
      if (remaining < 0) {
        await restoreClaimedOrder();
        return NextResponse.json(
          { error: "You no longer have enough shares to fill this order" },
          { status: 409 }
        );
      }
      sellerSharesDebited = true;
      await creditSharesToCorp(
        db,
        corporation._id,
        order.placerCorporationId,
        shares,
        order.pricePerShare,
        { $set: { updatedAt: now } }
      );
      buyerSharesCredited = true;
    } else {
      // Transfer to another character — debit from filler, credit to buyer
      const remaining = await debitFillerShares();
      if (remaining < 0) {
        await restoreClaimedOrder();
        return NextResponse.json(
          { error: "You no longer have enough shares to fill this order" },
          { status: 409 }
        );
      }
      sellerSharesDebited = true;
      await creditShares(
        db,
        corporation._id,
        orderCharacterId!,
        shares,
        { $set: { updatedAt: now } },
        { pricePerShare: order.pricePerShare }
      );
      buyerSharesCredited = true;
    }

    // Release escrow to filler (escrow stored in ₳; convert to filler home currency)
    await db.collection(fillerCollectionName).updateOne(
      { _id: fillerId },
      {
        $inc: buildPersonalBalanceInc(totalInFillerHome, fillerHomeCurrency, forexEnabled),
        $set: { updatedAt: now },
      }
    );
    fillerEscrowReleased = true;
    await emitTx(db, {
      type: "stock_trade_sell",
      turn: currentTurn,
      createdAt: now,
      subjectType: "character",
      subjectId: fillerId,
      subjectName: fillerName,
      amount: totalInFillerHome,
      currencyCode: fillerHomeCurrency,
      counterpartyType: order.placerFundId
        ? "system"
        : order.placerCorporationId
          ? "corporation"
          : "character",
      counterpartyId: order.placerFundId
        ? undefined
        : (order.placerCorporationId ?? orderCharacterId),
      counterpartyName: order.placerFundId
        ? "Index fund"
        : order.placerCorporationId
          ? (buyOrderBuyerCorp?.name ?? "Unknown corporation")
          : await resolveCharName(db, orderCharacterId!, false),
      meta: {
        corporationId: corporation._id.toString(),
        orderId: order._id.toString(),
        shares,
        pricePerShare: order.pricePerShare,
        source: "order_fill_buy_order",
        imperial: isImperialFiller || undefined,
      },
    });
  } catch (err) {
    if (fillerEscrowReleased) {
      await db.collection(fillerCollectionName).updateOne(
        { _id: fillerId },
        {
          $inc: buildPersonalBalanceInc(-totalInFillerHome, fillerHomeCurrency, forexEnabled),
          $set: { updatedAt: new Date() },
        }
      );
    }
    if (buyerSharesCredited) {
      if (order.placerFundId) {
        await debitSharesFromFund(
          db,
          corporation._id,
          order.placerFundId,
          shares,
          { $set: { updatedAt: new Date() } },
          { requireSufficient: true }
        );
      } else if (order.placerCorporationId) {
        await debitSharesFromCorp(
          db,
          corporation._id,
          order.placerCorporationId,
          shares,
          { $set: { updatedAt: new Date() } },
          { requireSufficient: true }
        );
      } else {
        await debitShares(
          db,
          corporation._id,
          orderCharacterId!,
          shares,
          { $set: { updatedAt: new Date() } },
          { requireSufficient: true }
        );
      }
    }
    if (sellerSharesDebited) {
      if (isImperialFiller) {
        await creditSharesToImperial(
          db,
          corporation._id,
          fillerId,
          shares,
          { $set: { updatedAt: new Date() } },
          { pricePerShare: fillerAvgCost }
        );
      } else {
        await creditShares(
          db,
          corporation._id,
          fillerId,
          shares,
          { $set: { updatedAt: new Date() } },
          { pricePerShare: fillerAvgCost }
        );
      }
    }
    await restoreClaimedOrder();
    throw err;
  }
  return null;
}

/**
 * Post-fill invariant: recompute totalShares from live positions and atomically
 * correct any drift. The update filter includes the expected totalShares value so
 * a concurrent correction from another fill doesn't stomp a valid update.
 */
export async function reconcileTotalSharesAfterFill(
  db: Db,
  corporationId: ObjectId
): Promise<void> {
  try {
    const [postFillCorp, postFillListings, postFillCorpSellOrders] = await Promise.all([
      db.collection<Corporation>("corporations").findOne({ _id: corporationId }),
      db
        .collection<ShareListing>("shareListings")
        .find({ corporationId, status: "open" })
        .toArray(),
      db
        .collection<ShareOrder>("shareOrders")
        .find({
          corporationId,
          type: "sell",
          status: "open",
          placerCorporationId: { $exists: true },
        })
        .toArray(),
    ]);
    if (postFillCorp) {
      const accounted = computeAccountedShares(
        postFillCorp,
        postFillListings,
        postFillCorpSellOrders
      );
      if (accounted !== (postFillCorp.totalShares ?? 0)) {
        await db
          .collection<Corporation>("corporations")
          .updateOne(
            { _id: corporationId, totalShares: postFillCorp.totalShares },
            { $set: { totalShares: accounted, updatedAt: new Date() } }
          );
      }
    }
  } catch {
    // Non-fatal: fill succeeded; invariant correction is best-effort.
  }
}
