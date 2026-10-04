// POST /api/character/loc/repay — Repay principal/arrears from the player's personal wallet in the loan currency
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 429
//
// A line of credit is a personal liability: repayment draws only from the
// same-currency personal balance. Campaign funds are off-limits — they're
// election capital, not general-purpose cash, and silently spending them to
// cover a personal loan would be surprising and wrong. The player is
// responsible for converting / withdrawing to cover the repayment.

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
import { isLineOfCreditEnabled } from "@/lib/lineOfCredit/featureFlag";
import { getPersonalBalance } from "@/lib/currency/characterFunds";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { normalizeSavingsMutationAmount } from "@/lib/api/savings/savingsAmount";
import { getGameState } from "@/lib/gameState";
import {
  loadLocSettlement,
  settleLocPlan,
  locInterestCredits,
} from "@/lib/lineOfCredit/settlement";

import {
  FOREX_ACTIVE_CURRENCIES,
  ZOD_ACTIVE_CURRENCY_ENUM,
  getCountryIdForCurrency,
} from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";

import { roundSavingsAmount } from "@/lib/currency/savingsInterest";

const repaySchema = z.object({
  currency: z.enum(ZOD_ACTIVE_CURRENCY_ENUM),
  amount: z.number(),
  commandId: z.string().uuid(),
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

    const parsed = await parseJsonBody(request, repaySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { currency, amount: rawAmount, commandId } = parsed.data;
    const c = currency as CurrencyCode;

    const normalized = normalizeSavingsMutationAmount(rawAmount, c);
    if (normalized === null) {
      return NextResponse.json(badRequest("Invalid amount").toJson(), { status: 400 });
    }

    const db = await getDb();
    const [forexEnabled, locEnabled] = await Promise.all([
      isForexEnabled(),
      isLineOfCreditEnabled(),
    ]);
    if (!locEnabled || !forexEnabled) {
      return errorResponse(404, "Line of credit is not available");
    }

    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return NextResponse.json(badRequest("Character not found").toJson(), { status: 400 });
    }

    const key = `loc:repay:${character._id}:${commandId}`;
    const requestQuote = { operation: "repay", currency: c, amount: normalized };
    const accepted = await loadLocSettlement(db, key);
    if (accepted) {
      const replay = await settleLocPlan(db, key, accepted.turn, {
        ...accepted.locSettlement,
        request: requestQuote,
      });
      return NextResponse.json(replay.error ? { error: replay.error } : replay.result, {
        status: replay.error ? 409 : 200,
      });
    }
    const loc = character.lineOfCredit;
    if (!loc?.accountsOpened?.[c]) {
      return NextResponse.json(badRequest("No LOC account for this currency").toJson(), {
        status: 400,
      });
    }

    const principal = loc.balances ?? {};
    const arrears = loc.arrears ?? {};
    const owed = (principal[c] ?? 0) + (arrears[c] ?? 0);
    if (owed <= 0) {
      return NextResponse.json(badRequest("No balance to repay in this currency").toJson(), {
        status: 400,
      });
    }
    const payAmount = Math.min(normalized, owed);

    const personal = getPersonalBalance(character, c, forexEnabled);
    if (personal < payAmount - 1e-6) {
      const sym = CURRENCY_SYMBOLS[c] ?? "";
      const fmt = (n: number) =>
        c === "JPY"
          ? Math.round(n).toLocaleString()
          : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return NextResponse.json(
        badRequest(
          `Insufficient ${c} in your personal wallet. Need ${sym}${fmt(payAmount)}, you have ${sym}${fmt(personal)}. Withdraw savings or trade FX to top up.`
        ).toJson(),
        { status: 400 }
      );
    }

    // Compute per-currency reductions for atomic $inc — avoids full-map $set race.
    const arrearsCurrent = arrears[c] ?? 0;
    const takeA = roundSavingsAmount(Math.min(payAmount, arrearsCurrent), c);
    const takeB = roundSavingsAmount(Math.min(payAmount - takeA, principal[c] ?? 0), c);
    const applied = takeA + takeB;
    const fromPersonal = applied;

    // Auto-clear the drawFrozen block as soon as all outstanding arrears are paid,
    // rather than waiting for the next turn's distress check (lineOfCreditTurn.ts:298)
    // to lift it. Total post-update arrears = sum across currencies, applying the
    // takeA reduction to the repay currency only.
    let postArrearsTotal = roundSavingsAmount(arrearsCurrent - takeA, c);
    for (const other of FOREX_ACTIVE_CURRENCIES) {
      if (other === c) continue;
      postArrearsTotal += arrears[other] ?? 0;
    }
    const clearFreeze = loc.drawFrozen === true && postArrearsTotal <= 0;

    const now = new Date(),
      turn = (await getGameState())?.currentTurn ?? 0;
    const newPrincipal = { ...principal },
      newArrears = { ...arrears };
    if (principal[c]! - takeB > 0) newPrincipal[c] = principal[c]! - takeB;
    else delete newPrincipal[c];
    if (arrearsCurrent - takeA > 0) newArrears[c] = arrearsCurrent - takeA;
    else delete newArrears[c];
    const locAfter = {
      ...loc,
      balances: newPrincipal,
      arrears: newArrears,
      ...(clearFreeze ? { drawFrozen: false } : {}),
    };
    const settled = await settleLocPlan(db, key, turn, {
      characterId: character._id,
      expectedLoc: loc,
      expectedRevision:
        (character as Character & { lineOfCreditRevision?: number }).lineOfCreditRevision ?? null,
      request: requestQuote,
      createdAt: now,
      effect: {
        locAfter,
        walletInc: { [`currencyBalances.personal.${c}`]: -fromPersonal },
        reserves: locInterestCredits({ [c]: takeA }),
        ledger: [
          {
            characterId: character._id,
            countryId: getCountryIdForCurrency(c),
            currencyCode: c,
            type: "repay",
            amount: applied,
            interestPortion: takeA,
            principalPortion: takeB,
            balanceAfter: newPrincipal[c] ?? 0,
            arrearsAfter: newArrears[c] ?? 0,
            turn,
          },
          ...(clearFreeze
            ? [
                {
                  characterId: character._id,
                  countryId: getCountryIdForCurrency(c),
                  currencyCode: c,
                  type: "unfreeze" as const,
                  amount: 0,
                  balanceAfter: newPrincipal[c] ?? 0,
                  arrearsAfter: newArrears[c] ?? 0,
                  turn,
                },
              ]
            : []),
        ],
        transactions: [
          {
            type: "loc_repay",
            turn,
            subjectType: "character",
            subjectId: character._id,
            subjectName: character.name,
            amount: -applied,
            currencyCode: c,
            meta: { interestPortion: takeA, principalPortion: takeB },
          },
        ],
        flows: [
          { kind: "debit", currency: c, amount: applied, note: "Borrower personal wallet" },
          { kind: "credit", currency: c, amount: takeA, note: "Lender interest reserve" },
          { kind: "burn", currency: c, amount: takeB, note: "LOC principal retired" },
        ].filter((flow) => flow.amount > 0),
        result: { success: true, currency: c, amount: applied, fromPersonal },
      },
    });
    if (settled.error) return errorResponse(409, settled.error);

    return NextResponse.json({
      success: true,
      currency: c,
      amount: applied,
      fromPersonal,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
