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
import {
  applyForexCancelSpend,
  FOREX_CANCEL_ORDER_MISSING,
  FOREX_CANCEL_UNAVAILABLE,
} from "@/lib/forex/forexSpend";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
} from "@/lib/db/nonAtomicMoneyFlow";
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
    const order = await db
      .collection<CurrencyOrder>("currencyOrders")
      .findOne({ _id: new ObjectId(orderId) });

    if (!order) throw notFound("Order not found");
    if (order.characterId.toString() !== auth.user.character._id.toString()) {
      throw forbidden("You can only cancel your own orders");
    }
    if (order.status !== "open" && order.status !== "partial") {
      throw badRequest("Only open or partial orders can be cancelled");
    }

    // Crash-safe cancel (issue #1672): the open/partial → cancelled transition
    // is one atomic guarded write and the escrow refund a keyed leg read from
    // the frozen cancelled row, so a crash between the sequential writes
    // reconciles to exactly one refund instead of stranding a half-cancelled
    // order, and a concurrent fill either wins outright or compensates.
    // `Idempotency-Key` replays the stored refund without refunding again.
    const headerKey = request.headers.get("Idempotency-Key");
    if (headerKey !== null && (headerKey.length === 0 || headerKey.length > 128)) {
      return NextResponse.json({ error: "Invalid Idempotency-Key header" }, { status: 400 });
    }

    const now = new Date();
    let cancel: Awaited<ReturnType<typeof applyForexCancelSpend>>;
    try {
      cancel = await applyForexCancelSpend(db, {
        orderId: order._id,
        now,
        fingerprint: `forex-cancel:${order._id.toHexString()}:${order.characterId.toHexString()}`,
        ...(headerKey !== null ? { idempotencyKey: headerKey } : {}),
      });
    } catch (error) {
      if (error instanceof Error && error.message === FOREX_CANCEL_ORDER_MISSING) {
        throw notFound("Order not found");
      }
      if (
        error instanceof Error &&
        (error.message === FOREX_CANCEL_UNAVAILABLE ||
          error.message.startsWith("FOREX_CANCEL_order-cancel:"))
      ) {
        throw badRequest("Only open or partial orders can be cancelled");
      }
      if (error instanceof MoneyFlowTerminalError) {
        return NextResponse.json(
          { error: "This cancellation already settled. Start a new request to try again." },
          { status: 409 }
        );
      }
      if (error instanceof MoneyFlowKeyConflictError) {
        return NextResponse.json(
          { error: "This idempotency key was already used for a different cancellation." },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      refundedAmount: cancel.refundedAmount,
      refundedCurrency: cancel.refundedCurrency,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
