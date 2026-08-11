// POST /api/country/[code]/central-bank/reserve-exchange - Convert central-bank reserve balances between currencies.
// Auth: requireAuth
// Errors: 400, 401, 403, 404

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
  FOREX_ACTIVE_CURRENCIES,
  MARKET_MAKER_SPREAD,
  ZOD_ACTIVE_CURRENCY_ENUM,
} from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import type { CentralBank, Character, ExchangeRate } from "@/lib/db/types";

interface RouteContext {
  params: Promise<{ code: string }>;
}

const exchangeSchema = z.object({
  fromCurrency: z.enum(ZOD_ACTIVE_CURRENCY_ENUM),
  toCurrency: z.enum(ZOD_ACTIVE_CURRENCY_ENUM),
  amount: z.number().finite().positive().max(1_000_000_000_000_000),
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

    const parsed = await parseJsonBody(request, exchangeSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { fromCurrency, toCurrency } = parsed.data;
    const amount = Math.floor(parsed.data.amount);
    if (fromCurrency === toCurrency) throw badRequest("Choose two different currencies");
    if (amount <= 0) throw badRequest("Amount must be at least 1");
    if (
      !FOREX_ACTIVE_CURRENCIES.includes(fromCurrency) ||
      !FOREX_ACTIVE_CURRENCIES.includes(toCurrency)
    ) {
      throw badRequest("Currency is not active for forex");
    }

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
      throw forbidden("Only the current chair can exchange central-bank reserves");
    }
    if (!isAdmin && bank.chairControlsLocked === true) {
      throw forbidden("Chair controls are locked by an administrator");
    }

    const currentBalance = bank.spreadFeeReserveBalances?.[fromCurrency] ?? 0;
    if (!Number.isFinite(currentBalance) || currentBalance < amount) {
      throw badRequest(`Insufficient ${fromCurrency} reserve balance`);
    }

    const rates = await db
      .collection<ExchangeRate>("exchangeRates")
      .find({ currencyCode: { $in: [fromCurrency, toCurrency] } })
      .toArray();
    const rateByCurrency = new Map(rates.map((rate) => [rate.currencyCode, rate.rate]));
    const fromRate = rateByCurrency.get(fromCurrency);
    const toRate = rateByCurrency.get(toCurrency);
    if (!fromRate || !toRate || fromRate <= 0 || toRate <= 0) {
      throw badRequest("Exchange rate is unavailable for one or both currencies");
    }

    // Charge spread fee on reserve exchange (same MARKET_MAKER_SPREAD as player trades)
    const spreadFee = Math.max(1, Math.round(amount * MARKET_MAKER_SPREAD));
    const netAmount = amount - spreadFee;
    const receivedAmount = Math.round((netAmount / fromRate) * toRate);
    if (!Number.isFinite(receivedAmount) || receivedAmount <= 0) {
      throw badRequest("Exchange amount is too small at current rates");
    }

    const result = await db.collection<CentralBank>("centralBanks").updateOne(
      { _id: bankId, [`spreadFeeReserveBalances.${fromCurrency}`]: { $gte: amount } },
      {
        $inc: {
          [`spreadFeeReserveBalances.${fromCurrency}`]: -amount,
          [`spreadFeeReserveBalances.${toCurrency}`]: receivedAmount,
          forexRevenue: Math.floor(spreadFee / 2),
        },
        $set: { updatedAt: new Date() },
      },
      { upsert: true }
    );
    if (result.matchedCount === 0) throw badRequest(`Insufficient ${fromCurrency} reserve balance`);

    return NextResponse.json({
      success: true,
      fromCurrency,
      toCurrency,
      spentAmount: amount,
      receivedAmount,
      rate: toRate / fromRate,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
