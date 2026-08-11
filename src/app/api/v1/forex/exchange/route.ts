// POST /api/v1/forex/exchange — Execute a market-maker instant currency trade via API key.
// Auth: X-API-Key with "private" scope.
// Mirrors all restrictions, fees, and validation from /api/forex/exchange.
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, forbidden, badRequest } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { requireUserApiKey } from "@/lib/api/userApiAuth";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { executeMarketMakerTrade } from "@/lib/currency/marketMaker";
import { emitTx } from "@/lib/financialTxLog/emit";
import { ZOD_ACTIVE_CURRENCY_ENUM } from "@/lib/constants/currencies";
import {
  nonConvertibleCurrencyMessage,
  nonConvertibleTradeCurrency,
} from "@/lib/constants/commandEconomy";
import type { CountryId } from "@/lib/constants/countries";
import type { Character, GameConfig, GameState, User } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";

const marketOrderSchema = z
  .object({
    fromCurrency: z.enum(ZOD_ACTIVE_CURRENCY_ENUM),
    toCurrency: z.enum(ZOD_ACTIVE_CURRENCY_ENUM),
    amount: z.number().positive(),
  })
  .refine((data) => data.fromCurrency !== data.toCurrency, {
    message: "Cannot trade a currency for itself",
  });

export async function POST(request: Request) {
  try {
    const apiAuth = await requireUserApiKey(request, "private");
    if (!apiAuth.ok) {
      const status =
        apiAuth.reason === "missing"
          ? 401
          : apiAuth.reason === "invalid"
            ? 401
            : apiAuth.reason === "insufficient_scope"
              ? 403
              : 401;
      return NextResponse.json(
        { error: `API key ${apiAuth.reason.replace("_", " ")}` },
        { status }
      );
    }

    const forexActive = await isForexEnabled();
    if (!forexActive) {
      throw forbidden("Currency exchange is not yet enabled");
    }

    const rateCheck = checkRateLimit(apiAuth.ownerUserId, 30, 60_000);
    if (!rateCheck.ok) return rateLimitResponse(rateCheck.retryAfter);

    const parsed = await parseJsonBody(request, marketOrderSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { fromCurrency, toCurrency, amount } = parsed.data;
    const db = await getDb();
    const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const currentTurn = gs?.currentTurn ?? 0;

    // Mirror /api/forex/exchange — refuse non-convertible command currencies.
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

    // Resolve character from API key owner
    const userDoc = await db
      .collection<User>("users")
      .findOne({ _id: new ObjectId(apiAuth.ownerUserId) });

    const isImperialMode =
      userDoc?.activeCharacterType === "imperial" && !!userDoc?.activeImperialCharacterId;

    let characterId: ObjectId;
    let countryId: CountryId;
    let collectionName: "characters" | "imperialCharacters";
    let characterName: string;

    if (isImperialMode) {
      const imperial = await db.collection<ImperialCharacter>("imperialCharacters").findOne({
        _id: userDoc!.activeImperialCharacterId!,
        userId: new ObjectId(apiAuth.ownerUserId),
      });
      if (!imperial) {
        return NextResponse.json({ error: "Imperial character not found" }, { status: 404 });
      }
      characterId = imperial._id;
      countryId = imperial.countryId;
      collectionName = "imperialCharacters";
      characterName = imperial.name;
    } else {
      const characterQuery = userDoc?.activeCharacterId
        ? { _id: userDoc.activeCharacterId, userId: new ObjectId(apiAuth.ownerUserId) }
        : { userId: new ObjectId(apiAuth.ownerUserId) };
      const character = await db.collection<Character>("characters").findOne(characterQuery);
      if (!character) {
        return NextResponse.json({ error: "Character not found" }, { status: 404 });
      }
      characterId = character._id;
      countryId = character.countryId;
      collectionName = "characters";
      characterName = character.name;
    }

    const result = await executeMarketMakerTrade(db, {
      characterId,
      countryId,
      fromCurrency,
      toCurrency,
      amount,
      turn: currentTurn,
      collectionName,
      source: "api",
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    void emitTx(db, {
      type: "forex_trade",
      turn: currentTurn,
      createdAt: new Date(),
      subjectType: "character",
      subjectId: characterId,
      subjectName: characterName,
      amount: -result.fromAmount,
      currencyCode: fromCurrency,
      meta: {
        tradeHistoryId: result.tradeHistoryId?.toString(),
        toCurrency,
        toAmount: result.toAmount,
        effectiveRate: result.effectiveRate,
        source: "api",
      },
    });

    return NextResponse.json({
      success: true,
      trade: {
        fromCurrency,
        toCurrency,
        fromAmount: result.fromAmount,
        toAmount: result.toAmount,
        effectiveRate: result.effectiveRate,
        spreadCharged: result.spreadCharged,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
