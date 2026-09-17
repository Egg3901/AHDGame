// POST: create a public limit order (escrow funds from personal balance)
// GET: list the authenticated player's own open/partial orders
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403 (forex disabled), 500
import { NextResponse } from "next/server";
import { withNoStore } from "@/lib/api/withNoStore";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest, forbidden } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getPersonalBalance } from "@/lib/currency/characterFunds";
import { ZOD_ACTIVE_CURRENCY_ENUM } from "@/lib/constants/currencies";
import {
  nonConvertibleCurrencyMessage,
  nonConvertibleTradeCurrency,
} from "@/lib/constants/commandEconomy";
import {
  applyForexOrderCreateSpend,
  FOREX_ORDER_INSUFFICIENT,
} from "@/lib/forex/forexSpend";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
} from "@/lib/db/nonAtomicMoneyFlow";
import type { CurrencyOrder, CurrencyOrderStatus, GameConfig, GameState } from "@/lib/db/types";
import { recordAudit } from "@/lib/audit/recordAudit";

const limitOrderSchema = z
  .object({
    fromCurrency: z.enum(ZOD_ACTIVE_CURRENCY_ENUM),
    toCurrency: z.enum(ZOD_ACTIVE_CURRENCY_ENUM),
    amount: z.number().positive(),
    limitRate: z.number().positive(),
    /** 'buy' = acquire toCurrency when rate rises to limit; 'sell' = acquire fromCurrency when rate drops to limit */
    direction: z.enum(["buy", "sell"]).default("buy"),
    expiresInTurns: z.number().int().positive().max(480).optional(),
  })
  .refine((data) => data.fromCurrency !== data.toCurrency, {
    message: "Cannot trade a currency for itself",
  });

async function handleGET(request: Request) {
  try {
    const forexActive = await isForexEnabled();
    if (!forexActive) throw forbidden("Currency exchange is not yet enabled");

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view"); // "history" for filled/cancelled/expired

    const db = await getDb();
    const statusFilter =
      view === "history"
        ? { $in: ["filled", "cancelled", "expired"] as CurrencyOrderStatus[] }
        : { $in: ["open", "partial"] as CurrencyOrderStatus[] };

    const orders = await db
      .collection<CurrencyOrder>("currencyOrders")
      .find({
        characterId: auth.user.character._id,
        status: statusFilter,
      })
      .sort({ createdAt: -1 })
      .limit(view === "history" ? 100 : 50)
      .toArray();

    return NextResponse.json({
      orders: orders.map((o) => ({
        _id: o._id.toString(),
        type: o.type,
        direction: o.direction ?? "buy",
        fromCurrency: o.fromCurrency,
        toCurrency: o.toCurrency,
        amount: o.amount,
        filledAmount: o.filledAmount,
        limitRate: o.limitRate,
        filledRate: o.filledRate,
        status: o.status,
        spreadCharged: o.spreadCharged,
        expiresAtTurn: o.expiresAtTurn,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export const GET = withNoStore(handleGET);

export async function POST(request: Request) {
  try {
    const forexActive = await isForexEnabled();
    if (!forexActive) throw forbidden("Currency exchange is not yet enabled");

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateCheck = checkRateLimit(auth.user.userId, 30, 60_000);
    if (!rateCheck.ok) return rateLimitResponse(rateCheck.retryAfter);

    const parsed = await parseJsonBody(request, limitOrderSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { fromCurrency, toCurrency, amount, limitRate, direction, expiresInTurns } = parsed.data;
    const character = auth.user.character;

    const db = await getDb();
    const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const currentTurn = gs?.currentTurn ?? 0;

    // Non-convertible command currencies cannot be limit-traded on the open market.
    const gameConfig = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } });
    const blocked = nonConvertibleTradeCurrency(
      [fromCurrency, toCurrency],
      gs?.currentYear,
      gameConfig?.commandEconomyEnabled === true
    );
    if (blocked) {
      throw badRequest(nonConvertibleCurrencyMessage(blocked));
    }

    // Crash-safe escrow (issue #1672): the fromCurrency debit is a keyed
    // idempotent leg and the order row a deterministic insert, so a crash
    // between the sequential writes reconciles to exactly one escrowed order
    // instead of debiting for an order that never landed (or landing it
    // twice). `Idempotency-Key` replays the stored order id without
    // escrowing again.
    const headerKey = request.headers.get("Idempotency-Key");
    if (headerKey !== null && (headerKey.length === 0 || headerKey.length > 128)) {
      return NextResponse.json({ error: "Invalid Idempotency-Key header" }, { status: 400 });
    }

    const now = new Date();
    let orderId: string;
    try {
      const result = await applyForexOrderCreateSpend(db, {
        characterId: character._id,
        characterName: character.name,
        countryId: character.countryId,
        orderType: "limit",
        direction,
        fromCurrency,
        toCurrency,
        amount,
        limitRate,
        ...(expiresInTurns ? { expiresAtTurn: currentTurn + expiresInTurns } : {}),
        now,
        fingerprint: `forex-order:${character._id.toHexString()}:limit:${fromCurrency}:${toCurrency}:${amount}:${limitRate}:${direction}:${expiresInTurns ?? "default"}`,
        ...(headerKey !== null ? { idempotencyKey: headerKey } : {}),
      });
      orderId = result.orderId.toHexString();
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(FOREX_ORDER_INSUFFICIENT)) {
        const balance = getPersonalBalance(character, fromCurrency, true);
        throw badRequest(
          `Insufficient ${fromCurrency} balance. Have ${Math.floor(balance).toLocaleString()}, need ${amount.toLocaleString()}.`
        );
      }
      if (error instanceof MoneyFlowTerminalError) {
        return NextResponse.json(
          { error: "This order already settled. Start a new order to try again." },
          { status: 409 }
        );
      }
      if (error instanceof MoneyFlowKeyConflictError) {
        return NextResponse.json(
          { error: "This idempotency key was already used for a different order." },
          { status: 409 }
        );
      }
      throw error;
    }

    const created = await db
      .collection<CurrencyOrder>("currencyOrders")
      .findOne({ _id: new ObjectId(orderId) });
    if (!created) {
      return handleRouteError(new Error("FOREX_ORDER_READBACK_MISSING"));
    }

    recordAudit({
      source: "api",
      action: "forex.order",
      category: "market",
      subject: { type: "currencyOrder", id: created._id, name: `${fromCurrency}->${toCurrency}` },
      counterparty: { type: "currency", id: toCurrency, name: toCurrency },
      amount: amount,
      currencyCode: fromCurrency,
      delta: [
        { field: "direction", before: null, after: direction },
        { field: "status", before: null, after: "open" },
        { field: "amount", before: null, after: amount },
        { field: "limitRate", before: null, after: limitRate },
      ],
      outcome: "ok",
    });

    return NextResponse.json({
      success: true,
      orderId,
      order: {
        characterId: created.characterId.toHexString(),
        characterName: created.characterName,
        countryId: created.countryId,
        type: created.type,
        direction: created.direction,
        fromCurrency: created.fromCurrency,
        toCurrency: created.toCurrency,
        amount: created.amount,
        limitRate: created.limitRate,
        ...(created.expiresAtTurn !== undefined ? { expiresAtTurn: created.expiresAtTurn } : {}),
        status: created.status,
        filledAmount: created.filledAmount,
        spreadCharged: created.spreadCharged,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
        _id: orderId,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
