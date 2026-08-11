/**
 * Estimate how many game turns remain until LOC obligation reaches ~zero,
 * assuming the player's wallet always covers scheduled auto-pay (idealized).
 * Mirrors {@link processLineOfCreditTurn} math for interest accrual and payments.
 */

import type { CurrencyCode } from "@/lib/constants/currencies";
import { FOREX_ACTIVE_CURRENCIES } from "@/lib/constants/currencies";
import type { Character, Corporation } from "@/lib/db/types";
import type { Db } from "mongodb";
import {
  computeLocBorrowerComposite,
  incomeScoreFromPerTurnCurrency,
  netWorthScoreFromInternal,
  spreadPercentPointsFromComposite,
} from "@/lib/lineOfCredit/creditMath";
import {
  computeLocInterestForTurn,
  LOC_PER_TURN_PAYMENT_RATE,
  sumObligationInternal,
} from "@/lib/lineOfCredit/locMath";
import { computePlayerGrossNetLocInternal } from "@/lib/lineOfCredit/netWorth";
import { estimatePerTurnCurrencyIncomeHomeFace } from "@/lib/lineOfCredit/currencyIncomeEstimate";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import { roundSavingsAmount } from "@/lib/currency/savingsInterest";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";

const DEFAULT_PRIME = 2.5;
const MAX_SIM_TURNS = 50_000;
const PAID_OFF_EPS = 1e-4;

export interface LocTurnEstimateInput {
  db: Db;
  character: Character;
  rates: Partial<Record<CurrencyCode, number>>;
  primeByCountryId: Map<string, number>;
}

/**
 * Returns null if no obligation in any forex currency.
 */
export async function estimateTurnsToPayOffLocIdealized(
  input: LocTurnEstimateInput
): Promise<number | null> {
  const { db, character, rates, primeByCountryId } = input;
  const loc = character.lineOfCredit;
  if (!loc) return null;

  const balances: Partial<Record<CurrencyCode, number>> = { ...(loc.balances ?? {}) };
  const arrears: Partial<Record<CurrencyCode, number>> = { ...(loc.arrears ?? {}) };

  const resolvePrime = (currency: CurrencyCode): number => {
    const cid = getCountryIdForCurrency(currency);
    return primeByCountryId.get(cid) ?? DEFAULT_PRIME;
  };

  const home = getHomeCurrency(character);

  const {
    grossInternal,
    locDebtInternal: locDebtForScore,
    netInternal,
  } = await computePlayerGrossNetLocInternal(db, character, true, rates);
  const debtToAssetsRatio =
    grossInternal > 0 ? locDebtForScore / grossInternal : locDebtForScore > 0 ? 1 : 0;
  const nwScore = netWorthScoreFromInternal(netInternal);

  const incomeGuess = await estimatePerTurnCurrencyIncomeHomeFace(db, character, rates);
  const incomeScore = incomeScoreFromPerTurnCurrency(incomeGuess);

  const corp = await db
    .collection<Corporation>("corporations")
    .findOne(
      { ceoId: character._id, countryId: character.countryId },
      { projection: { creditCompositeSnapshot: 1 } }
    );

  const homeCid = getCountryIdForCurrency(home);
  const primeHome = primeByCountryId.get(homeCid) ?? DEFAULT_PRIME;

  const composite = computeLocBorrowerComposite({
    corpComposite: corp?.creditCompositeSnapshot ?? null,
    incomeScore,
    netWorthScore: nwScore,
    debtToAssetsRatio,
    homePrimePercent: primeHome,
  });
  const spread = spreadPercentPointsFromComposite(composite);

  let turns = 0;
  while (turns < MAX_SIM_TURNS) {
    let obligationInternal = sumObligationInternal(balances, arrears, rates);
    if (obligationInternal <= PAID_OFF_EPS) return turns;

    // 1. Accrue interest per currency onto arrears (same as turn processor).
    for (const c of FOREX_ACTIVE_CURRENCIES) {
      const P = balances[c] ?? 0;
      const A = arrears[c] ?? 0;
      if (P <= 0 && A <= 0) continue;
      const prime = resolvePrime(c);
      const int = computeLocInterestForTurn(P, A, prime, spread, c);
      if (int <= 0) continue;
      arrears[c] = roundSavingsAmount((arrears[c] ?? 0) + int, c);
    }

    obligationInternal = sumObligationInternal(balances, arrears, rates);
    if (obligationInternal <= PAID_OFF_EPS) return turns;

    // 2. Full scheduled payment each currency (wallet assumed sufficient).
    for (const c of FOREX_ACTIVE_CURRENCIES) {
      const obligation = (balances[c] ?? 0) + (arrears[c] ?? 0);
      if (obligation <= 0) continue;
      const scheduled = roundSavingsAmount(obligation * LOC_PER_TURN_PAYMENT_RATE, c);
      if (scheduled <= 0) continue;
      const pay = scheduled;
      const Acur = arrears[c] ?? 0;
      const interestPart = roundSavingsAmount(Math.min(pay, Acur), c);
      const principalPart = roundSavingsAmount(Math.max(0, pay - interestPart), c);
      arrears[c] = roundSavingsAmount(Math.max(0, Acur - interestPart), c);
      balances[c] = roundSavingsAmount(Math.max(0, (balances[c] ?? 0) - principalPart), c);
    }

    // Drop zero keys for tidy obligation sum
    for (const c of FOREX_ACTIVE_CURRENCIES) {
      const p = balances[c] ?? 0;
      const a = arrears[c] ?? 0;
      if (p <= 0) delete balances[c];
      else balances[c] = p;
      if (a <= 0) delete arrears[c];
      else arrears[c] = a;
    }

    turns += 1;
    obligationInternal = sumObligationInternal(balances, arrears, rates);
    if (obligationInternal <= PAID_OFF_EPS) return turns;
  }

  return null;
}
