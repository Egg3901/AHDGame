import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse, SAVINGS_WALLET_LIMITS } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import type { Character } from "@/lib/db/types";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  getHomeCurrency,
  getSavingsBalance,
  isSavingsAccountOpened,
  buildTransferFromSavingsInc,
} from "@/lib/currency/characterFunds";
import { insertSavingsLedgerEntry } from "@/lib/savings/ledger";
import { getGameState } from "@/lib/gameState";
import { emitTx } from "@/lib/financialTxLog/emit";
import { normalizeSavingsMutationAmount } from "@/lib/api/savings/savingsAmount";
import { ZOD_ACTIVE_CURRENCY_ENUM } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { emitBankingAuditEvent } from "@/lib/banking/auditEvents";

const withdrawSchema = z.object({
  currency: z.enum(ZOD_ACTIVE_CURRENCY_ENUM),
  amount: z.number(),
});

// POST /api/character/savings/withdraw — Move funds from savings back to liquid cash
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

    const parsed = await parseJsonBody(request, withdrawSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { currency, amount: rawAmount } = parsed.data;
    const c = currency as CurrencyCode;

    const normalized = normalizeSavingsMutationAmount(rawAmount, c);
    if (normalized === null) {
      return NextResponse.json(badRequest("Invalid amount").toJson(), { status: 400 });
    }

    const db = await getDb();
    const forexEnabled = await isForexEnabled();

    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return NextResponse.json(badRequest("Character not found").toJson(), { status: 400 });
    }

    if (!forexEnabled && c !== getHomeCurrency(character)) {
      return NextResponse.json(
        badRequest("Foreign-currency savings require the forex system").toJson(),
        { status: 400 }
      );
    }

    if (!isSavingsAccountOpened(character, c)) {
      return NextResponse.json(badRequest("No savings account for this currency").toJson(), {
        status: 400,
      });
    }

    const now = new Date();
    const inc = buildTransferFromSavingsInc(normalized, c, forexEnabled);

    if (forexEnabled) {
      const res = await db.collection<Character>("characters").updateOne(
        {
          _id: character._id,
          [`currencyBalances.savings.${c}`]: { $gte: normalized },
        },
        { $inc: inc, $set: { updatedAt: now } }
      );
      if (res.matchedCount === 0) {
        return NextResponse.json(badRequest("Insufficient savings balance").toJson(), {
          status: 400,
        });
      }
    } else {
      const res = await db.collection<Character>("characters").updateOne(
        {
          _id: character._id,
          savingsOnHand: { $gte: normalized },
        },
        { $inc: inc, $set: { updatedAt: now } }
      );
      if (res.matchedCount === 0) {
        return NextResponse.json(badRequest("Insufficient savings balance").toJson(), {
          status: 400,
        });
      }
    }

    const gameState = await getGameState();
    const turn = gameState?.currentTurn ?? 0;
    const after = await db.collection<Character>("characters").findOne({ _id: character._id });
    if (after) {
      await insertSavingsLedgerEntry(db, {
        characterId: character._id,
        currencyCode: c,
        type: "withdraw",
        amount: normalized,
        balanceAfter: getSavingsBalance(after, c, forexEnabled),
        turn,
      });
    }

    emitBankingAuditEvent(
      {
        kind: "account.withdrawn",
        command: "savings.withdraw",
        turn,
        outcome: "ok",
        currency: c,
        subjectType: "character",
        subjectId: character._id.toString(),
        statusAfter:
          (after?.currencyBalances?.savingsHolder?.[c] as string | undefined) ?? "centralBank",
        amount: -normalized,
      },
      db
    );

    void emitTx(db, {
      type: "savings_withdrawal",
      turn,
      createdAt: now,
      subjectType: "character",
      subjectId: character._id,
      subjectName: character.name,
      amount: -normalized,
      currencyCode: c,
    });

    return NextResponse.json({ success: true, currency: c, amount: normalized });
  } catch (error) {
    return handleRouteError(error);
  }
}
