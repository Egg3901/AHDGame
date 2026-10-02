import type { Db } from "mongodb";
import type { Character, CentralBank, Corporation } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { FOREX_ACTIVE_CURRENCIES, getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { isLineOfCreditEnabled } from "@/lib/lineOfCredit/featureFlag";
import {
  computeLocBorrowerComposite,
  incomeScoreFromPerTurnCurrency,
  netWorthScoreFromInternal,
  spreadPercentPointsFromComposite,
} from "@/lib/lineOfCredit/creditMath";
import { fromInternalUnits } from "@/lib/lineOfCredit/locMath";
import {
  computePlayerGrossNetLocInternal,
  loadExchangeRatesMap,
} from "@/lib/lineOfCredit/netWorth";
import {
  settleLocPlan,
  loadLocSettlement,
  resumeLocSettlement,
  recoverPendingLoc,
} from "@/lib/lineOfCredit/settlement";
import {
  getHomeCurrency,
  getPersonalBalance,
  getSavingsBalance,
} from "@/lib/currency/characterFunds";
import { loadBankingPolicy } from "@/lib/banking/policy";
import { savingsReadsAuthoritative } from "@/lib/banking/rules/policy";
import { loadCentralBankPricingAdjustment } from "@/lib/monetaryPolicy/centralBankPricing";
import { getGameState } from "@/lib/gameState";

const DEFAULT_PRIME = 2.5;

export function resolvePrimeForCurrency(
  primeByBankId: ReadonlyMap<string, number>,
  currency: CurrencyCode
): number {
  const bankId = getBankId(getCountryIdForCurrency(currency));
  return primeByBankId.get(bankId) ?? DEFAULT_PRIME;
}

function hasLocActivity(loc: NonNullable<Character["lineOfCredit"]>): boolean {
  const b = loc.balances ?? {};
  const a = loc.arrears ?? {};
  for (const c of FOREX_ACTIVE_CURRENCIES) {
    if ((b[c] ?? 0) > 0 || (a[c] ?? 0) > 0) return true;
  }
  return loc.drawFrozen === true;
}

export async function processLineOfCreditTurn(
  db: Db,
  turn: number,
  currencyIncomeInternalByCharacterId: Map<string, number>,
  // Still accepted for caller compatibility; auto-pay is now wallet-sized, not income-sized.
  _currencyIncomeFaceByCharacterId: Map<string, Map<CurrencyCode, number>>,
  forexEnabled: boolean
): Promise<{ charactersProcessed: number; paymentsInternal: number }> {
  if (!forexEnabled) {
    return { charactersProcessed: 0, paymentsInternal: 0 };
  }
  if (!(await isLineOfCreditEnabled())) {
    return { charactersProcessed: 0, paymentsInternal: 0 };
  }

  await recoverPendingLoc(db, turn);

  // One policy read per turn, like every other banking-aware pass: a flag
  // flipped mid-turn must not split this pass between two models.
  const bankingPolicy = await loadBankingPolicy(db);
  const gameState = await getGameState(db);
  const centralBankPricing = await loadCentralBankPricingAdjustment(db, turn);
  const rates = await loadExchangeRatesMap(db);
  const banks = await db
    .collection<CentralBank>("centralBanks")
    .find({})
    .project({ _id: 1, primeRate: 1 })
    .toArray();
  const primeByCountryId = new Map<string, number>();
  for (const b of banks) {
    const id = typeof b._id === "string" ? b._id : String(b._id);
    primeByCountryId.set(id, b.primeRate ?? DEFAULT_PRIME);
  }

  // Map is keyed by bank _id, so resolve through getBankId: the EUR anchor is
  // DE but its bank doc is the shared "ECB" — a raw countryId lookup would
  // silently fall back to DEFAULT_PRIME for every EUR line of credit.
  const resolvePrime = (currency: CurrencyCode): number => {
    return resolvePrimeForCurrency(primeByCountryId, currency);
  };

  const chars = await db
    .collection<Character>("characters")
    .find({ lineOfCredit: { $exists: true } })
    .toArray();

  let charactersProcessed = 0;
  let paymentsInternal = 0;
  let totalInterestAccruedInternal = 0;
  let newlyFrozen = 0;
  let newlyUnfrozen = 0;
  let distressedAfterTurn = 0;
  const now = new Date();
  for (const char of chars) {
    const existing = await loadLocSettlement(db, `loc:service:${turn}:${char._id}`);
    if (existing) {
      const resumed = await resumeLocSettlement(db, existing._id);
      if (resumed.error) continue;
      const stored = await loadLocSettlement(db, existing._id);
      charactersProcessed += Number(stored!.locSettlement.effect.result.charactersProcessed ?? 0);
      paymentsInternal += Number(stored!.locSettlement.effect.result.paymentsInternal ?? 0);
      continue;
    }
    const loc = char.lineOfCredit;
    if (!loc || !hasLocActivity(loc)) continue;

    const incomeInternal = currencyIncomeInternalByCharacterId.get(char._id.toString()) ?? 0;

    const home = getHomeCurrency(char, gameState?.preset);
    const rateHome = rates[home] ?? 1;
    const incomeHomeFace = fromInternalUnits(incomeInternal, rateHome);
    const incomeScore = incomeScoreFromPerTurnCurrency(incomeHomeFace);

    const {
      grossInternal,
      locDebtInternal: locDebtForScore,
      netInternal,
    } = await computePlayerGrossNetLocInternal(db, char, true, rates);
    const debtToAssetsRatio =
      grossInternal > 0 ? locDebtForScore / grossInternal : locDebtForScore > 0 ? 1 : 0;
    const nwScore = netWorthScoreFromInternal(netInternal);

    const corp = await db
      .collection<Corporation>("corporations")
      .findOne(
        { ceoId: char._id, countryId: char.countryId },
        { projection: { creditCompositeSnapshot: 1 } }
      );

    const primeHome = resolvePrime(home);

    const composite = computeLocBorrowerComposite({
      corpComposite: corp?.creditCompositeSnapshot ?? null,
      incomeScore,
      netWorthScore: nwScore,
      debtToAssetsRatio,
      homePrimePercent: primeHome,
    });
    const spread = spreadPercentPointsFromComposite(composite);

    const key = `loc:service:${turn}:${char._id}`;
    const personal = Object.fromEntries(
      FOREX_ACTIVE_CURRENCIES.map((c) => [c, getPersonalBalance(char, c, forexEnabled)])
    );
    const savings = Object.fromEntries(
      FOREX_ACTIVE_CURRENCIES.map((c) => [c, getSavingsBalance(char, c, forexEnabled)])
    );
    const settled = await settleLocPlan(db, key, turn, {
      characterId: char._id,
      expectedLoc: loc,
      expectedRevision:
        (char as Character & { lineOfCreditRevision?: number }).lineOfCreditRevision ?? null,
      request: { operation: "service", turn },
      createdAt: now,
      service: {
        input: {
          loc,
          personal,
          savings,
          rates,
          prime: Object.fromEntries(FOREX_ACTIVE_CURRENCIES.map((c) => [c, resolvePrime(c)])),
          spread,
          centralBankSpread: centralBankPricing.spreadHikePercentPoints,
          incomeInternal,
        },
        authoritative: FOREX_ACTIVE_CURRENCIES.filter((c) =>
          savingsReadsAuthoritative(bankingPolicy, c)
        ),
        home,
        characterName: char.name,
      },
      effect: { walletInc: {}, reserves: [], ledger: [], transactions: [], flows: [], result: {} },
    });
    if (settled.error) continue;
    charactersProcessed += Number(settled.result.charactersProcessed ?? 0);
    paymentsInternal += Number(settled.result.paymentsInternal ?? 0);
    totalInterestAccruedInternal += Number(settled.result.interestAccruedInternal ?? 0);
    if (settled.result.distress) distressedAfterTurn += 1;
    if (settled.result.distress && !loc.drawFrozen) newlyFrozen += 1;
    if (!settled.result.distress && loc.drawFrozen) newlyUnfrozen += 1;
  }

  if (charactersProcessed > 0) {
    console.log(
      `[loc-turn] turn ${turn} summary: processed=${charactersProcessed} ` +
        `interestAccrued=${formatNumberForLog(totalInterestAccruedInternal)} internal ` +
        `paymentsApplied=${formatNumberForLog(paymentsInternal)} internal ` +
        `distressedPostTurn=${distressedAfterTurn} ` +
        `transitions{frozen=+${newlyFrozen} unfrozen=+${newlyUnfrozen}}`
    );
  }

  return { charactersProcessed, paymentsInternal };
}

function formatNumberForLog(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
}
