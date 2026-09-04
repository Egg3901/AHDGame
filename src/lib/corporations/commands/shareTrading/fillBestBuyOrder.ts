import type { Db, ObjectId } from "mongodb";
import type { Corporation, IndexFund, ShareOrder } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { settleBuyOrderFill, reconcileTotalSharesAfterFill } from "./fillShareOrderSettlement";
import { recordShareTrade } from "@/lib/corporations/shareTradeHistory";

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

  for (const order of candidates) {
    if (!order.placerFundId || !(order.escrowAnchor && order.escrowAnchor > 0)) continue;
    const provider = await db
      .collection<Pick<IndexFund, "_id" | "name" | "status">>("indexFunds")
      .findOne({ _id: order.placerFundId, status: "active" });
    if (!provider) continue;

    const remainingShares = order.sharesRemaining - shares;
    const fillFraction = shares / order.sharesRemaining;
    const proceedsAnchor = order.escrowAnchor * fillFraction;
    if (!Number.isFinite(proceedsAnchor) || proceedsAnchor <= 0) continue;
    const remainingEscrowAnchor = order.escrowAnchor - proceedsAnchor;
    const remainingEscrowLocal = Math.max(0, order.escrowAmount - shares * order.pricePerShare);
    const claimed = await db.collection<ShareOrder>("shareOrders").findOneAndUpdate(
      {
        _id: order._id,
        status: "open",
        sharesRemaining: order.sharesRemaining,
        escrowAnchor: order.escrowAnchor,
      },
      {
        $set: {
          sharesRemaining: remainingShares,
          escrowAmount: remainingEscrowLocal,
          escrowAnchor: remainingEscrowAnchor,
          status: remainingShares === 0 ? "filled" : "open",
          updatedAt: now,
        },
      },
      { returnDocument: "after" }
    );
    if (!claimed) continue;

    const restoreClaimedOrder = async (): Promise<void> => {
      await db.collection<ShareOrder>("shareOrders").updateOne(
        { _id: order._id },
        {
          $set: {
            sharesRemaining: order.sharesRemaining,
            escrowAmount: order.escrowAmount,
            escrowAnchor: order.escrowAnchor,
            status: order.status,
            updatedAt: new Date(),
          },
        }
      );
    };
    const proceedsInHomeCurrency = forexEnabled ? proceedsAnchor * sellerFxRate : proceedsAnchor;
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
    });
    if (settlementError) continue;

    void recordShareTrade(db, {
      corporationId: corporation._id,
      kind: "peer_fill",
      turn,
      shares,
      pricePerShareAnchor: proceedsAnchor / shares,
      from: {
        ...(seller.isImperial ? { imperialCharacterId: seller.id } : { characterId: seller.id }),
        name: seller.name,
      },
      to: { name: provider.name },
      corpCurrencyCode: corporation.liquidCurrencyCode,
    });
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
