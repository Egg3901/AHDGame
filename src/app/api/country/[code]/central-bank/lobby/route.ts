import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { handleRouteError, badRequest, notFound } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { Character } from "@/lib/db/types";
import { CENTRAL_BANK_LOBBY_MIN_AMOUNT } from "@/lib/constants/centralBankLobby";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  atomicallyDebitCharacterCash,
  refundCharacterCash,
} from "@/lib/financialTxLog/atomicCashGuard";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { autoConvertForPurchase } from "@/lib/currency/autoConvert";
import { getGameState } from "@/lib/gameState";
import { getCentralBankScope } from "@/lib/centralBank/helpers";

interface RouteContext {
  params: Promise<{ code: string }>;
}

const schema = z.object({
  targetCharacterId: schemas.objectId,
  amount: z.number().int().min(CENTRAL_BANK_LOBBY_MIN_AMOUNT),
});

export async function POST(request: Request, context: RouteContext) {
  try {
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(authResult.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const auth = authResult.user;

    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;
    const config = COUNTRY_CONFIGS[countryId];
    if (!config) return NextResponse.json(notFound("Country not found").toJson(), { status: 404 });

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { targetCharacterId: targetIdStr, amount } = parsed.data;
    const targetId = new ObjectId(targetIdStr);

    const db = await getDb();
    const { bankId, memberCountries } = await getCentralBankScope(db, countryId);
    // Caller must be in this bank's member countries.
    if (!memberCountries.includes(auth.character.countryId as CountryId))
      return NextResponse.json(badRequest("Your character is not in this bank's scope").toJson(), {
        status: 400,
      });

    const centralBanks = db.collection<CentralBank>("centralBanks");
    const characters = db.collection<Character>("characters");

    const bank = await centralBanks.findOne({ _id: bankId });
    if (!bank)
      return NextResponse.json(notFound("Central bank not found").toJson(), { status: 404 });

    const forexEnabled = await isForexEnabled();

    // With the market/wealth candidate pool removed, lobbying only makes sense
    // for someone actually in the running: a nominated candidate.
    const isNominee = (bank.nominations ?? []).some(
      (n) => n.characterId.toString() === targetId.toString()
    );

    if (!isNominee)
      return NextResponse.json(badRequest("Target must be a nominated candidate").toJson(), {
        status: 400,
      });

    // Validate caller has enough cash — check against home-currency liquid (same
    // bucket we'll deduct from). The old check compared internal-unit total wealth
    // to a home-face amount, a unit mismatch that let savings-heavy players pass
    // and then underflow their liquid balance on deduct.
    const callerChar = await characters.findOne({ _id: auth.character._id });
    if (!callerChar) {
      return NextResponse.json(badRequest("Character not found").toJson(), { status: 400 });
    }

    // Lobbying is paid in this central bank's national currency (wallet liquid).
    // When the player visits a foreign CB, auto-convert tops up from home currency if enabled.
    const payCurrency = COUNTRY_CURRENCY_MAP[countryId];
    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 0;

    if (forexEnabled) {
      const convertResult = await autoConvertForPurchase(db, {
        character: callerChar,
        requiredCurrency: payCurrency,
        requiredAmount: amount,
        turn: currentTurn,
        forexEnabled: true,
      });
      if (!convertResult.success) {
        return NextResponse.json(
          badRequest(convertResult.error ?? "Insufficient liquid funds for lobbying").toJson(),
          { status: 400 }
        );
      }
    }

    // Get target character name
    const target = await characters.findOne({ _id: targetId });
    if (!target)
      return NextResponse.json(badRequest("Target character not found").toJson(), { status: 400 });

    // Atomic balance-gated debit on lobbying spend. Pre-fix path read
    // cashOnHand into `liquid`, checked it, then ran a separate naïve $inc
    // — same race shape as the bond-buy bug. Since the CB lobby route is a
    // hot path during election cycles, leaving it unguarded was a real
    // exploit vector for the same wealth-mint pattern.
    const debitResult = await atomicallyDebitCharacterCash(
      db,
      auth.character._id,
      payCurrency,
      amount,
      forexEnabled
    );
    if (!debitResult.ok) {
      return NextResponse.json(badRequest("Insufficient liquid cash on hand").toJson(), {
        status: 400,
      });
    }

    // Add lobbying entry. If the bank write loses a race or throws, refund the
    // just-debited cash so lobbying cannot silently burn player funds.
    try {
      const lobbyResult = await centralBanks.updateOne(
        { _id: bankId },
        {
          $push: {
            lobbyingPool: {
              targetCharacterId: targetId,
              targetCharacterName: target.name,
              lobbyistCharacterId: auth.character._id,
              amount,
              createdAt: new Date(),
            },
          },
          $set: { updatedAt: new Date() },
        }
      );

      if (lobbyResult.matchedCount === 0) {
        await refundCharacterCash(db, auth.character._id, payCurrency, amount, forexEnabled);
        return NextResponse.json(badRequest("Central bank not found").toJson(), { status: 404 });
      }
    } catch (error) {
      await refundCharacterCash(db, auth.character._id, payCurrency, amount, forexEnabled);
      throw error;
    }

    // Return aggregated totals (no individual contributor info)
    const updated = await centralBanks.findOne({ _id: bankId });
    const totalsMap = new Map<
      string,
      { characterId: string; characterName: string; totalAmount: number }
    >();
    for (const entry of updated?.lobbyingPool ?? []) {
      const key = entry.targetCharacterId.toString();
      const existing = totalsMap.get(key);
      if (existing) {
        existing.totalAmount += entry.amount;
      } else {
        totalsMap.set(key, {
          characterId: key,
          characterName: entry.targetCharacterName,
          totalAmount: entry.amount,
        });
      }
    }

    return NextResponse.json({
      success: true,
      lobbyingTotals: Array.from(totalsMap.values()).sort((a, b) => b.totalAmount - a.totalAmount),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
