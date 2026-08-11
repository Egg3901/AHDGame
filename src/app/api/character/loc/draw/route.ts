// POST /api/character/loc/draw - Borrow into personal wallet; enforces cap and freeze
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 429

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
import { isLineOfCreditEnabled } from "@/lib/lineOfCredit/featureFlag";
import { buildLocSnapshot } from "@/lib/lineOfCredit/buildSnapshot";
import { loadExchangeRatesMap } from "@/lib/lineOfCredit/netWorth";
import { toInternalUnits } from "@/lib/lineOfCredit/locMath";
import { DEFAULT_LOAN_FUNDING_SOURCE } from "@/lib/lineOfCredit/fundingSource";
import { buildPersonalBalanceInc } from "@/lib/currency/characterFunds";
import { normalizeSavingsMutationAmount } from "@/lib/api/savings/savingsAmount";
import { getGameState } from "@/lib/gameState";
import { insertLocLedgerEntry } from "@/lib/lineOfCredit/ledger";
import { emitTx } from "@/lib/financialTxLog/emit";
import { FOREX_ACTIVE_CURRENCIES, ZOD_ACTIVE_CURRENCY_ENUM } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";

const drawSchema = z.object({
  currency: z.enum(ZOD_ACTIVE_CURRENCY_ENUM),
  amount: z.number(),
});

function buildLocDrawLimitMessage(
  snapshot: NonNullable<Awaited<ReturnType<typeof buildLocSnapshot>>>,
  addInternal: number
) {
  const perPlayerHeadroom = Math.max(
    0,
    snapshot.perPlayerLimitInternal - snapshot.outstandingInternal
  );
  const poolBinding =
    snapshot.availableBorrowInternal < perPlayerHeadroom &&
    addInternal > snapshot.availableBorrowInternal + 1e-6;

  if (poolBinding) {
    return "The exchange's lending pool is exhausted. New borrowing is blocked until deposits or reserves recover, or existing loans are repaid.";
  }

  // netWorth cap is binding when there's no income (equity-only mode) or equity cap ≤ DTI cap.
  const netWorthBinding =
    snapshot.dtiLimitInternal <= 0 || snapshot.netWorthLimitInternal <= snapshot.dtiLimitInternal;

  return netWorthBinding
    ? "Exceeds your credit limit - total borrowing cannot exceed your current net worth."
    : "Exceeds your credit limit - borrowing is capped by your average recurring income over the last 48 turns.";
}

function buildLocOptimisticFilter(
  character: Character,
  currency: CurrencyCode
): Record<string, unknown> {
  const loc = character.lineOfCredit;
  const balances = loc?.balances ?? {};
  const arrears = loc?.arrears ?? {};
  const filter: Record<string, unknown> = {
    _id: character._id,
    [`lineOfCredit.accountsOpened.${currency}`]: true,
    "lineOfCredit.drawFrozen": { $ne: true },
  };

  for (const code of FOREX_ACTIVE_CURRENCIES) {
    const expectedBalance = balances[code] ?? 0;
    const expectedArrears = arrears[code] ?? 0;
    filter[`lineOfCredit.balances.${code}`] =
      expectedBalance > 0 ? expectedBalance : { $not: { $gt: 0 } };
    filter[`lineOfCredit.arrears.${code}`] =
      expectedArrears > 0 ? expectedArrears : { $not: { $gt: 0 } };
  }

  return filter;
}

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

    const parsed = await parseJsonBody(request, drawSchema);
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
      return NextResponse.json(badRequest("Open an LOC account for this currency first").toJson(), {
        status: 400,
      });
    }
    if (loc.drawFrozen) {
      return NextResponse.json(
        badRequest("Draws are frozen until loan service catches up").toJson(),
        { status: 400 }
      );
    }

    const snapshot = await buildLocSnapshot(db, character);
    if (!snapshot) {
      return NextResponse.json({ error: "Line of credit is not available" }, { status: 404 });
    }

    const rates = await loadExchangeRatesMap(db);
    const rate = rates[c];
    if (!rate || rate <= 0) {
      return NextResponse.json(badRequest("Missing exchange rate for currency").toJson(), {
        status: 400,
      });
    }

    const addInternal = toInternalUnits(normalized, rate);
    if (addInternal > snapshot.perPlayerAvailableInternal + 1e-6) {
      return NextResponse.json(
        badRequest(buildLocDrawLimitMessage(snapshot, addInternal)).toJson(),
        { status: 400 }
      );
    }

    // Guard the write with the LOC state we priced this draw against so
    // concurrent same-turn draws cannot stack stale headroom and overrun the cap.
    const fundingSource = loc.fundingSource?.[c] ?? DEFAULT_LOAN_FUNDING_SOURCE;
    const personalInc = buildPersonalBalanceInc(normalized, c, true);
    const now = new Date();

    const writeResult = await db
      .collection<Character>("characters")
      .updateOne(buildLocOptimisticFilter(character, c), {
        $inc: { ...personalInc, [`lineOfCredit.balances.${c}`]: normalized },
        $set: {
          updatedAt: now,
          [`lineOfCredit.fundingSource.${c}`]: fundingSource,
        },
      });
    if (writeResult.matchedCount === 0) {
      const freshCharacter = await db
        .collection<Character>("characters")
        .findOne({ _id: character._id });
      if (!freshCharacter?.lineOfCredit?.accountsOpened?.[c]) {
        return NextResponse.json(
          badRequest("Open an LOC account for this currency first").toJson(),
          { status: 400 }
        );
      }
      if (freshCharacter.lineOfCredit.drawFrozen) {
        return NextResponse.json(
          badRequest("Draws are frozen until loan service catches up").toJson(),
          { status: 400 }
        );
      }

      const freshSnapshot = await buildLocSnapshot(db, freshCharacter);
      if (!freshSnapshot) {
        return NextResponse.json({ error: "Line of credit is not available" }, { status: 404 });
      }
      if (addInternal > freshSnapshot.perPlayerAvailableInternal + 1e-6) {
        return NextResponse.json(
          badRequest(buildLocDrawLimitMessage(freshSnapshot, addInternal)).toJson(),
          { status: 400 }
        );
      }

      return NextResponse.json(
        badRequest(
          "Your line of credit changed while this draw was processing. Please try again."
        ).toJson(),
        { status: 400 }
      );
    }

    const gameState = await getGameState();
    const turn = gameState?.currentTurn ?? 0;
    const after = await db.collection<Character>("characters").findOne({ _id: character._id });
    if (after?.lineOfCredit) {
      await insertLocLedgerEntry(db, {
        characterId: character._id,
        currencyCode: c,
        type: "draw",
        amount: normalized,
        balanceAfter: after.lineOfCredit.balances?.[c] ?? 0,
        arrearsAfter: after.lineOfCredit.arrears?.[c] ?? 0,
        turn,
      });
    }

    void emitTx(db, {
      type: "loc_draw",
      turn,
      createdAt: now,
      subjectType: "character",
      subjectId: character._id,
      subjectName: character.name,
      amount: normalized,
      currencyCode: c,
    });

    return NextResponse.json({ success: true, currency: c, amount: normalized });
  } catch (error) {
    return handleRouteError(error);
  }
}
