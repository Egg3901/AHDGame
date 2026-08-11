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
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse, SAVINGS_WALLET_LIMITS } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import type { Character, CentralBank } from "@/lib/db/types";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { isLineOfCreditEnabled } from "@/lib/lineOfCredit/featureFlag";
import { getPersonalBalance } from "@/lib/currency/characterFunds";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { normalizeSavingsMutationAmount } from "@/lib/api/savings/savingsAmount";
import { getGameState } from "@/lib/gameState";
import { insertLocLedgerEntry } from "@/lib/lineOfCredit/ledger";
import { emitTx } from "@/lib/financialTxLog/emit";
import {
  FOREX_ACTIVE_CURRENCIES,
  ZOD_ACTIVE_CURRENCY_ENUM,
  getCountryIdForCurrency,
} from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { roundSavingsAmount } from "@/lib/currency/savingsInterest";

const repaySchema = z.object({
  currency: z.enum(ZOD_ACTIVE_CURRENCY_ENUM),
  amount: z.number(),
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
    const { currency, amount: rawAmount } = parsed.data;
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
      return NextResponse.json({ error: "Line of credit is not available" }, { status: 404 });
    }

    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return NextResponse.json(badRequest("Character not found").toJson(), { status: 400 });
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

    const inc: Record<string, number> = {};
    if (fromPersonal > 0) {
      inc[`currencyBalances.personal.${c}`] = -fromPersonal;
    }
    if (takeA > 0) inc[`lineOfCredit.arrears.${c}`] = -takeA;
    if (takeB > 0) inc[`lineOfCredit.balances.${c}`] = -takeB;

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

    const now = new Date();
    const set: Record<string, unknown> = { updatedAt: now };
    if (clearFreeze) set["lineOfCredit.drawFrozen"] = false;

    // Atomic filter guards against concurrent personal-balance depletion between read and write.
    const filter: Record<string, unknown> = { _id: character._id };
    if (fromPersonal > 0) {
      filter[`currencyBalances.personal.${c}`] = { $gte: fromPersonal };
    }

    const res = await db
      .collection<Character>("characters")
      .updateOne(filter, Object.keys(inc).length > 0 ? { $inc: inc, $set: set } : { $set: set });
    if (res.matchedCount === 0) {
      return NextResponse.json(badRequest("Insufficient personal balance").toJson(), {
        status: 400,
      });
    }

    // Only the interest portion (takeA) credits the lending bank's reserves —
    // interest is bank revenue. Principal (takeB) is destroyed symmetrically to
    // how `draw` created it: originating a loan doesn't debit any bank pool, so
    // repayment of principal doesn't credit one either. Crediting principal here
    // would mint free money for the bank on every borrow→repay cycle.
    const reservesCredit = takeA;
    if (reservesCredit > 0) {
      const lendingBankId = getBankId(getCountryIdForCurrency(c));
      await db
        .collection<CentralBank>("centralBanks")
        .updateOne({ _id: lendingBankId }, { $inc: { reserveBalance: reservesCredit } });
    }

    const gameState = await getGameState();
    const turn = gameState?.currentTurn ?? 0;
    const after = await db.collection<Character>("characters").findOne({ _id: character._id });

    // Remove currency keys that hit exactly zero to keep the document clean.
    const zeroUnset: Record<string, 1> = {};
    if ((after?.lineOfCredit?.balances?.[c] ?? -1) <= 0)
      zeroUnset[`lineOfCredit.balances.${c}`] = 1;
    if ((after?.lineOfCredit?.arrears?.[c] ?? -1) <= 0) zeroUnset[`lineOfCredit.arrears.${c}`] = 1;
    if (Object.keys(zeroUnset).length > 0) {
      await db
        .collection<Character>("characters")
        .updateOne({ _id: character._id }, { $unset: zeroUnset });
    }

    if (after?.lineOfCredit) {
      await insertLocLedgerEntry(db, {
        characterId: character._id,
        currencyCode: c,
        type: "repay",
        amount: applied,
        interestPortion: takeA,
        principalPortion: takeB,
        balanceAfter: after.lineOfCredit.balances?.[c] ?? 0,
        arrearsAfter: after.lineOfCredit.arrears?.[c] ?? 0,
        turn,
      });
      if (clearFreeze) {
        await insertLocLedgerEntry(db, {
          characterId: character._id,
          currencyCode: c,
          type: "unfreeze",
          amount: 0,
          balanceAfter: after.lineOfCredit.balances?.[c] ?? 0,
          arrearsAfter: after.lineOfCredit.arrears?.[c] ?? 0,
          turn,
        });
      }
    }

    void emitTx(db, {
      type: "loc_repay",
      turn,
      createdAt: now,
      subjectType: "character",
      subjectId: character._id,
      subjectName: character.name,
      amount: -applied,
      currencyCode: c,
      meta: { interestPortion: takeA, principalPortion: takeB },
    });

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
