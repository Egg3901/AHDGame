// POST /api/country/[code]/central-bank/forex-spread
// Central-bank chair sets the spread-fee strength (0.5–1.5×) for their currency.
// Once per FOREX_SPREAD_STRENGTH_COOLDOWN_TURNS. Auth: chair or admin.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isSameCountry } from "@/lib/api/sameCountry";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  COUNTRY_CURRENCY_MAP,
  getCountryIdForCurrency,
  clampForexSpreadStrength,
  FOREX_SPREAD_STRENGTH_MIN,
  FOREX_SPREAD_STRENGTH_MAX,
  FOREX_SPREAD_STRENGTH_COOLDOWN_TURNS,
  FOREX_SPREAD_STRENGTH_DEFAULT,
} from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { getGameState } from "@/lib/gameState";
import type { CentralBank, Character, ExchangeRate, GameState } from "@/lib/db/types";

interface RouteContext {
  params: Promise<{ code: string }>;
}

const schema = z.object({
  strength: z.number().finite().min(FOREX_SPREAD_STRENGTH_MIN).max(FOREX_SPREAD_STRENGTH_MAX),
});

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const rateLimit = checkRateLimit(auth.user.userId, 20, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { code } = await context.params;
    const rawCountryId = code.toUpperCase();
    if (!(rawCountryId in COUNTRY_CONFIGS)) throw badRequest("Invalid country code");
    const countryId = rawCountryId as CountryId;

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const strength = clampForexSpreadStrength(parsed.data.strength);

    const myChar = auth.user.character as Character | null;
    const isAdmin = auth.user.isAdmin === true;
    if (!myChar) throw forbidden("Character required");

    const db = await getDb();
    const bankId = getBankId(countryId);
    const bank = await db.collection<CentralBank>("centralBanks").findOne({ _id: bankId });
    if (!bank) throw notFound("Central bank not found");

    const isChair = !!bank.chairCharacterId && myChar._id.equals(bank.chairCharacterId);
    if (isChair && !isSameCountry(myChar, { countryId })) {
      throw forbidden("Chair must be a citizen of this country");
    }
    if (!isAdmin && !isChair) {
      throw forbidden("Only the current chair can adjust the forex spread strength");
    }
    if (!isAdmin && bank.chairControlsLocked === true) {
      throw forbidden("Chair controls are locked by an administrator");
    }

    // The exchangeRates doc holding this currency lives at its anchor country.
    const currency = COUNTRY_CURRENCY_MAP[countryId];
    if (!currency) throw badRequest("Country has no forex currency");
    const rateDocId = getCountryIdForCurrency(currency);

    const gs = (await getGameState()) as Pick<GameState, "currentTurn"> | null;
    const currentTurn = gs?.currentTurn ?? 0;

    const rateDoc = await db.collection<ExchangeRate>("exchangeRates").findOne({ _id: rateDocId });
    if (!rateDoc) throw notFound("Exchange rate not found for this currency");

    // Cooldown (admins bypass).
    const lastChanged = rateDoc.forexSpreadStrengthLastChangedTurn ?? -Infinity;
    const turnsSince = currentTurn - lastChanged;
    if (
      !isAdmin &&
      Number.isFinite(lastChanged) &&
      turnsSince < FOREX_SPREAD_STRENGTH_COOLDOWN_TURNS
    ) {
      const remaining = FOREX_SPREAD_STRENGTH_COOLDOWN_TURNS - turnsSince;
      throw badRequest(
        `Spread strength can be changed once every ${FOREX_SPREAD_STRENGTH_COOLDOWN_TURNS} turns. ${remaining} turn(s) remaining.`
      );
    }

    await db.collection<ExchangeRate>("exchangeRates").updateOne(
      { _id: rateDocId },
      {
        $set: {
          forexSpreadStrength: strength,
          forexSpreadStrengthLastChangedTurn: currentTurn,
          updatedAt: new Date(),
        },
      }
    );

    return NextResponse.json({
      success: true,
      currency,
      strength,
      defaultStrength: FOREX_SPREAD_STRENGTH_DEFAULT,
      nextChangeTurn: currentTurn + FOREX_SPREAD_STRENGTH_COOLDOWN_TURNS,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
