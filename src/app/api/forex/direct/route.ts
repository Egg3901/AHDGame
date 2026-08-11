// POST: send a direct trade request to a specific character
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403 (forex disabled), 404 (target not found)
import { NextResponse } from "next/server";
import { ObjectId, type InsertOneResult } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { handleRouteError, forbidden, notFound, badRequest } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getPersonalBalance, buildPersonalBalanceInc } from "@/lib/currency/characterFunds";
import { ZOD_ACTIVE_CURRENCY_ENUM, DIRECT_TRADE_EXPIRY_TURNS } from "@/lib/constants/currencies";
import {
  nonConvertibleCurrencyMessage,
  nonConvertibleTradeCurrency,
} from "@/lib/constants/commandEconomy";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { getGameTime } from "@/lib/time/gameTime";
import {
  getNewCharacterTransferBarrier,
  NEW_CHARACTER_TRANSFER_BARRIER_TURNS,
} from "@/lib/character/newCharacterTransferBarrier";
import type { CurrencyOrder, Character, GameConfig, PlayerMail } from "@/lib/db/types";

const directTradeSchema = z
  .object({
    targetCharacterId: schemas.objectId,
    fromCurrency: z.enum(ZOD_ACTIVE_CURRENCY_ENUM),
    toCurrency: z.enum(ZOD_ACTIVE_CURRENCY_ENUM),
    amount: z.number().positive(),
    proposedRate: z.number().positive(),
    expiresInTurns: z.number().int().positive().max(480).optional(),
  })
  .refine((data) => data.fromCurrency !== data.toCurrency, {
    message: "Cannot trade a currency for itself",
  });

export async function POST(request: Request) {
  try {
    const forexActive = await isForexEnabled();
    if (!forexActive) throw forbidden("Currency exchange is not yet enabled");

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateCheck = checkRateLimit(auth.user.userId, 20, 60_000);
    if (!rateCheck.ok) return rateLimitResponse(rateCheck.retryAfter);

    const parsed = await parseJsonBody(request, directTradeSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { targetCharacterId, fromCurrency, toCurrency, amount, proposedRate, expiresInTurns } =
      parsed.data;
    const character = auth.user.character;

    if (targetCharacterId === character._id.toString()) {
      throw badRequest("Cannot send a trade request to yourself");
    }

    const db = await getDb();

    // Verify target exists
    const target = await db
      .collection<Character>("characters")
      .findOne({ _id: new ObjectId(targetCharacterId) });
    if (!target) throw notFound("Target character not found");

    // New characters cannot move money via direct trades for their first 24 turns
    // (anti-abuse — a skewed-rate direct trade is otherwise a disguised transfer).
    const gameTime = await getGameTime();
    const barrier = getNewCharacterTransferBarrier(
      character,
      gameTime.currentTurn,
      gameTime.effectiveNow.getTime()
    );
    if (barrier.blocked) {
      return NextResponse.json(
        {
          error: `New characters cannot trade currency directly for their first ${NEW_CHARACTER_TRANSFER_BARRIER_TURNS} turns. You can trade in ${barrier.remainingTurns} turn(s).`,
          remainingTurns: barrier.remainingTurns,
        },
        { status: 403 }
      );
    }

    // Non-convertible command currencies cannot be peer-traded either.
    const gameConfig = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } });
    const blocked = nonConvertibleTradeCurrency(
      [fromCurrency, toCurrency],
      gameTime.currentYear,
      gameConfig?.commandEconomyEnabled === true
    );
    if (blocked) {
      throw badRequest(nonConvertibleCurrencyMessage(blocked));
    }

    // Atomic escrow: deduct fromCurrency only if sufficient balance exists.
    // The $gte filter prevents double-spend if two requests race.
    const balanceField = `currencyBalances.personal.${fromCurrency}`;
    const escrowInc = buildPersonalBalanceInc(-amount, fromCurrency, true);
    const currentTurn = gameTime.currentTurn;

    const expiryTurns = expiresInTurns ?? DIRECT_TRADE_EXPIRY_TURNS;
    const now = new Date();

    const order: Omit<CurrencyOrder, "_id"> = {
      characterId: character._id,
      characterName: character.name,
      countryId: character.countryId,
      type: "direct",
      direction: "buy",
      fromCurrency,
      toCurrency,
      amount,
      limitRate: proposedRate,
      targetCharacterId: new ObjectId(targetCharacterId),
      targetCharacterName: target.name,
      expiresAtTurn: currentTurn + expiryTurns,
      status: "open",
      filledAmount: 0,
      spreadCharged: 0,
      createdAt: now,
      updatedAt: now,
    };

    let requestId: ObjectId | null = null;
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
            `Insufficient ${fromCurrency}. Have ${Math.floor(balance).toLocaleString()}, need ${amount.toLocaleString()}.`
          );
        }

        const result: InsertOneResult<CurrencyOrder> = await db
          .collection<CurrencyOrder>("currencyOrders")
          .insertOne(order as CurrencyOrder, { session });
        requestId = result.insertedId;
      },
      async () => {
        const escrowResult = await db
          .collection("characters")
          .updateOne({ _id: character._id, [balanceField]: { $gte: amount } }, { $inc: escrowInc });
        if (escrowResult.modifiedCount === 0) {
          const balance = getPersonalBalance(character, fromCurrency, true);
          throw badRequest(
            `Insufficient ${fromCurrency}. Have ${Math.floor(balance).toLocaleString()}, need ${amount.toLocaleString()}.`
          );
        }

        try {
          const result: InsertOneResult<CurrencyOrder> = await db
            .collection<CurrencyOrder>("currencyOrders")
            .insertOne(order as CurrencyOrder);
          requestId = result.insertedId;
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

    // Send in-game mail notification to target
    const mail: Omit<PlayerMail, "_id"> = {
      fromCharacterId: character._id,
      fromCharacterName: character.name,
      fromCharacterSequentialId: character.sequentialId ?? 0,
      toUserId: target.userId,
      toCharacterId: target._id,
      toCharacterName: target.name,
      toCharacterSequentialId: target.sequentialId ?? 0,
      subject: `Currency trade offer: ${amount.toLocaleString()} ${fromCurrency}`,
      body: `${character.name} wants to trade ${amount.toLocaleString()} ${fromCurrency} for ${toCurrency} at rate ${proposedRate}. This offer expires in ${expiryTurns} turns. Visit the Currency Exchange to accept or decline.`,
      read: false,
      deletedByRecipient: false,
      deletedBySender: false,
      createdAt: now,
    };
    let notifiedTarget = true;
    try {
      await db.collection<PlayerMail>("playerMail").insertOne(mail as PlayerMail);
    } catch {
      notifiedTarget = false;
    }

    return NextResponse.json({
      success: true,
      requestId: requestId!.toString(),
      notifiedTarget,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
