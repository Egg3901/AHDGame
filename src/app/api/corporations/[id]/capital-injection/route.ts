import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { getGameState } from "@/lib/gameState";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getHomeCurrency, getPersonalBalance } from "@/lib/currency/characterFunds";
import {
  atomicallyDebitCharacterCash,
  refundCharacterCash,
} from "@/lib/financialTxLog/atomicCashGuard";
import {
  anchorToCorpLiquidCapital,
  getCorpFxRate,
  loadFxRatesByCurrency,
} from "@/lib/currency/corporationCapital";
import { emitTx } from "@/lib/financialTxLog/emit";
import type { Character, Corporation } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";

const schema = z.object({
  /** Amount in the character's home currency. */
  amount: z.number().positive("Amount must be positive"),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/capital-injection
 * CEO injects personal cash directly into a private corporation's liquid capital.
 * Only available for private (non-public, non-national) corporations.
 *
 * Body: { amount: number } — in the CEO's home currency
 * Auth: CEO only
 * Errors: 400, 401, 403, 404
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { amount } = parsed.data;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    // CEO check
    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    // Private corps only
    if (!corporation.isPrivate) {
      return NextResponse.json(
        {
          error:
            "Direct capital injection is only available for private corporations. Public corps raise capital through share issuance.",
        },
        { status: 400 }
      );
    }
    if (corporation.countryOwnerId) {
      return NextResponse.json(
        { error: "Capital injection is not available for national corporations." },
        { status: 400 }
      );
    }

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 0;

    // Load CEO character to get cash balance and home currency.
    const character = await db
      .collection<Character>("characters")
      .findOne({ userId: new ObjectId(auth.user.userId) });
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const forexEnabled = await isForexEnabled();
    const homeCurrency = getHomeCurrency(character);
    const currentBalance = getPersonalBalance(character, homeCurrency, forexEnabled);

    if (currentBalance < amount) {
      return NextResponse.json(
        {
          error: `Insufficient personal funds. You have ${homeCurrency} ${Math.floor(currentBalance).toLocaleString()} liquid; injection requires ${homeCurrency} ${amount.toLocaleString()}.`,
        },
        { status: 400 }
      );
    }

    // Convert the amount from CEO home currency to corp's liquid currency.
    const fxByCurrency = await loadFxRatesByCurrency(db);
    const corpFxRate = await getCorpFxRate(db, corporation);

    // Convert CEO's home currency amount to anchor (₳), then to corp capital.
    const charCurrencyCode =
      homeCurrency ??
      (COUNTRY_CURRENCY_MAP[character.countryId as CountryId] as CurrencyCode | undefined) ??
      ("USD" as CurrencyCode);
    const charFxRate = fxByCurrency.get(charCurrencyCode as CurrencyCode) ?? 1;
    // Amount in ₳ (anchor): local / fxRate
    const amountAnchor = forexEnabled && charFxRate > 0 ? amount / charFxRate : amount;
    // Amount in corp's liquid capital currency
    const amountInCorpCapital = anchorToCorpLiquidCapital(amountAnchor, corporation, corpFxRate);

    // Debit CEO cash atomically
    const debitResult = await atomicallyDebitCharacterCash(
      db,
      character._id,
      charCurrencyCode as CurrencyCode,
      amount,
      forexEnabled
    );
    if (!debitResult.ok) {
      return NextResponse.json(
        { error: "Insufficient personal funds (race condition). Please try again." },
        { status: 400 }
      );
    }

    const now = new Date();
    try {
      // Credit the corp's liquid capital
      await db
        .collection<Corporation>("corporations")
        .updateOne(
          { _id: corporation._id },
          { $inc: { liquidCapital: amountInCorpCapital }, $set: { updatedAt: now } }
        );
    } catch (err) {
      // Refund the CEO if the corp credit fails
      await refundCharacterCash(
        db,
        character._id,
        charCurrencyCode as CurrencyCode,
        amount,
        forexEnabled
      );
      throw err;
    }

    void emitTx(db, {
      type: "corp_capital_injection",
      turn: currentTurn,
      createdAt: now,
      subjectType: "corporation",
      subjectId: corporation._id,
      subjectName: corporation.name,
      amount: amountInCorpCapital,
      currencyCode: (charCurrencyCode ?? "USD") as CurrencyCode,
      meta: {
        characterId: character._id.toString(),
        characterName: character.name,
        amountAnchor,
      },
    });

    return NextResponse.json({
      success: true,
      injectedAmount: amountInCorpCapital,
      currencyCode: charCurrencyCode,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
