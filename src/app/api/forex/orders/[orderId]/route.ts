// DELETE: cancel an open/partial limit order, refund remaining escrowed funds
// Auth: requireAuthWithCharacter
// Errors: 400 (invalid ID), 401, 403 (not owner / forex disabled), 404
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, forbidden, notFound, badRequest } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { buildPersonalBalanceInc } from "@/lib/currency/characterFunds";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import type { CurrencyOrder } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ orderId: string }>;
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const forexActive = await isForexEnabled();
    if (!forexActive) throw forbidden("Currency exchange is not yet enabled");

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateCheck = checkRateLimit(auth.user.userId, 30, 60_000);
    if (!rateCheck.ok) return rateLimitResponse(rateCheck.retryAfter);

    const { orderId } = await params;
    if (!ObjectId.isValid(orderId)) throw badRequest("Invalid order ID");

    const db = await getDb();
    const { applyCancelRefund, cancelClaimKey, recoverFillClaim } =
      await import("@/lib/forex/fillRecovery");
    let order = await db
      .collection<CurrencyOrder>("currencyOrders")
      .findOne({ _id: new ObjectId(orderId) });

    if (!order) throw notFound("Order not found");
    if (order.characterId.toString() !== auth.user.character._id.toString()) {
      throw forbidden("You can only cancel your own orders");
    }
    if (order.status === "processing" && order.processingFill) {
      // A peer fill crashed after claiming. A stale claim is finished or
      // undone first so the cancel can proceed; a live one is never stolen.
      const recovery = await recoverFillClaim(db, order._id);
      if (recovery.outcome === "completed" || recovery.outcome === "rolled-back") {
        const reread = await db
          .collection<CurrencyOrder>("currencyOrders")
          .findOne({ _id: order._id });
        if (!reread) throw notFound("Order not found");
        order = reread;
      }
    }
    if (order.status !== "open" && order.status !== "partial") {
      throw badRequest("Only open or partial orders can be cancelled");
    }

    const refundAmount = order.amount - order.filledAmount;
    const now = new Date();
    const claimFilter = {
      _id: order._id,
      characterId: order.characterId,
      status: { $in: ["open", "partial"] as const },
    };

    await runWithOptionalTransaction(
      async (session) => {
        const claimedOrder = await db
          .collection<CurrencyOrder>("currencyOrders")
          .findOneAndUpdate(
            claimFilter,
            { $set: { status: "processing", updatedAt: now } },
            { returnDocument: "before", session }
          );
        if (!claimedOrder) throw badRequest("Only open or partial orders can be cancelled");

        if (refundAmount > 0) {
          await db
            .collection("characters")
            .updateOne(
              { _id: order.characterId },
              { $inc: buildPersonalBalanceInc(refundAmount, order.fromCurrency, true) },
              { session }
            );
        }

        const cancelResult = await db
          .collection<CurrencyOrder>("currencyOrders")
          .updateOne(
            { _id: order._id, status: "processing" },
            { $set: { status: "cancelled", updatedAt: now } },
            { session }
          );
        if (cancelResult.matchedCount === 0) {
          throw badRequest("Only open or partial orders can be cancelled");
        }
      },
      async () => {
        const claimedOrder = await db
          .collection<CurrencyOrder>("currencyOrders")
          .findOneAndUpdate(
            claimFilter,
            { $set: { status: "processing", updatedAt: now } },
            { returnDocument: "before" }
          );
        if (!claimedOrder) throw badRequest("Only open or partial orders can be cancelled");

        try {
          // Stamped: a crash after the refund leaves `processing`, and the
          // turn sweeper resets intent-less claims to open. The retry then
          // no-ops the refund instead of paying it twice.
          await applyCancelRefund(
            db,
            order.characterId,
            order.fromCurrency,
            refundAmount,
            cancelClaimKey(order._id.toHexString()),
            now
          );

          const cancelResult = await db
            .collection<CurrencyOrder>("currencyOrders")
            .updateOne(
              { _id: order._id, status: "processing" },
              { $set: { status: "cancelled", updatedAt: now } }
            );
          if (cancelResult.matchedCount === 0) {
            throw badRequest("Only open or partial orders can be cancelled");
          }
        } catch (error) {
          await db
            .collection<CurrencyOrder>("currencyOrders")
            .updateOne(
              { _id: order._id, status: "processing" },
              { $set: { status: order.status, updatedAt: new Date() } }
            );
          throw error;
        }
      }
    );

    return NextResponse.json({
      success: true,
      refundedAmount: refundAmount,
      refundedCurrency: order.fromCurrency,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
