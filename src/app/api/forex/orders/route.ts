// POST: create a public limit order (escrow funds from personal balance)
// GET: list the authenticated player's own open/partial orders
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403 (forex disabled), 500
import { NextResponse } from "next/server";
import type { InsertOneResult, ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest, forbidden } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getPersonalBalance, buildPersonalBalanceInc } from "@/lib/currency/characterFunds";
import { ZOD_ACTIVE_CURRENCY_ENUM } from "@/lib/constants/currencies";
import {
  nonConvertibleCurrencyMessage,
  nonConvertibleTradeCurrency,
} from "@/lib/constants/commandEconomy";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
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

export async function GET(request: Request) {
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

    // Atomic escrow: deduct fromCurrency only if sufficient balance exists.
    // The $gte filter prevents double-spend if two requests race.
    const balanceField = `currencyBalances.personal.${fromCurrency}`;
    const escrowInc = buildPersonalBalanceInc(-amount, fromCurrency, true);
    const now = new Date();
    const order: Omit<CurrencyOrder, "_id"> = {
      characterId: character._id,
      characterName: character.name,
      countryId: character.countryId,
      type: "limit",
      direction,
      fromCurrency,
      toCurrency,
      amount,
      limitRate,
      expiresAtTurn: expiresInTurns ? currentTurn + expiresInTurns : undefined,
      status: "open",
      filledAmount: 0,
      spreadCharged: 0,
      createdAt: now,
      updatedAt: now,
    };

    let insertedId: ObjectId | null = null;
    await runWithOptionalTransaction(
      async (session) => {
        const escrowResult = await db
          .collection("characters")
          .updateOne(
            { _id: character._id, [balanceField]: { $gte: amount } },
            { $inc: escrowInc },
            { session }
          );
        if (escrowResult.modifiedCount === 0) {
          const balance = getPersonalBalance(character, fromCurrency, true);
          throw badRequest(
            `Insufficient ${fromCurrency} balance. Have ${Math.floor(balance).toLocaleString()}, need ${amount.toLocaleString()}.`
          );
        }

        const result: InsertOneResult<CurrencyOrder> = await db
          .collection<CurrencyOrder>("currencyOrders")
          .insertOne(order as CurrencyOrder, { session });
        insertedId = result.insertedId;
      },
      async () => {
        const escrowResult = await db
          .collection("characters")
          .updateOne({ _id: character._id, [balanceField]: { $gte: amount } }, { $inc: escrowInc });
        if (escrowResult.modifiedCount === 0) {
          const balance = getPersonalBalance(character, fromCurrency, true);
          throw badRequest(
            `Insufficient ${fromCurrency} balance. Have ${Math.floor(balance).toLocaleString()}, need ${amount.toLocaleString()}.`
          );
        }

        try {
          const result: InsertOneResult<CurrencyOrder> = await db
            .collection<CurrencyOrder>("currencyOrders")
            .insertOne(order as CurrencyOrder);
          insertedId = result.insertedId;
        } catch (error) {
          await db
            .collection("characters")
            .updateOne(
              { _id: character._id },
              { $inc: buildPersonalBalanceInc(amount, fromCurrency, true) }
            );
          throw error;
        }
      }
    );

    recordAudit({
      source: "api",
      action: "forex.order",
      category: "market",
      subject: { type: "currencyOrder", id: insertedId!, name: `${fromCurrency}->${toCurrency}` },
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
      orderId: insertedId!.toString(),
      order: {
        ...order,
        _id: insertedId!.toString(),
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
