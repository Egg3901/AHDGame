import type { Db, ObjectId } from "mongodb";
import { MONEY_MOVE_COLLECTION } from "@/lib/banking/moneyMove";
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
  resumeLoadedLocSettlement,
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

type CorpComposite = Pick<Corporation, "creditCompositeSnapshot">;

/**
 * The CEO credit snapshot for every character about to be serviced, in one
 * read instead of one `findOne({ ceoId, countryId })` each. This pass never
 * creates or deletes a corporation or writes its `ceoId`, `countryId` or
 * `creditCompositeSnapshot` (savings withdrawals from a private bank touch
 * only its charter), so reading them before the loop returns what the loop
 * would have read. Only an unambiguous answer is kept: a character with two
 * matching corporations, or any shape `findOne` would match differently
 * (array or non-ObjectId `ceoId`, non-string `countryId`), is left out and
 * the loop falls back to its own `findOne`, which picks as it always did.
 */
async function loadCeoComposites(
  db: Db,
  chars: Array<Pick<Character, "_id" | "countryId">>
): Promise<Map<string, CorpComposite | null>> {
  const out = new Map<string, CorpComposite | null>();
  if (chars.length === 0) return out;
  const corps = await db
    .collection<Corporation>("corporations")
    .find(
      { ceoId: { $in: chars.map((char) => char._id) } },
      { projection: { ceoId: 1, countryId: 1, creditCompositeSnapshot: 1 } }
    )
    .toArray();
  if (
    corps.some(
      (corp) =>
        typeof corp.ceoId !== "object" ||
        corp.ceoId === null ||
        Array.isArray(corp.ceoId) ||
        typeof (corp.ceoId as ObjectId).toHexString !== "function" ||
        typeof corp.countryId !== "string"
    )
  )
    return out;
  for (const char of chars) {
    if (typeof char.countryId !== "string") continue;
    const matches = corps.filter(
      (corp) =>
        (corp.ceoId as ObjectId).toHexString() === char._id.toHexString() &&
        corp.countryId === char.countryId
    );
    if (matches.length <= 1) out.set(char._id.toHexString(), matches[0] ?? null);
  }
  return out;
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
  // Which characters already have this turn's service record (a crashed or
  // retried pass), in one read: the per-character check ran before the
  // activity filter, so every credit-line holder paid a lookup that almost
  // always found nothing. settleLocPlan still claims each key itself.
  const startedKeys = new Set(
    (
      await db
        .collection<{ _id: string; kind: string }>(MONEY_MOVE_COLLECTION)
        .find(
          {
            _id: { $in: chars.map((char) => `loc:service:${turn}:${char._id}`) },
            kind: "line_of_credit",
          },
          { projection: { _id: 1 } }
        )
        .toArray()
    ).map((doc) => doc._id)
  );
  const composites = await loadCeoComposites(
    db,
    chars.filter(
      (char) =>
        !startedKeys.has(`loc:service:${turn}:${char._id}`) &&
        char.lineOfCredit &&
        hasLocActivity(char.lineOfCredit)
    )
  );
  for (const char of chars) {
    const serviceKey = `loc:service:${turn}:${char._id}`;
    const existing = startedKeys.has(serviceKey) ? await loadLocSettlement(db, serviceKey) : null;
    if (existing) {
      const resumed = await resumeLoadedLocSettlement(db, existing._id, existing);
      if (resumed.error) continue;
      charactersProcessed += Number(resumed.result.charactersProcessed ?? 0);
      paymentsInternal += Number(resumed.result.paymentsInternal ?? 0);
      continue;
    }
    const loc = char.lineOfCredit;
    if (!loc || !hasLocActivity(loc)) continue;

    const incomeInternal = currencyIncomeInternalByCharacterId.get(char._id.toString()) ?? 0;

    const home = getHomeCurrency(char);
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

    const corp = composites.has(char._id.toHexString())
      ? composites.get(char._id.toHexString())
      : await db
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
    // Either the batch read above or the per-key load found no record for
    // this key, and this pass writes no other character's key.
    const settled = await settleLocPlan(
      db,
      key,
      turn,
      {
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
        effect: {
          walletInc: {},
          reserves: [],
          ledger: [],
          transactions: [],
          flows: [],
          result: {},
        },
      },
      { knownAbsent: true }
    );
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
