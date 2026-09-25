import type { Db, ObjectId } from "mongodb";
import type { Corporation, IndexFund, ShareOrder } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { settleBuyOrderFill, reconcileTotalSharesAfterFill } from "./fillShareOrderSettlement";
import {
  beginShareFillAttempt,
  buildShareFillFingerprint,
  buildShareFillTurnClaimUpdate,
  prepareShareFillClaim,
  settleShareFillAttempt,
  type ShareFillAuditPlan,
} from "./shareFillAudit";
import { recoverShareFillMoneyByFillKey } from "./shareFillMoney";

export interface MarketSellParty {
  id: ObjectId;
  name: string;
  collectionName: "characters" | "imperialCharacters";
  homeCurrency: CurrencyCode;
  isImperial: boolean;
}

export type BestBuyOrderFillResult =
  | { filled: false }
  | {
      filled: true;
      orderId: ObjectId;
      shares: number;
      proceedsAnchor: number;
      proceedsInHomeCurrency: number;
      pricePerShareLocal: number;
    };

/** Route a complete market sell into the best active fund bid when one can cover it. */
export async function fillBestBuyOrderForMarketSell(input: {
  db: Db;
  corporation: Corporation;
  seller: MarketSellParty;
  shares: number;
  forexEnabled: boolean;
  sellerFxRate: number;
  now: Date;
  turn: number;
}): Promise<BestBuyOrderFillResult> {
  const { db, corporation, seller, shares, forexEnabled, sellerFxRate, now, turn } = input;
  if (!Number.isInteger(shares) || shares <= 0) return { filled: false };

  const candidates = await db
    .collection<ShareOrder>("shareOrders")
    .find({
      corporationId: corporation._id,
      placerFundId: { $exists: true },
      liquidityProvider: true,
      type: "buy",
      status: "open",
      sharesRemaining: { $gte: shares },
    })
    .sort({ pricePerShare: -1, createdAt: 1 })
    .limit(12)
    .toArray();

  for (let order of candidates) {
    if (!order.placerFundId || !(order.escrowAnchor && order.escrowAnchor > 0)) continue;
    const provider = await db
      .collection<Pick<IndexFund, "_id" | "name" | "status">>("indexFunds")
      .findOne({ _id: order.placerFundId, status: "active" });
    if (!provider) continue;

    const prepared = await prepareShareFillClaim(db, order);
    // Converge a prior attempt crashed mid-money before reading balances.
    if (prepared.order.lastShareFillKey) {
      await recoverShareFillMoneyByFillKey(db, prepared.order.lastShareFillKey);
    }
    order = prepared.order;
    const escrowAnchor = order.escrowAnchor;
    if (!(escrowAnchor && escrowAnchor > 0)) continue;
    const remainingShares = order.sharesRemaining - shares;
    const fillFraction = shares / order.sharesRemaining;
    const proceedsAnchor = escrowAnchor * fillFraction;
    if (!Number.isFinite(proceedsAnchor) || proceedsAnchor <= 0) continue;
    const remainingEscrowAnchor = escrowAnchor - proceedsAnchor;
    const remainingEscrowLocal = Math.max(0, order.escrowAmount - shares * order.pricePerShare);
    const proceedsInHomeCurrency = forexEnabled ? proceedsAnchor * sellerFxRate : proceedsAnchor;
    const fillPlan: ShareFillAuditPlan = {
      version: 1,
      orderIdHex: order._id.toHexString(),
      corpIdHex: corporation._id.toHexString(),
      corpCcy: corporation.liquidCurrencyCode,
      orderType: "buy",
      shares,
      pricePerShare: order.pricePerShare,
      totalAnchor: proceedsAnchor,
      turn,
      nowIso: now.toISOString(),
      preClaimRemaining: order.sharesRemaining,
      filler: {
        idHex: seller.id.toHexString(),
        collection: seller.collectionName,
        name: seller.name,
        homeCurrency: seller.homeCurrency,
        imperial: seller.isImperial,
      },
      fillerAmount: proceedsInHomeCurrency,
      placerKind: "fund",
      placerIdHex: order.placerFundId!.toHexString(),
      placerName: provider.name,
      fundTx: false,
      moneyCommitted: false,
    };
    const fillKey = await beginShareFillAttempt(
      db,
      fillPlan,
      buildShareFillFingerprint({
        orderId: order._id,
        fillerId: seller.id,
        shares,
        pricePerShare: order.pricePerShare,
      })
    );
    const claimed = await db.collection<ShareOrder>("shareOrders").findOneAndUpdate(
      {
        _id: order._id,
        status: "open",
        sharesRemaining: order.sharesRemaining,
        escrowAnchor: order.escrowAnchor,
      },
      buildShareFillTurnClaimUpdate({
        remainingShares,
        remainingEscrowLocal,
        remainingEscrowAnchor,
        status: remainingShares === 0 ? "filled" : "open",
        fillKey,
        now,
      }),
      { returnDocument: "after" }
    );
    if (!claimed) {
      await settleShareFillAttempt(db, fillKey, "failed", "share-fill:claim-never-landed");
      continue;
    }

    const restoreClaimedOrder = async (): Promise<void> => {
      const restoreUpdate: {
        $set: Record<string, unknown>;
        $unset?: Record<string, "" | 1 | true>;
      } = {
        $set: {
          sharesRemaining: order.sharesRemaining,
          escrowAmount: order.escrowAmount,
          escrowAnchor: order.escrowAnchor,
          status: order.status,
          updatedAt: new Date(),
          ...(order.lastShareFillKey !== undefined
            ? { lastShareFillKey: order.lastShareFillKey }
            : {}),
        },
      };
      if (order.lastShareFillKey === undefined) {
        restoreUpdate.$unset = { lastShareFillKey: "" };
      }
      await db.collection<ShareOrder>("shareOrders").updateOne({ _id: order._id }, restoreUpdate);
    };
    const settlementError = await settleBuyOrderFill({
      db,
      corporation,
      order,
      orderCharacterId: order.characterId,
      buyOrderBuyerCorp: null,
      shares,
      total: proceedsAnchor,
      totalInFillerHome: proceedsInHomeCurrency,
      fillerId: seller.id,
      fillerName: seller.name,
      fillerCollectionName: seller.collectionName,
      fillerHomeCurrency: seller.homeCurrency,
      isImperialFiller: seller.isImperial,
      forexEnabled,
      currentTurn: turn,
      now,
      restoreClaimedOrder,
      fillKey,
      plan: fillPlan,
    });
    if (settlementError) continue;

    await reconcileTotalSharesAfterFill(db, corporation._id);

    return {
      filled: true,
      orderId: order._id,
      shares,
      proceedsAnchor,
      proceedsInHomeCurrency,
      pricePerShareLocal: order.pricePerShare,
    };
  }

  return { filled: false };
}
