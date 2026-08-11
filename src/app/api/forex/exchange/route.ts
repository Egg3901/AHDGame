// GET: returns current exchange rates + public order book
// POST: execute a market order (instant market maker trade)
// Auth: requireBasicAuth (POST), isForexEnabled gate (GET)
// Errors: 400 (validation), 401, 403 (forex disabled), 500
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, forbidden, badRequest } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { executeMarketMakerTrade } from "@/lib/currency/marketMaker";
import { emitTx } from "@/lib/financialTxLog/emit";
import {
  ZOD_ACTIVE_CURRENCY_ENUM,
  reserveCurrencyVolatilityMultiplier,
} from "@/lib/constants/currencies";
import {
  nonConvertibleCurrencyMessage,
  nonConvertibleTradeCurrency,
} from "@/lib/constants/commandEconomy";
import type { CountryId } from "@/lib/constants/countries";
import type {
  Character,
  ExchangeRate,
  CurrencyOrder,
  GameConfig,
  GameState,
  User,
  CentralBank,
} from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { rankReserveCurrencies } from "@/lib/centralBank/reserveCurrencyRanking";

const marketOrderSchema = z
  .object({
    fromCurrency: z.enum(ZOD_ACTIVE_CURRENCY_ENUM),
    toCurrency: z.enum(ZOD_ACTIVE_CURRENCY_ENUM),
    amount: z.number().positive(),
  })
  .refine((data) => data.fromCurrency !== data.toCurrency, {
    message: "Cannot trade a currency for itself",
  });

export async function GET() {
  try {
    const forexActive = await isForexEnabled();
    if (!forexActive) {
      return NextResponse.json({ error: "Currency exchange is not yet enabled" }, { status: 403 });
    }

    const db = await getDb();

    // Rates are public — no auth required
    const rates = await db.collection<ExchangeRate>("exchangeRates").find({}).toArray();

    // Top reserve currencies by FX reserve volume held across every central bank
    // (the spread-fee reserve bucket; home lending reserves are excluded),
    // valued in ₳ for ranking. The #1 is the "leading exchange currency" and
    // carries the volatility buff.
    const banks = await db
      .collection<CentralBank>("centralBanks")
      .find({}, { projection: { spreadFeeReserveBalances: 1 } })
      .toArray();
    const rateMap = Object.fromEntries(rates.map((r) => [r.currencyCode, r.rate])) as Partial<
      Record<CurrencyCode, number>
    >;
    const reserveLeaders = rankReserveCurrencies(banks, rateMap).map((entry) => ({
      currencyCode: entry.currencyCode,
      rank: entry.rank,
      units: entry.units,
      internalValue: entry.internalValue,
      isLeading: entry.rank === 1,
      // Rank-based volatility buff (#1 −50%, #2 −25%, #3 −12.5%, rest 0).
      volatilityReduction: 1 - reserveCurrencyVolatilityMultiplier(entry.rank),
    }));

    // Public order book: open limit orders only (no direct requests), excluding expired
    const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const currentTurn = gs?.currentTurn ?? 0;
    const openOrders = await db
      .collection<CurrencyOrder>("currencyOrders")
      .find({
        status: { $in: ["open", "partial"] },
        type: "limit",
        $or: [{ expiresAtTurn: { $exists: false } }, { expiresAtTurn: { $gt: currentTurn } }],
      })
      .sort({ createdAt: 1 })
      .limit(100)
      .toArray();

    return NextResponse.json(
      {
        rates: rates.map((r) => ({
          countryId: r.countryId,
          currencyCode: r.currencyCode,
          rate: r.rate,
          baseRate: r.baseRate,
          macroTarget: r.macroTarget,
          buyVolume24: r.buyVolume24,
          sellVolume24: r.sellVolume24,
          rateHistory: r.rateHistory,
          // Public band info only — reserves and per-intervention history stay chair-only.
          interventionBand: r.interventionPolicy
            ? {
                floor: r.interventionPolicy.floor,
                ceiling: r.interventionPolicy.ceiling,
                setAtTurn: r.interventionPolicy.setAtTurn,
                defending:
                  r.rate < r.interventionPolicy.floor || r.rate > r.interventionPolicy.ceiling,
              }
            : null,
        })),
        reserveLeaders,
        orderBook: openOrders.map((o) => ({
          _id: o._id.toString(),
          characterName: o.characterName,
          type: o.type,
          fromCurrency: o.fromCurrency,
          toCurrency: o.toCurrency,
          amount: o.amount,
          filledAmount: o.filledAmount,
          limitRate: o.limitRate,
          status: o.status,
          createdAt: o.createdAt,
        })),
      },
      {
        // GET is public and identical for every viewer (no auth/user context), so
        // it's safe to edge-cache. Short TTL because the order book reacts to
        // trades — 15s keeps N-user polling off the origin without a stale feel.
        headers: {
          "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30, no-transform",
        },
      }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const forexActive = await isForexEnabled();
    if (!forexActive) {
      throw forbidden("Currency exchange is not yet enabled");
    }

    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateCheck = checkRateLimit(auth.user.userId, 30, 60_000);
    if (!rateCheck.ok) return rateLimitResponse(rateCheck.retryAfter);

    const parsed = await parseJsonBody(request, marketOrderSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { fromCurrency, toCurrency, amount } = parsed.data;
    const db = await getDb();
    const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const currentTurn = gs?.currentTurn ?? 0;

    // Non-convertible command currencies cannot be market-traded. Gated here
    // (not inside executeMarketMakerTrade) so corp/bond/autoConvert system FX
    // still works when the flag is on.
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

    // Resolve character type for collection targeting
    const userDoc = await db
      .collection<User>("users")
      .findOne({ _id: new ObjectId(auth.user.userId) });
    const isImperialMode =
      userDoc?.activeCharacterType === "imperial" && !!userDoc?.activeImperialCharacterId;

    let characterId: ObjectId;
    let countryId: CountryId;
    let collectionName: "characters" | "imperialCharacters";
    let characterName: string;

    if (isImperialMode) {
      const imperial = await db.collection<ImperialCharacter>("imperialCharacters").findOne({
        _id: userDoc!.activeImperialCharacterId!,
        userId: new ObjectId(auth.user.userId),
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
        ? { _id: userDoc.activeCharacterId, userId: new ObjectId(auth.user.userId) }
        : { userId: new ObjectId(auth.user.userId) };
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
      source: "manual",
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
