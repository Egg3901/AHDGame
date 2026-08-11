// GET /api/forex/trades — Public trade history feed, last 48 turns, up to 200 entries
// Auth: none (public)
// Errors: 403 (forex disabled)
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import type { TradeHistoryEntry } from "@/lib/db/types/tradeHistory";
import type { GameState } from "@/lib/db/types";

export async function GET() {
  try {
    const forexActive = await isForexEnabled();
    if (!forexActive) {
      return NextResponse.json({ error: "Currency exchange is not yet enabled" }, { status: 403 });
    }

    const db = await getDb();

    const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const currentTurn = gs?.currentTurn ?? 0;
    const oldestTurn = Math.max(0, currentTurn - 48);

    interface TradeWithNames {
      _id: TradeHistoryEntry["_id"];
      fromCurrency: TradeHistoryEntry["fromCurrency"];
      toCurrency: TradeHistoryEntry["toCurrency"];
      amount: TradeHistoryEntry["amount"];
      rate: TradeHistoryEntry["rate"];
      spread: TradeHistoryEntry["spread"];
      turn: TradeHistoryEntry["turn"];
      createdAt: TradeHistoryEntry["createdAt"];
      buyerName: string | null;
      sellerName: string | null;
    }

    const trades = await db
      .collection<TradeHistoryEntry>("tradeHistory")
      .aggregate<TradeWithNames>([
        { $match: { turn: { $gte: oldestTurn } } },
        { $sort: { createdAt: -1 } },
        { $limit: 200 },
        {
          $lookup: {
            from: "characters",
            localField: "buyerCharacterId",
            foreignField: "_id",
            as: "buyer",
            pipeline: [{ $project: { _id: 0, name: 1 } }],
          },
        },
        {
          $lookup: {
            from: "characters",
            localField: "sellerCharacterId",
            foreignField: "_id",
            as: "seller",
            pipeline: [{ $project: { _id: 0, name: 1 } }],
          },
        },
        {
          $project: {
            _id: 1,
            fromCurrency: 1,
            toCurrency: 1,
            amount: 1,
            rate: 1,
            spread: 1,
            turn: 1,
            createdAt: 1,
            buyerName: { $ifNull: [{ $arrayElemAt: ["$buyer.name", 0] }, null] },
            sellerName: { $ifNull: [{ $arrayElemAt: ["$seller.name", 0] }, null] },
          },
        },
      ])
      .toArray();

    return NextResponse.json({
      trades: trades.map((t) => ({
        _id: t._id.toString(),
        fromCurrency: t.fromCurrency,
        toCurrency: t.toCurrency,
        amount: t.amount,
        rate: t.rate,
        spread: t.spread,
        turn: t.turn,
        createdAt: t.createdAt,
        buyerName: t.buyerName,
        // null sellerName = market maker
        sellerName: t.sellerName,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
