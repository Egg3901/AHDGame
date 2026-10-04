// POST /api/character/loc/draw - Borrow into personal wallet; enforces cap and freeze
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 429

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
import { buildLocSnapshot } from "@/lib/lineOfCredit/buildSnapshot";
import { loadExchangeRatesMap } from "@/lib/lineOfCredit/netWorth";
import { toInternalUnits } from "@/lib/lineOfCredit/locMath";
import { DEFAULT_LOAN_FUNDING_SOURCE } from "@/lib/lineOfCredit/fundingSource";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import { getBankId } from "@/lib/centralBank/helpers";
import { buildPersonalBalanceInc } from "@/lib/currency/characterFunds";
import { normalizeSavingsMutationAmount } from "@/lib/api/savings/savingsAmount";
import { getGameState } from "@/lib/gameState";
import { loadLocSettlement, settleLocPlan } from "@/lib/lineOfCredit/settlement";

import { getCountryIdForCurrency, ZOD_ACTIVE_CURRENCY_ENUM } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";

const drawSchema = z.object({
  currency: z.enum(ZOD_ACTIVE_CURRENCY_ENUM),
  amount: z.number(),
  commandId: z.string().uuid(),
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

    const key = `loc:draw:${character._id}:${commandId}`;
    const requestQuote = { operation: "draw", currency: c, amount: normalized };
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
      return errorResponse(404, "Line of credit is not available");
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

    const turn = (await getGameState())?.currentTurn ?? 0;
    const locAfter = {
      ...loc,
      balances: { ...loc.balances, [c]: (loc.balances?.[c] ?? 0) + normalized },
      fundingSource: { ...loc.fundingSource, [c]: fundingSource },
    };
    const settled = await settleLocPlan(db, key, turn, {
      characterId: character._id,
      expectedLoc: loc,
      expectedRevision:
        (character as Character & { lineOfCreditRevision?: number }).lineOfCreditRevision ?? null,
      request: requestQuote,
      drawAdmission: {
        bankId: getBankId(getCountryIdForCurrency(getHomeCurrency(character))),
        addInternal,
        exchangeRate: rate,
      },
      createdAt: now,
      effect: {
        locAfter,
        walletInc: personalInc,
        reserves: [],
        ledger: [
          {
            characterId: character._id,
            countryId: getCountryIdForCurrency(c),
            currencyCode: c,
            type: "draw",
            amount: normalized,
            balanceAfter: locAfter.balances[c]!,
            arrearsAfter: loc.arrears?.[c] ?? 0,
            turn,
          },
        ],
        transactions: [
          {
            type: "loc_draw",
            turn,
            subjectType: "character",
            subjectId: character._id,
            subjectName: character.name,
            amount: normalized,
            currencyCode: c,
          },
        ],
        flows: [
          { kind: "mint", currency: c, amount: normalized, note: "LOC origination" },
          { kind: "credit", currency: c, amount: normalized, note: "Borrower personal wallet" },
        ],
        result: { success: true, currency: c, amount: normalized },
      },
    });
    if (settled.error) {
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
        return errorResponse(404, "Line of credit is not available");
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

    return NextResponse.json({ success: true, currency: c, amount: normalized });
  } catch (error) {
    return handleRouteError(error);
  }
}
