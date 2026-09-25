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
import {
  collectShareFillAuditRows,
  insertShareFillAuditRows,
  markShareFillMoneyCommitted,
  settleShareFillAttempt,
  type ShareFillAuditPlan,
} from "@/lib/corporations/commands/shareTrading/shareFillAudit";
import { computeAccountedShares } from "@/lib/corporations/shareInvariant";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { debitFundHoldingShares, upsertFundHoldingShares } from "@/lib/indexFunds/fundQueries";

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
 * Credit a liquidity-provider fund's `cashAnchor` for a filled fund sell
 * order and evidence it with the single fund-subject `stock_trade_sell`
 * ledger row. Extracted from fillShareOrder so both seller-leg sites (the
 * corporation-buyer and character-buyer fills) share one committed-path-only
 * implementation: the row is emitted after the cash credit lands, so a fill
 * that fails before the credit emits nothing, and a committed fill emits
 * exactly one row. Fund-subject rows never mirror, so this is the only
 * ledger row for the credit (the contra is the buyer's shares, an asset
 * account the shadow ledger does not carry).
 */
export async function creditSellerFundProceeds(args: {
  db: Db;
  fundId: ObjectId;
  fundName: string;
  fundAnchorCurrency: CurrencyCode;
  /** Fill proceeds in anchor (₳): `shares × order.pricePerShare` converted once. */
  total: number;
  buyer: {
    type: "corporation" | "character";
    id: ObjectId;
    name: string;
  };
  corporationId: ObjectId;
  orderId: ObjectId;
  shares: number;
  pricePerShare: number;
  currentTurn: number;
  now: Date;
}): Promise<void> {
  const {
    db,
    fundId,
    fundName,
    fundAnchorCurrency,
    total,
    buyer,
    corporationId,
    orderId,
    shares,
    pricePerShare,
    currentTurn,
    now,
  } = args;
  const cashCredit = await db
    .collection("indexFunds")
    .updateOne({ _id: fundId }, { $inc: { cashAnchor: total }, $set: { updatedAt: now } });
  if (cashCredit.matchedCount === 0) {
    throw new Error("Liquidity-provider fund disappeared during settlement");
  }
  await emitTx(db, {
    type: "stock_trade_sell",
    turn: currentTurn,
    createdAt: now,
    subjectType: "fund",
    subjectId: fundId,
    subjectName: fundName,
    amount: total,
    anchorAmount: total,
    currencyCode: fundAnchorCurrency,
    counterpartyType: buyer.type,
    counterpartyId: buyer.id,
    counterpartyName: buyer.name,
    meta: {
      corporationId: corporationId.toString(),
      orderId: orderId.toString(),
      shares,
      pricePerShare,
      source: "order_fill_sell_order",
    },
  });
}

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
  /**
   * Keyed-audit attempt claimed by the caller (issue #1672). The plan carries
   * the pinned buyer name and amounts; money below stays untouched, and the
   * audit rows are written convergently after the commit.
   */
  fillKey: string;
  plan: ShareFillAuditPlan;
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
    fillKey,
    plan,
  } = args;

  const fillerAvgCost =
    corporation.shareholders?.find((sh) =>
      isImperialFiller ? sh.imperialCharacterId?.equals(fillerId) : sh.characterId?.equals(fillerId)
    )?.avgCostPerShare ?? order.pricePerShare;
  let sellerSharesDebited = false;
  let buyerSharesCredited = false;
  let buyerFundHoldingCredited = false;
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
      // #992 audit: a buy-order fill moves NO fund cash. The fund's cashAnchor
      // was debited up front at placement — placeFundShareBuyOrder holds the
      // full anchor escrow on the order as escrowAnchor, and the peer-fill
      // claim (in fillShareOrder / fillBestBuyOrderForMarketSell) only
      // decrements the order's escrowAmount/escrowAnchor. The filler here is
      // paid out of that already-moved escrow, and the fund side of this fill
      // is shares in. So the only ledger row below is the filler's
      // stock_trade_sell (counterparty system / the fund name) — there is
      // deliberately no fund-subject row at fill. Proven by the
      // no-fund-cash-movement characterization test in
      // fillShareOrderSettlement.test.ts.
      const remaining = await debitFillerShares();
      if (remaining < 0) {
        await restoreClaimedOrder();
        await settleShareFillAttempt(db, fillKey, "failed", "share-fill:claim-restored");
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
      await upsertFundHoldingShares(
        db,
        order.placerFundId,
        corporation._id,
        shares,
        fillPriceAnchor
      );
      buyerFundHoldingCredited = true;
    } else if (order.placerCorporationId) {
      const remaining = await debitFillerShares();
      if (remaining < 0) {
        await restoreClaimedOrder();
        await settleShareFillAttempt(db, fillKey, "failed", "share-fill:claim-restored");
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
        await settleShareFillAttempt(db, fillKey, "failed", "share-fill:claim-restored");
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
    // Money committed. The sell-tx and history rows are rebuilt from the
    // pinned plan (buyer name included) and inserted convergently: a crash
    // from here on is repaired by recovery, and an audit failure leaves the
    // receipt in_progress instead of rolling back moved money.
    await markShareFillMoneyCommitted(db, fillKey);
    const auditOutcome = await insertShareFillAuditRows(
      db,
      fillKey,
      collectShareFillAuditRows(plan)
    );
    if (auditOutcome !== "failed") {
      await settleShareFillAttempt(db, fillKey, "completed");
    }
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
        if (buyerFundHoldingCredited) {
          await debitFundHoldingShares(
            db,
            order.placerFundId,
            corporation._id,
            shares,
            shares > 0 ? total / shares : 0
          );
        }
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
    await settleShareFillAttempt(
      db,
      fillKey,
      "failed",
      err instanceof Error ? err.message : "share-fill:settlement-failed"
    );
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
