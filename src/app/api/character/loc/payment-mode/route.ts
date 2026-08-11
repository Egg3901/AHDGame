// POST /api/character/loc/payment-mode — Flip P/I ⇄ I/O for a currency. 24-turn cooldown per currency.
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 409, 429

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse, SAVINGS_WALLET_LIMITS } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { isLineOfCreditEnabled } from "@/lib/lineOfCredit/featureFlag";
import { insertLocLedgerEntry } from "@/lib/lineOfCredit/ledger";
import { LOC_PAYMENT_MODE_COOLDOWN_TURNS } from "@/lib/lineOfCredit/locMath";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { ZOD_ACTIVE_CURRENCY_ENUM } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { Character } from "@/lib/db/types";
import type { LocPaymentMode } from "@/lib/db/types/character";

const bodySchema = z.object({
  currency: z.enum(ZOD_ACTIVE_CURRENCY_ENUM),
  mode: z.enum(["pi", "io"]),
});

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

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { currency, mode } = parsed.data;
    const c = currency as CurrencyCode;
    const nextMode = mode as LocPaymentMode;

    const db = await getDb();
    const [forexEnabled, locEnabled] = await Promise.all([
      isForexEnabled(),
      isLineOfCreditEnabled(),
    ]);
    if (!locEnabled || !forexEnabled) {
      return NextResponse.json({ error: "Line of credit is not available" }, { status: 404 });
    }

    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const loc = character.lineOfCredit;
    if (!loc?.accountsOpened?.[c]) {
      return NextResponse.json(badRequest("Open the account first").toJson(), { status: 400 });
    }

    const currentMode: LocPaymentMode = loc.paymentMode?.[c] ?? "pi";
    const currentTurn = await getCurrentTurn(db);

    // Idempotent no-op: requesting the current mode succeeds without writing.
    if (currentMode === nextMode) {
      const lastTurn = loc.paymentModeChangedAt?.[c]?.turn;
      return NextResponse.json({
        success: true,
        currency: c,
        mode: currentMode,
        changedAtTurn: lastTurn ?? null,
        nextEligibleTurn:
          typeof lastTurn === "number" ? lastTurn + LOC_PAYMENT_MODE_COOLDOWN_TURNS : currentTurn,
      });
    }

    const lastChangedTurn = loc.paymentModeChangedAt?.[c]?.turn;
    if (
      typeof lastChangedTurn === "number" &&
      currentTurn - lastChangedTurn < LOC_PAYMENT_MODE_COOLDOWN_TURNS
    ) {
      const nextEligibleTurn = lastChangedTurn + LOC_PAYMENT_MODE_COOLDOWN_TURNS;
      return NextResponse.json(
        {
          error: `Payment mode can only change every ${LOC_PAYMENT_MODE_COOLDOWN_TURNS} turns. Next eligible at turn ${nextEligibleTurn}.`,
          nextEligibleTurn,
        },
        { status: 409 }
      );
    }

    const now = new Date();
    await db.collection<Character>("characters").updateOne(
      { _id: character._id },
      {
        $set: {
          [`lineOfCredit.paymentMode.${c}`]: nextMode,
          [`lineOfCredit.paymentModeChangedAt.${c}`]: { at: now, turn: currentTurn },
          updatedAt: now,
        },
      }
    );

    await insertLocLedgerEntry(db, {
      characterId: character._id,
      currencyCode: c,
      type: "paymode_change",
      amount: 0,
      balanceAfter: loc.balances?.[c] ?? 0,
      arrearsAfter: loc.arrears?.[c] ?? 0,
      turn: currentTurn,
      meta: { from: currentMode, to: nextMode },
    });

    return NextResponse.json({
      success: true,
      currency: c,
      mode: nextMode,
      changedAtTurn: currentTurn,
      nextEligibleTurn: currentTurn + LOC_PAYMENT_MODE_COOLDOWN_TURNS,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
