import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, badRequest, errorResponse } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse, SAVINGS_WALLET_LIMITS } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import type { Character } from "@/lib/db/types";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  getPersonalBalance,
  getHomeCurrency,
  getSavingsBalance,
  isSavingsAccountOpened,
} from "@/lib/currency/characterFunds";
import { loadBankingPolicy } from "@/lib/banking/policy";
import { ensureSavingsAccount } from "@/lib/savings/accountsShell";
import { insertSavingsLedgerEntry } from "@/lib/savings/ledger";
import { getGameState } from "@/lib/gameState";
import { ZOD_ACTIVE_CURRENCY_ENUM } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";

const openSchema = z.object({
  currency: z.enum(ZOD_ACTIVE_CURRENCY_ENUM),
});

// POST /api/character/savings/open — Open a high-yield savings bucket for USD, GBP, or JPY (requires liquid balance in that currency)
// Auth: requireBasicAuth
// Errors: 400, 401, 429
export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(
      auth.user.userId,
      SAVINGS_WALLET_LIMITS.maxRequests,
      SAVINGS_WALLET_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, openSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { currency } = parsed.data;

    const db = await getDb();
    const forexEnabled = await isForexEnabled();

    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return NextResponse.json(badRequest("Character not found").toJson(), { status: 400 });
    }

    if (!forexEnabled) {
      const home = getHomeCurrency(character);
      if (currency !== home) {
        return NextResponse.json(
          badRequest("Savings in foreign currency require the forex system").toJson(),
          { status: 400 }
        );
      }
    }

    const gameState = await getGameState();
    const turn = gameState?.currentTurn ?? 0;
    const policy = await loadBankingPolicy(db);
    // Authoritative accounts must exist as soon as the opening flag is visible,
    // including a retry after an older opening created only the legacy flag.
    const alreadyOpened = isSavingsAccountOpened(character, currency);
    if (alreadyOpened && policy.savingsAccounts === "authoritative") {
      const account = await ensureSavingsAccount(db, character._id, currency, turn);
      if (!account) {
        return errorResponse(409, "Savings account could not be opened. Try again.");
      }
    }
    if (alreadyOpened) {
      return NextResponse.json(
        badRequest("Savings account already open for this currency").toJson(),
        {
          status: 400,
        }
      );
    }

    const liquid = getPersonalBalance(character, currency as CurrencyCode, forexEnabled);
    if (liquid <= 0) {
      return NextResponse.json(
        badRequest("Hold a balance in this currency before opening savings").toJson(),
        { status: 400 }
      );
    }

    if (policy.savingsAccounts === "authoritative") {
      const account = await ensureSavingsAccount(db, character._id, currency, turn);
      if (!account) {
        return errorResponse(409, "Savings account could not be opened. Try again.");
      }
    }

    const now = new Date();
    await db
      .collection<Character>("characters")
      .updateOne(
        { _id: character._id },
        { $set: { [`savingsAccountsOpened.${currency}`]: true, updatedAt: now } }
      );

    const after = await db.collection<Character>("characters").findOne({ _id: character._id });
    if (after) {
      await insertSavingsLedgerEntry(db, {
        characterId: character._id,
        currencyCode: currency as CurrencyCode,
        type: "open",
        amount: 0,
        balanceAfter: getSavingsBalance(after, currency as CurrencyCode, forexEnabled),
        turn,
      });
    }

    return NextResponse.json({ success: true, currency });
  } catch (error) {
    return handleRouteError(error);
  }
}
