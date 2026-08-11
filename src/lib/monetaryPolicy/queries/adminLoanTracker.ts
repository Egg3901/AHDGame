import type { Db } from "mongodb";
import type { Character, CentralBank, Corporation } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  COUNTRY_CURRENCY_MAP,
  FOREX_ACTIVE_COUNTRIES,
  getCountryIdForCurrency,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { isLineOfCreditEnabled } from "@/lib/lineOfCredit/featureFlag";
import {
  loadExchangeRatesMap,
  computePlayerGrossNetLocInternal,
} from "@/lib/lineOfCredit/netWorth";
import {
  sumObligationInternal,
  computeLocInterestForTurn,
  LOC_PER_TURN_PAYMENT_RATE,
} from "@/lib/lineOfCredit/locMath";
import { estimatePerTurnCurrencyIncomeHomeFace } from "@/lib/lineOfCredit/currencyIncomeEstimate";
import { estimateTurnsToPayOffLocIdealized } from "@/lib/lineOfCredit/locTurnEstimate";
import { getPersonalBalance, getHomeCurrency } from "@/lib/currency/characterFunds";
import { roundSavingsAmount } from "@/lib/currency/savingsInterest";
import { buildLocSnapshot } from "@/lib/lineOfCredit/buildSnapshot";
import {
  computeLocBorrowerComposite,
  incomeScoreFromPerTurnCurrency,
  netWorthScoreFromInternal,
  spreadPercentPointsFromComposite,
} from "@/lib/lineOfCredit/creditMath";
import { getBankId } from "@/lib/centralBank/helpers";

const DEFAULT_PRIME = 2.5;

function paymentStatusLabel(drawFrozen: boolean, walletCoversScheduled: boolean) {
  if (drawFrozen) return "Distressed";
  if (!walletCoversScheduled) return "At risk";
  return "Current";
}

function walletCoversNextScheduledPay(
  char: Character,
  forexEnabled: boolean,
  currency: CurrencyCode,
  spreadPercentPoints: number,
  rates: Partial<Record<CurrencyCode, number>>,
  primeByCountryId: Map<string, number>
) {
  const loc = char.lineOfCredit;
  if (!loc) return true;
  const principal = loc.balances?.[currency] ?? 0;
  const arrears = loc.arrears?.[currency] ?? 0;
  if (principal <= 0 && arrears <= 0) return true;

  const prime = primeByCountryId.get(getBankId(getCountryIdForCurrency(currency))) ?? DEFAULT_PRIME;
  const interest = computeLocInterestForTurn(
    principal,
    arrears,
    prime,
    spreadPercentPoints,
    currency
  );
  const arrearsAfterInterest = roundSavingsAmount(arrears + interest, currency);
  const obligation = principal + arrearsAfterInterest;
  const scheduled = roundSavingsAmount(obligation * LOC_PER_TURN_PAYMENT_RATE, currency);
  const wallet = getPersonalBalance(char, currency, forexEnabled);
  return scheduled <= wallet + 1e-6;
}

async function computeSpreadForCharacter(
  db: Db,
  char: Character,
  rates: Partial<Record<CurrencyCode, number>>,
  primeByCountryId: Map<string, number>
) {
  const snapshot = await buildLocSnapshot(db, char);
  if (snapshot) return snapshot.spreadPercentPoints;

  const { grossInternal, locDebtInternal, netInternal } = await computePlayerGrossNetLocInternal(
    db,
    char,
    true,
    rates
  );
  const debtToAssetsRatio =
    grossInternal > 0 ? locDebtInternal / grossInternal : locDebtInternal > 0 ? 1 : 0;
  const netWorthScore = netWorthScoreFromInternal(netInternal);

  const incomeEstimate = await estimatePerTurnCurrencyIncomeHomeFace(db, char, rates);
  const incomeScore = incomeScoreFromPerTurnCurrency(incomeEstimate);

  const corporation = await db
    .collection<Corporation>("corporations")
    .findOne(
      { ceoId: char._id, countryId: char.countryId },
      { projection: { creditCompositeSnapshot: 1 } }
    );

  const homeCurrency = getHomeCurrency(char);
  const primeHome =
    primeByCountryId.get(getBankId(getCountryIdForCurrency(homeCurrency))) ?? DEFAULT_PRIME;
  const composite = computeLocBorrowerComposite({
    corpComposite: corporation?.creditCompositeSnapshot ?? null,
    incomeScore,
    netWorthScore,
    debtToAssetsRatio,
    homePrimePercent: primeHome,
  });
  return spreadPercentPointsFromComposite(composite);
}

export async function loadAdminLoanTracker(params: { db: Db; countryId: CountryId }) {
  const { db, countryId } = params;
  if (!COUNTRY_CONFIGS[countryId]) {
    return { ok: false as const, status: 404, error: "Country not found" };
  }
  if (!FOREX_ACTIVE_COUNTRIES.includes(countryId)) {
    return {
      ok: false as const,
      status: 404,
      error: "Line of credit is not available for this country.",
    };
  }

  const [forexEnabled, locEnabled] = await Promise.all([isForexEnabled(), isLineOfCreditEnabled()]);
  if (!forexEnabled || !locEnabled) {
    return { ok: false as const, status: 404, error: "Line of credit system is not active." };
  }

  const homeCurrency = COUNTRY_CURRENCY_MAP[countryId] as CurrencyCode;
  const rates = await loadExchangeRatesMap(db);
  const banks = await db
    .collection<CentralBank>("centralBanks")
    .find({})
    .project({ _id: 1, primeRate: 1 })
    .toArray();
  const primeByCountryId = new Map<string, number>();
  for (const bank of banks) {
    const id = typeof bank._id === "string" ? bank._id : String(bank._id);
    primeByCountryId.set(id, bank.primeRate ?? DEFAULT_PRIME);
  }

  const characters = await db
    .collection<Character>("characters")
    .find({
      userId: { $exists: true },
      $or: [
        { [`lineOfCredit.balances.${homeCurrency}`]: { $gt: 0 } },
        { [`lineOfCredit.arrears.${homeCurrency}`]: { $gt: 0 } },
      ],
    })
    .toArray();

  const borrowers = [];
  for (const character of characters) {
    const loc = character.lineOfCredit;
    if (!loc) continue;

    const snapshot = await buildLocSnapshot(db, character);
    const creditLimitInternal = snapshot?.perPlayerLimitInternal ?? 0;
    const outstandingInternal = sumObligationInternal(loc.balances ?? {}, loc.arrears ?? {}, rates);
    const utilization =
      creditLimitInternal > 0
        ? Math.min(1, outstandingInternal / creditLimitInternal)
        : outstandingInternal > 0
          ? 1
          : 0;

    const spreadPercentPoints =
      snapshot?.spreadPercentPoints ??
      (await computeSpreadForCharacter(db, character, rates, primeByCountryId));
    const walletOk = walletCoversNextScheduledPay(
      character,
      forexEnabled,
      homeCurrency,
      spreadPercentPoints,
      rates,
      primeByCountryId
    );
    const drawFrozen = loc.drawFrozen === true;
    const paymentStatus = paymentStatusLabel(drawFrozen, walletOk);
    const turnsToRepay = await estimateTurnsToPayOffLocIdealized({
      db,
      character,
      rates,
      primeByCountryId,
    });

    borrowers.push({
      characterId: character._id.toHexString(),
      sequentialId: character.sequentialId,
      name: character.name,
      avatarUrl: character.avatarUrl,
      creditLimitInternal,
      outstandingInternal,
      utilization,
      paymentStatus,
      turnsToRepay,
      drawFrozen,
    });
  }

  borrowers.sort((a, b) => b.outstandingInternal - a.outstandingInternal);

  return {
    ok: true as const,
    body: {
      countryId,
      currencyCode: homeCurrency,
      borrowers,
    },
  };
}
