// GET /api/country/[code]/central-bank/savings — National savings totals, prime/APY, character balances, ledger, chart history
// Auth: requireBasicAuth
// Errors: 401, 404

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import type { CentralBank, PortfolioHistory } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, FOREX_ACTIVE_COUNTRIES } from "@/lib/constants/currencies";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  getLifetimeInterestEarnedInCurrency,
  getPersonalBalance,
  getSavingsBalance,
} from "@/lib/currency/characterFunds";
import { sumSavingsInCurrency } from "@/lib/savings/nationalTotals";
import { fetchSavingsLedgerForCharacter } from "@/lib/savings/ledger";
import {
  estimateSavingsAccrualFromApy,
  savingsApyPercent,
  turnsUntilSavingsCredit,
} from "@/lib/currency/savingsInterest";
import { getGameState } from "@/lib/gameState";
import { getBankId } from "@/lib/centralBank/helpers";

const DEFAULT_PRIME = 2.5;

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Country not found" }, { status: 404 });
    }
    if (!FOREX_ACTIVE_COUNTRIES.includes(countryId)) {
      return NextResponse.json(
        { error: "High-yield savings are not available for this country." },
        { status: 404 }
      );
    }

    const db = await getDb();
    const [forexEnabled, character, bank] = await Promise.all([
      isForexEnabled(),
      getCharacterByUserId(db, auth.user.userId),
      db.collection<CentralBank>("centralBanks").findOne({ _id: getBankId(countryId) }),
    ]);

    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const nationalCurrency = COUNTRY_CURRENCY_MAP[countryId];
    const primeRate = bank?.primeRate ?? DEFAULT_PRIME;
    const inflationRate = bank?.inflationHistory?.at(-1)?.rate ?? 0;
    const apyPercent = Math.round(savingsApyPercent(primeRate, inflationRate) * 100) / 100;

    const [totalNationalSavings, ledger, history, gameState] = await Promise.all([
      sumSavingsInCurrency(db, nationalCurrency),
      fetchSavingsLedgerForCharacter(db, character._id, nationalCurrency, 75),
      // Most recent 500 turns; sort descending server-side then reverse for the
      // chart consumer (ascending) so long-lived characters don't see the chart
      // truncate to the oldest 500 snapshots.
      db
        .collection<PortfolioHistory>("portfolioHistory")
        .find({ characterId: character._id })
        .sort({ turn: -1 })
        .limit(500)
        .project({
          _id: 0,
          turn: 1,
          savingsCashValue: 1,
          exchangeRatesSnapshot: 1,
        })
        .toArray()
        .then((arr) => arr.reverse()),
      getGameState(),
    ]);

    const liquidBalance = getPersonalBalance(character, nationalCurrency, forexEnabled);
    const savingsBalance = getSavingsBalance(character, nationalCurrency, forexEnabled);
    const lifetimeInterestEarned = getLifetimeInterestEarnedInCurrency(
      character,
      nationalCurrency,
      forexEnabled
    );
    const pendingInterest =
      character.currencyBalances?.pendingSavingsInterest?.[nationalCurrency] ?? 0;
    const turnsUntilCredit = turnsUntilSavingsCredit(gameState?.currentTurn ?? 0);
    const estimatedAccrualThisTurn =
      forexEnabled && savingsBalance > 0
        ? estimateSavingsAccrualFromApy(savingsBalance, apyPercent, nationalCurrency)
        : 0;

    return NextResponse.json({
      countryId,
      currencyCode: nationalCurrency,
      primeRate,
      apyPercent,
      totalNationalSavings,
      liquidBalance,
      savingsBalance,
      lifetimeInterestEarned,
      pendingInterest,
      estimatedAccrualThisTurn,
      turnsUntilCredit,
      accountOpened: character.savingsAccountsOpened?.[nationalCurrency] === true,
      ledger,
      savingsHistory: history.map((h) => ({
        turn: h.turn,
        savingsCashValue: h.savingsCashValue ?? 0,
        exchangeRatesSnapshot: h.exchangeRatesSnapshot,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
