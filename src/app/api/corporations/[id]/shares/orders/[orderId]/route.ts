import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import type { Character, ShareOrder, User } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { cancelShareOrderAndRefund } from "@/lib/corporations/cancelShareOrder";

interface RouteParams {
  params: Promise<{ id: string; orderId: string }>;
}

/**
 * DELETE /api/corporations/[id]/shares/orders/[orderId]
 * Cancel an open share order.
 * Buy orders: escrow returned to cashOnHand.
 * Sell orders: shares were never debited (only reserved), so no share adjustment needed.
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { orderId } = await params;
    const db = await getDb();

    if (!ObjectId.isValid(orderId)) {
      return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
    }

    const order = await db
      .collection<ShareOrder>("shareOrders")
      .findOne({ _id: new ObjectId(orderId) });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (order.status !== "open") {
      return NextResponse.json({ error: "Order is not open" }, { status: 400 });
    }

    // Resolve character (regular or imperial)
    const userDoc = await db
      .collection<User>("users")
      .findOne({ _id: new ObjectId(auth.user.userId) });
    const isImperialMode =
      userDoc?.activeCharacterType === "imperial" && !!userDoc?.activeImperialCharacterId;

    let charId: ObjectId;

    if (isImperialMode) {
      const imperial = await db.collection<ImperialCharacter>("imperialCharacters").findOne({
        _id: userDoc!.activeImperialCharacterId!,
        userId: new ObjectId(auth.user.userId),
      });
      if (!imperial) {
        return NextResponse.json({ error: "Imperial character not found" }, { status: 404 });
      }
      charId = imperial._id;
    } else {
      const characterQuery = userDoc?.activeCharacterId
        ? { _id: userDoc.activeCharacterId, userId: new ObjectId(auth.user.userId) }
        : { userId: new ObjectId(auth.user.userId) };
      const character = await db.collection<Character>("characters").findOne(characterQuery);
      if (!character) {
        return NextResponse.json({ error: "Character not found" }, { status: 404 });
      }
      charId = character._id;
    }

    if (order.characterId?.toString() !== charId.toString()) {
      return NextResponse.json({ error: "Not your order" }, { status: 403 });
    }

    const result = await cancelShareOrderAndRefund(db, order);
    if (!result.ok) {
      const status = result.error.startsWith("Exchange rate") ? 503 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
