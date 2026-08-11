// GET /api/admin/country/[code]/central-bank/account/detail — Admin deposit or LOC detail for one character at this CB
// Auth: requireAdmin
// Errors: 400, 403, 404

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, notFound } from "@/lib/api/errors";
import type { Character, CentralBank } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, FOREX_ACTIVE_COUNTRIES } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { isLineOfCreditEnabled } from "@/lib/lineOfCredit/featureFlag";
import {
  getLifetimeInterestEarnedInCurrency,
  getPersonalBalance,
  getSavingsBalance,
} from "@/lib/currency/characterFunds";
import { fetchSavingsLedgerForCharacter } from "@/lib/savings/ledger";
import { fetchLocLedgerForCharacter } from "@/lib/lineOfCredit/ledger";
import { buildLocSnapshot } from "@/lib/lineOfCredit/buildSnapshot";
import {
  estimateSavingsAccrualFromApy,
  savingsApyPercent,
  turnsUntilSavingsCredit,
} from "@/lib/currency/savingsInterest";
import { getGameState } from "@/lib/gameState";
import { getBankId } from "@/lib/centralBank/helpers";

interface RouteContext {
  params: Promise<{ code: string }>;
}

const DEFAULT_PRIME = 2.5;

export async function GET(request: Request, context: RouteContext) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId])
      return NextResponse.json(notFound("Country not found").toJson(), { status: 404 });

    if (!FOREX_ACTIVE_COUNTRIES.includes(countryId)) {
      return NextResponse.json(
        { error: "This central bank page does not support forex accounts." },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(request.url);
    const characterId = searchParams.get("characterId");
    const type = searchParams.get("type");
    if (!characterId || !ObjectId.isValid(characterId)) {
      return NextResponse.json({ error: "characterId is required" }, { status: 400 });
    }
    if (type !== "deposit" && type !== "loan") {
      return NextResponse.json({ error: "type must be deposit or loan" }, { status: 400 });
    }

    const db = await getDb();
    const nationalCurrency = COUNTRY_CURRENCY_MAP[countryId] as CurrencyCode;

    const character = await db.collection<Character>("characters").findOne({
      _id: new ObjectId(characterId),
    });
    if (!character || !character.userId) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const bankId = getBankId(countryId);
    const bank = await db.collection<CentralBank>("centralBanks").findOne({ _id: bankId });
    const primeRate = bank?.primeRate ?? DEFAULT_PRIME;
    const inflationRate = bank?.inflationHistory?.at(-1)?.rate ?? 0;
    const apyPercent = Math.round(savingsApyPercent(primeRate, inflationRate) * 100) / 100;

    const forexEnabled = await isForexEnabled();
    if (!forexEnabled) {
      return NextResponse.json({ error: "Forex is not enabled." }, { status: 404 });
    }

    const charSummary = {
      characterId: character._id.toHexString(),
      sequentialId: character.sequentialId,
      name: character.name,
      avatarUrl: character.avatarUrl,
    };

    if (type === "deposit") {
      const savingsBalance = getSavingsBalance(character, nationalCurrency, true);
      const liquidBalance = getPersonalBalance(character, nationalCurrency, true);
      const lifetimeInterestEarned = getLifetimeInterestEarnedInCurrency(
        character,
        nationalCurrency,
        true
      );
      const pendingInterest =
        character.currencyBalances?.pendingSavingsInterest?.[nationalCurrency] ?? 0;
      const accountOpened = character.savingsAccountsOpened?.[nationalCurrency] === true;

      const [ledger, gameState] = await Promise.all([
        fetchSavingsLedgerForCharacter(db, character._id, nationalCurrency, 100),
        getGameState(),
      ]);

      const turnsUntilCredit = turnsUntilSavingsCredit(gameState?.currentTurn ?? 0);
      const estimatedAccrualThisTurn =
        savingsBalance > 0
          ? estimateSavingsAccrualFromApy(savingsBalance, apyPercent, nationalCurrency)
          : 0;

      return NextResponse.json({
        kind: "deposit" as const,
        countryId,
        currencyCode: nationalCurrency,
        primeRate,
        apyPercent,
        character: charSummary,
        savingsBalance,
        liquidBalance,
        lifetimeInterestEarned,
        pendingInterest,
        estimatedAccrualThisTurn,
        turnsUntilCredit,
        accountOpened,
        ledger,
      });
    }

    const locEnabled = await isLineOfCreditEnabled();
    if (!locEnabled) {
      return NextResponse.json({ error: "Line of credit is not enabled." }, { status: 404 });
    }

    const loc = character.lineOfCredit;
    const principalFace = loc?.balances?.[nationalCurrency] ?? 0;
    const arrearsFace = loc?.arrears?.[nationalCurrency] ?? 0;
    if (principalFace <= 0 && arrearsFace <= 0) {
      return NextResponse.json(
        { error: "No line-of-credit balance in this currency for this character." },
        { status: 404 }
      );
    }

    const snapshot = await buildLocSnapshot(db, character);
    const ledger = await fetchLocLedgerForCharacter(db, character._id, 100, nationalCurrency);

    const spread = snapshot?.spreadPercentPoints ?? 0;
    const effectiveRatePercent = primeRate + spread;

    return NextResponse.json({
      kind: "loan" as const,
      countryId,
      currencyCode: nationalCurrency,
      primeRate,
      character: charSummary,
      snapshot,
      principalFace,
      arrearsFace,
      drawFrozen: loc?.drawFrozen === true,
      effectiveRatePercent,
      ledger,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
