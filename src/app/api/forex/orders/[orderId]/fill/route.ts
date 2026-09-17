// POST: fill (or partially fill) another player's open limit order
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403 (own order / forex disabled), 404
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, forbidden, notFound, badRequest } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  nonConvertibleCurrencyMessage,
  nonConvertibleTradeCurrency,
} from "@/lib/constants/commandEconomy";
import {
  applyForexFillSpend,
  FOREX_FILL_INSUFFICIENT,
  FOREX_FILL_ORDER_MISSING,
  FOREX_FILL_OWNER_MISSING,
  FOREX_FILL_RACED,
  FOREX_FILL_UNAVAILABLE,
} from "@/lib/forex/forexSpend";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
} from "@/lib/db/nonAtomicMoneyFlow";
import type { CurrencyOrder, GameConfig, GameState } from "@/lib/db/types";
import { recordAudit } from "@/lib/audit/recordAudit";

interface RouteParams {
  params: Promise<{ orderId: string }>;
}

const fillSchema = z.object({
  /** Amount of the order's fromCurrency to fill. If omitted, fills the full remaining. */
  amount: z.number().positive().optional(),
});

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const forexActive = await isForexEnabled();
    if (!forexActive) throw forbidden("Currency exchange is not yet enabled");

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateCheck = checkRateLimit(auth.user.userId, 30, 60_000);
    if (!rateCheck.ok) return rateLimitResponse(rateCheck.retryAfter);

    const { orderId } = await params;
    if (!ObjectId.isValid(orderId)) throw badRequest("Invalid order ID");

    const parsed = await parseJsonBody(request, fillSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const order = await db
      .collection<CurrencyOrder>("currencyOrders")
      .findOne({ _id: new ObjectId(orderId) });

    if (!order) throw notFound("Order not found");
    if (order.type !== "limit") throw badRequest("Only limit orders can be peer-filled");
    if (order.status !== "open" && order.status !== "partial") {
      throw badRequest("Order is not available for filling");
    }
    if (order.characterId.toString() === auth.user.character._id.toString()) {
      throw forbidden("Cannot fill your own order");
    }

    const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const gameConfig = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } });
    const blocked = nonConvertibleTradeCurrency(
      [order.fromCurrency, order.toCurrency],
      gs?.currentYear,
      gameConfig?.commandEconomyEnabled === true
    );
    if (blocked) {
      throw badRequest(nonConvertibleCurrencyMessage(blocked));
    }

    // Crash-safe fill (issue #1672): taker settlement, poster credit, the
    // guarded order transition, the history row, and both half-spread CB
    // slices run as keyed idempotent steps, so a crash between the sequential
    // writes reconciles to exactly one fill instead of stranding a
    // half-landed one, and a concurrent fill/cancel race compensates the
    // loser instead of double-moving money. `Idempotency-Key` replays the
    // stored fill without moving money again.
    const headerKey = request.headers.get("Idempotency-Key");
    if (headerKey !== null && (headerKey.length === 0 || headerKey.length > 128)) {
      return NextResponse.json({ error: "Invalid Idempotency-Key header" }, { status: 400 });
    }

    const currentTurn = gs?.currentTurn ?? 0;
    const now = new Date();

    let fill: Awaited<ReturnType<typeof applyForexFillSpend>>;
    try {
      fill = await applyForexFillSpend(db, {
        kind: "limit",
        orderId: order._id,
        takerCharacterId: auth.user.character._id,
        ...(parsed.data.amount !== undefined ? { requestedAmount: parsed.data.amount } : {}),
        now,
        turn: currentTurn,
        fingerprint: `forex-fill:${order._id.toHexString()}:${auth.user.character._id.toHexString()}:${parsed.data.amount ?? "full"}`,
        ...(headerKey !== null ? { idempotencyKey: headerKey } : {}),
      });
    } catch (error) {
      if (error instanceof Error && error.message === FOREX_FILL_ORDER_MISSING) {
        throw notFound("Order not found");
      }
      if (error instanceof Error && error.message.startsWith(`${FOREX_FILL_UNAVAILABLE}:`)) {
        const reason = error.message.slice(FOREX_FILL_UNAVAILABLE.length + 1);
        if (reason === "not-limit") throw badRequest("Only limit orders can be peer-filled");
        if (reason === "empty") throw badRequest("Nothing left to fill on this order");
        throw badRequest("Order is not available for filling");
      }
      if (error instanceof Error && error.message.startsWith(FOREX_FILL_RACED)) {
        throw badRequest("Order was already filled by another trader");
      }
      if (error instanceof Error && error.message.startsWith(FOREX_FILL_INSUFFICIENT)) {
        const parts = error.message.split(":");
        if (parts[1] === "precheck" && parts.length === 4) {
          const need = Number(parts[2]);
          const have = Number(parts[3]);
          if (Number.isFinite(need) && Number.isFinite(have)) {
            throw badRequest(
              `Insufficient ${order.toCurrency}. Need ${Math.ceil(need).toLocaleString()}, have ${Math.floor(have).toLocaleString()}.`
            );
          }
        }
        throw badRequest(`Insufficient ${order.toCurrency} balance`);
      }
      if (error instanceof Error && error.message.startsWith(FOREX_FILL_OWNER_MISSING)) {
        throw notFound("Order owner not found");
      }
      if (error instanceof MoneyFlowTerminalError) {
        return NextResponse.json(
          { error: "This fill already settled. Start a new fill to try again." },
          { status: 409 }
        );
      }
      if (error instanceof MoneyFlowKeyConflictError) {
        return NextResponse.json(
          { error: "This idempotency key was already used for a different fill." },
          { status: 409 }
        );
      }
      throw error;
    }

    recordAudit({
      source: "api",
      action: "forex.fill",
      category: "market",
      subject: {
        type: "currencyOrder",
        id: order._id,
        name: `${order.fromCurrency}->${order.toCurrency}`,
      },
      counterparty: { type: "character", id: order.characterId, name: undefined },
      amount: fill.fillAmount,
      currencyCode: order.fromCurrency,
      delta: [
        { field: "status", before: order.status, after: fill.orderStatus },
        { field: "filledAmount", before: order.filledAmount, after: order.filledAmount + fill.fillAmount },
        { field: "fillAmount", before: null, after: fill.fillAmount },
        { field: "rate", before: null, after: fill.rate },
      ],
      outcome: "ok",
    });

    return NextResponse.json({
      success: true,
      filledAmount: fill.fillAmount,
      rate: fill.rate,
      posterSpread: fill.makerSpread,
      fillerSpread: fill.takerSpread,
      orderStatus: fill.orderStatus,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
