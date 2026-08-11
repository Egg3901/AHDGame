import { NextResponse } from "next/server";
import type { ShareOrder } from "@/lib/db/types";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { bulkFetchCharacterNames, getCharacterByUserId } from "@/lib/db/characterLookup";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/corporations/[id]/shares/orders
 * Get the current user's open orders AND the full market orderbook for this corporation.
 */
export async function getShareOrdersView(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const character = await getCharacterByUserId(db, auth.user.userId);

    const allOrders = await db
      .collection<ShareOrder>("shareOrders")
      .find({
        corporationId: corporation._id,
        status: "open",
      })
      .sort({ createdAt: -1 })
      .toArray();

    const charNameMap = await bulkFetchCharacterNames(
      db,
      allOrders.map((order) => order.characterId).filter((id): id is NonNullable<typeof id> => !!id)
    );

    const myCharacterId = character?._id.toString();

    const myOrders = allOrders
      .filter((order) => myCharacterId && order.characterId?.toString() === myCharacterId)
      .map((order) => ({
        _id: order._id.toString(),
        type: order.type,
        shares: order.shares,
        sharesRemaining: order.sharesRemaining,
        pricePerShare: order.pricePerShare,
        escrowAmount: order.escrowAmount,
        status: order.status,
        createdAt: order.createdAt,
      }));

    const buyOrders: Record<number, { shares: number; orderCount: number }> = {};
    const sellOrders: Record<number, { shares: number; orderCount: number }> = {};

    for (const order of allOrders) {
      const bucket = order.type === "buy" ? buyOrders : sellOrders;
      const price = order.pricePerShare;
      if (!bucket[price]) {
        bucket[price] = { shares: 0, orderCount: 0 };
      }
      bucket[price].shares += order.sharesRemaining;
      bucket[price].orderCount += 1;
    }

    const orderbook = {
      bids: Object.entries(buyOrders)
        .map(([price, data]) => ({ price: Number(price), ...data }))
        .sort((a, b) => b.price - a.price)
        .slice(0, 20),
      asks: Object.entries(sellOrders)
        .map(([price, data]) => ({ price: Number(price), ...data }))
        .sort((a, b) => a.price - b.price)
        .slice(0, 20),
    };

    const marketOrders = allOrders.map((order) => {
      const charInfo = order.characterId
        ? charNameMap.get(order.characterId.toString())
        : undefined;
      return {
        _id: order._id.toString(),
        type: order.type,
        sharesRemaining: order.sharesRemaining,
        pricePerShare: order.pricePerShare,
        characterName: charInfo?.name ?? (order.placerFundId ? "Index fund" : "Unknown"),
        characterSequentialId: charInfo?.sequentialId,
        isMine: myCharacterId ? order.characterId?.toString() === myCharacterId : false,
        isFundOrder: !!order.placerFundId,
        createdAt: order.createdAt,
      };
    });

    return NextResponse.json({
      myOrders,
      orderbook,
      marketOrders,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
