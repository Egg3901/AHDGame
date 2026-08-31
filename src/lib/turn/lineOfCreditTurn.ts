import type { Db } from "mongodb";
import type { Character, CentralBank, Corporation } from "@/lib/db/types";
import type { LocPaymentMode } from "@/lib/db/types/character";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { FOREX_ACTIVE_CURRENCIES, getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { isLineOfCreditEnabled } from "@/lib/lineOfCredit/featureFlag";
import {
  computeLocBorrowerComposite,
  incomeScoreFromPerTurnCurrency,
  netWorthScoreFromInternal,
  spreadPercentPointsFromComposite,
} from "@/lib/lineOfCredit/creditMath";
import {
  LOC_IO_SURCHARGE_PERCENT_POINTS,
  computeLocInterestForTurn,
  computeLocScheduledPaymentFace,
  fromInternalUnits,
  toInternalUnits,
} from "@/lib/lineOfCredit/locMath";
import {
  computePlayerGrossNetLocInternal,
  loadExchangeRatesMap,
} from "@/lib/lineOfCredit/netWorth";
import { insertLocLedgerEntry } from "@/lib/lineOfCredit/ledger";
import {
  buildPersonalBalanceInc,
  buildSavingsBalanceInc,
  getHomeCurrency,
  getPersonalBalance,
  getSavingsBalance,
} from "@/lib/currency/characterFunds";
import { roundSavingsAmount } from "@/lib/currency/savingsInterest";
import { loadTxThresholds, emitTxBulk } from "@/lib/financialTxLog/emit";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";

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

function mergeIncFragments(fragments: Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of fragments) {
    for (const [k, v] of Object.entries(f)) {
      out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}

/**
 * Accrue LOC interest, auto-pay from this turn’s personal currency income (CEO salary + dividends),
 * freeze draws when interest due exceeds that income. Gated by lineOfCreditEnabled.
 * Runs after corporation turn (same tick as fund generation) so personal balances include payouts.
 */
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
  // Accumulate arrears reductions per currency to credit central bank reserves once per turn.
  const bankReserveInc = new Map<string, number>(); // countryId → face-value amount
  const txLocEntries: Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">[] = [];
  const thresholds = await loadTxThresholds(db);

  for (const char of chars) {
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

    const balances: Partial<Record<CurrencyCode, number>> = { ...(loc.balances ?? {}) };
    const arrears: Partial<Record<CurrencyCode, number>> = { ...(loc.arrears ?? {}) };
    let characterInterestAccruedInternal = 0;

    // Capture pre-turn obligation snapshot for logging.
    const preObligationByCurrency: Partial<Record<CurrencyCode, number>> = {};
    for (const c of FOREX_ACTIVE_CURRENCIES) {
      const obligation = (balances[c] ?? 0) + (arrears[c] ?? 0);
      if (obligation > 0) preObligationByCurrency[c] = obligation;
    }

    // 1. Accrue interest per currency onto arrears.
    const interestAccruals: Partial<Record<CurrencyCode, number>> = {};
    const modeByCurrency: Partial<Record<CurrencyCode, LocPaymentMode>> = {};
    const ioSurchargeByCurrency: Partial<Record<CurrencyCode, number>> = {};
    for (const c of FOREX_ACTIVE_CURRENCIES) {
      const P = balances[c] ?? 0;
      const A = arrears[c] ?? 0;
      if (P <= 0 && A <= 0) continue;
      const mode: LocPaymentMode = loc.paymentMode?.[c] ?? "pi";
      modeByCurrency[c] = mode;
      const ioSurcharge = mode === "io" ? LOC_IO_SURCHARGE_PERCENT_POINTS : 0;
      if (ioSurcharge > 0) ioSurchargeByCurrency[c] = ioSurcharge;
      const prime = resolvePrime(c);
      const int = computeLocInterestForTurn(P, A, prime, spread + ioSurcharge, c);
      if (int <= 0) continue;
      interestAccruals[c] = int;
      arrears[c] = roundSavingsAmount((arrears[c] ?? 0) + int, c);
      const rate = rates[c];
      if (rate && rate > 0) characterInterestAccruedInternal += toInternalUnits(int, rate);
    }

    // 2. Scheduled auto-payment = LOC_PER_TURN_PAYMENT_RATE × (P+A) post-accrual.
    //    The loan currency wallet is used first. If it falls short, other personal
    //    currency balances are auto-converted at market rates to cover the gap.
    //    Only a remaining shortfall after cross-conversion triggers distress/freeze.
    const payments: Partial<Record<CurrencyCode, number>> = {};
    const walletPayments: Partial<Record<CurrencyCode, number>> = {};
    const interestPortions: Partial<Record<CurrencyCode, number>> = {};
    const principalPortions: Partial<Record<CurrencyCode, number>> = {};
    // crossConverted[targetC][sourceC] = face-value of sourceC used to fund targetC payment
    const crossConverted: Partial<Record<CurrencyCode, Partial<Record<CurrencyCode, number>>>> = {};
    let appliedInternal = 0;
    let shortfallAny = false;
    // Total scheduled payment in internal units — used to check if income covers
    // it even when the wallet is empty (e.g. because income was garnished).
    let scheduledInternalTotal = 0;

    // Track available balances (personal wallet + savings) per currency so
    // multi-currency loans don't double-spend. Personal is drained first;
    // savings is overflow. Campaign funds are legally separate and never touched.
    const initialPersonalBalance: Partial<Record<CurrencyCode, number>> = {};
    const availableBalance: Partial<Record<CurrencyCode, number>> = {};
    for (const curr of FOREX_ACTIVE_CURRENCIES) {
      const personal = Math.max(0, getPersonalBalance(char, curr, forexEnabled));
      const savings = Math.max(0, getSavingsBalance(char, curr, forexEnabled));
      initialPersonalBalance[curr] = personal;
      availableBalance[curr] = personal + savings;
    }

    for (const c of FOREX_ACTIVE_CURRENCIES) {
      const P = balances[c] ?? 0;
      const A = arrears[c] ?? 0;
      const obligation = P + A;
      if (obligation <= 0) continue;
      const mode: LocPaymentMode = modeByCurrency[c] ?? loc.paymentMode?.[c] ?? "pi";
      const scheduled = roundSavingsAmount(computeLocScheduledPaymentFace(mode, P, A), c);
      if (scheduled <= 0) continue;

      const cRate = rates[c];
      if (cRate && cRate > 0) scheduledInternalTotal += toInternalUnits(scheduled, cRate);

      const walletC = availableBalance[c] ?? 0;
      let pay = Math.min(scheduled, walletC);
      const walletPay = pay;

      // If the loan-currency wallet falls short, convert from other currencies.
      if (pay < scheduled - 1e-6) {
        const loanRate = rates[c];
        if (loanRate && loanRate > 0) {
          let remainingShortfall = roundSavingsAmount(scheduled - pay, c);
          // Prefer the currencies with the largest available internal value.
          const candidates = FOREX_ACTIVE_CURRENCIES.filter(
            (other) => other !== c && (availableBalance[other] ?? 0) > 1e-9
          )
            .map((other) => ({ currency: other, rate: rates[other] ?? 0 }))
            .filter((x) => x.rate > 0)
            .sort(
              (a, b) =>
                (availableBalance[b.currency] ?? 0) * b.rate -
                (availableBalance[a.currency] ?? 0) * a.rate
            );

          const convertedSources: Partial<Record<CurrencyCode, number>> = {};
          for (const { currency: other, rate: otherRate } of candidates) {
            if (remainingShortfall <= 1e-9) break;
            const otherAvailable = availableBalance[other] ?? 0;
            // How much of `other` buys `remainingShortfall` of `c` at market rates?
            const otherNeeded = roundSavingsAmount(
              (remainingShortfall * loanRate) / otherRate,
              other
            );
            const otherUsed = Math.min(otherNeeded, otherAvailable);
            if (otherUsed <= 0) continue;
            const loanGained = roundSavingsAmount((otherUsed * otherRate) / loanRate, c);
            if (loanGained <= 0) continue;
            convertedSources[other] = (convertedSources[other] ?? 0) + otherUsed;
            availableBalance[other] = otherAvailable - otherUsed;
            pay = Math.min(scheduled, roundSavingsAmount(pay + loanGained, c));
            remainingShortfall = roundSavingsAmount(Math.max(0, scheduled - pay), c);
          }
          if (Object.keys(convertedSources).length > 0) crossConverted[c] = convertedSources;
        }
      }

      if (pay < scheduled - 1e-6) shortfallAny = true;
      availableBalance[c] = Math.max(0, walletC - walletPay);
      if (pay <= 0) continue;

      // Interest portion settles arrears first; remainder reduces principal.
      const interestPart = roundSavingsAmount(Math.min(pay, A), c);
      const principalPart = roundSavingsAmount(Math.max(0, pay - interestPart), c);
      arrears[c] = roundSavingsAmount(Math.max(0, A - interestPart), c);
      balances[c] = roundSavingsAmount(Math.max(0, (balances[c] ?? 0) - principalPart), c);
      payments[c] = roundSavingsAmount(interestPart + principalPart, c);
      walletPayments[c] = walletPay;
      interestPortions[c] = interestPart;
      principalPortions[c] = principalPart;
      const rate = rates[c];
      if (rate && rate > 0) {
        appliedInternal += toInternalUnits(payments[c] ?? 0, rate);
      }
    }

    // A frozen borrower whose income would cover the scheduled payment should be
    // unfrozen. Their wallet is empty because income was garnished this turn before
    // it could reach them; once unfrozen the garnishment stops and auto-pay runs
    // from wallet normally. Without this check, garnished borrowers can never
    // escape distress even when their income dwarfs the scheduled payment.
    const incomeCoversScheduled =
      loc.drawFrozen &&
      scheduledInternalTotal > 0 &&
      incomeInternal >= scheduledInternalTotal - 1e-6;
    const distress = shortfallAny && !incomeCoversScheduled;
    const drawFrozen = distress;

    // Clear empty currency keys so the LOC document stays tidy.
    const newP: Partial<Record<CurrencyCode, number>> = {};
    const newA: Partial<Record<CurrencyCode, number>> = {};
    for (const c of FOREX_ACTIVE_CURRENCIES) {
      const p = balances[c] ?? 0;
      const a = arrears[c] ?? 0;
      if (p > 0) newP[c] = p;
      if (a > 0) newA[c] = a;
    }

    // 3. Deduct payments: tally total consumed per currency, then drain personal
    //    wallet first and savings as overflow. Campaign funds are never touched.
    const totalDeductByCurrency: Partial<Record<CurrencyCode, number>> = {};
    for (const c of FOREX_ACTIVE_CURRENCIES) {
      const direct = walletPayments[c] ?? 0;
      if (direct > 0) totalDeductByCurrency[c] = (totalDeductByCurrency[c] ?? 0) + direct;
    }
    for (const sources of Object.values(crossConverted)) {
      for (const [sourceC, amount] of Object.entries(sources ?? {})) {
        if ((amount ?? 0) > 0)
          totalDeductByCurrency[sourceC as CurrencyCode] =
            (totalDeductByCurrency[sourceC as CurrencyCode] ?? 0) + (amount as number);
      }
    }
    const deductIncs: Record<string, number>[] = [];
    for (const [c, totalDeduct] of Object.entries(totalDeductByCurrency) as [
      CurrencyCode,
      number,
    ][]) {
      const fromPersonal = Math.min(totalDeduct, initialPersonalBalance[c] ?? 0);
      const fromSavings = roundSavingsAmount(Math.max(0, totalDeduct - fromPersonal), c);
      if (fromPersonal > 0)
        deductIncs.push(buildPersonalBalanceInc(-fromPersonal, c, forexEnabled));
      if (fromSavings > 0) deductIncs.push(buildSavingsBalanceInc(-fromSavings, c, forexEnabled));
    }
    const personalDeduct = mergeIncFragments(deductIncs);

    const baseSet = {
      lineOfCredit: {
        ...loc,
        balances: newP,
        arrears: newA,
        drawFrozen,
        accountsOpened: loc.accountsOpened,
      },
      updatedAt: now,
    };
    const locWriteFilter: Record<string, unknown> = {
      _id: char._id,
      lineOfCredit: loc,
    };
    for (const [path, delta] of Object.entries(personalDeduct)) {
      if (delta < 0) locWriteFilter[path] = { $gte: -delta };
    }
    // Compare-and-swap the exact LOC snapshot used for these calculations. A
    // draw or repayment that commits after the turn read changes this embedded
    // document, so the stale turn write is skipped instead of erasing debt or a
    // repayment while still moving wallet cash.
    const locUpdate = await db
      .collection<Character>("characters")
      .updateOne(
        locWriteFilter,
        Object.keys(personalDeduct).length > 0
          ? { $set: baseSet, $inc: personalDeduct }
          : { $set: baseSet }
      );
    if (locUpdate.matchedCount === 0) {
      console.warn(
        `[line-of-credit] skipped stale turn write for character ${char._id.toString()} on turn ${turn}`
      );
      continue;
    }

    totalInterestAccruedInternal += characterInterestAccruedInternal;
    if (distress) distressedAfterTurn += 1;
    if (distress && !loc.drawFrozen) newlyFrozen += 1;
    if (!distress && loc.drawFrozen) newlyUnfrozen += 1;

    // Only committed interest payments credit the lending bank's reserves.
    // Principal is destroyed symmetrically to how `draw` created it.
    for (const c of FOREX_ACTIVE_CURRENCIES) {
      const interest = interestPortions[c] ?? 0;
      if (interest <= 0) continue;
      const cid = getCountryIdForCurrency(c) as string;
      bankReserveInc.set(cid, (bankReserveInc.get(cid) ?? 0) + interest);
    }

    // 4. Ledger: one interest-accrual row per currency (as today), plus one
    //    auto_payment row per currency that actually paid, carrying the
    //    principal/interest split.
    for (const c of FOREX_ACTIVE_CURRENCIES) {
      const add = interestAccruals[c];
      if (add === undefined || add <= 0) continue;
      await insertLocLedgerEntry(db, {
        characterId: char._id,
        currencyCode: c,
        type: "interest",
        amount: add,
        balanceAfter: newP[c] ?? 0,
        arrearsAfter: newA[c] ?? 0,
        turn,
        meta: {
          primePercent: resolvePrime(c),
          spreadPercentPoints: spread,
          distress,
          paymentMode: modeByCurrency[c],
          ...(ioSurchargeByCurrency[c] ? { ioSurchargePoints: ioSurchargeByCurrency[c] } : {}),
        },
      });
    }

    for (const c of FOREX_ACTIVE_CURRENCIES) {
      const pay = payments[c] ?? 0;
      if (pay <= 0) continue;
      await insertLocLedgerEntry(db, {
        characterId: char._id,
        currencyCode: c,
        type: "auto_payment",
        amount: pay,
        interestPortion: interestPortions[c] ?? 0,
        principalPortion: principalPortions[c] ?? 0,
        balanceAfter: newP[c] ?? 0,
        arrearsAfter: newA[c] ?? 0,
        turn,
        meta: {
          incomeInternalApplied: appliedInternal,
          distress,
          ...(crossConverted[c] ? { crossConverted: crossConverted[c] } : {}),
          paymentMode: modeByCurrency[c],
          ...(ioSurchargeByCurrency[c] ? { ioSurchargePoints: ioSurchargeByCurrency[c] } : {}),
        },
      });
    }

    if (distress && !loc.drawFrozen) {
      await insertLocLedgerEntry(db, {
        characterId: char._id,
        currencyCode: home,
        type: "freeze",
        amount: 0,
        balanceAfter: newP[home] ?? 0,
        arrearsAfter: newA[home] ?? 0,
        turn,
        meta: { distress: true },
      });
    } else if (!distress && loc.drawFrozen) {
      await insertLocLedgerEntry(db, {
        characterId: char._id,
        currencyCode: home,
        type: "unfreeze",
        amount: 0,
        balanceAfter: newP[home] ?? 0,
        arrearsAfter: newA[home] ?? 0,
        turn,
      });
    }

    // Collect tx log entries for this character (emitted in bulk after loop).
    for (const c of FOREX_ACTIVE_CURRENCIES) {
      const interest = interestAccruals[c];
      if (interest && interest > 0) {
        txLocEntries.push({
          type: "loc_interest",
          turn,
          createdAt: now,
          subjectType: "character",
          subjectId: char._id,
          subjectName: char.name,
          amount: -interest,
          currencyCode: c,
          meta: { primePercent: resolvePrime(c), spreadPercentPoints: spread, distress },
        });
      }
      const pay = payments[c] ?? 0;
      if (pay > 0) {
        txLocEntries.push({
          type: "loc_repay",
          turn,
          createdAt: now,
          subjectType: "character",
          subjectId: char._id,
          subjectName: char.name,
          amount: -pay,
          currencyCode: c,
          meta: {
            interestPortion: interestPortions[c] ?? 0,
            principalPortion: principalPortions[c] ?? 0,
            distress,
          },
        });
      }
    }

    charactersProcessed += 1;
    paymentsInternal += appliedInternal;

    // Per-character LOC turn log: pre→post obligation, interest, scheduled vs paid,
    // any shortfall, and freeze/unfreeze transitions. Only emit when there is
    // material activity — pure unfreeze ticks (no obligation) stay quiet.
    const hadActivity =
      Object.keys(interestAccruals).length > 0 ||
      Object.values(payments).some((v) => (v ?? 0) > 0) ||
      shortfallAny ||
      distress !== loc.drawFrozen;
    if (hadActivity) {
      const interestStr = Object.entries(interestAccruals)
        .map(([c, v]) => `${c} +${formatNumberForLog(v as number)}`)
        .join(", ");
      const paidStr = Object.entries(payments)
        .filter(([, v]) => (v ?? 0) > 0)
        .map(
          ([c, v]) =>
            `${c} -${formatNumberForLog(v as number)} (i=${formatNumberForLog(
              interestPortions[c as CurrencyCode] ?? 0
            )}, p=${formatNumberForLog(principalPortions[c as CurrencyCode] ?? 0)})`
        )
        .join(", ");
      const postStr = Object.entries({ ...newP, ...newA }).length
        ? FOREX_ACTIVE_CURRENCIES.map((c) => {
            const total = (newP[c] ?? 0) + (newA[c] ?? 0);
            return total > 0 ? `${c} ${formatNumberForLog(total)}` : null;
          })
            .filter(Boolean)
            .join(", ")
        : "(paid off)";
      const transition =
        distress && !loc.drawFrozen
          ? " FROZEN"
          : !distress && loc.drawFrozen
            ? " UNFROZEN"
            : distress
              ? " (still distressed)"
              : "";
      console.log(
        `[loc-turn] turn ${turn} ${char.name} (${char.countryId}): ` +
          `interest{${interestStr || "none"}} paid{${paidStr || "none"}} ` +
          `post{${postStr}}${shortfallAny ? " SHORTFALL" : ""}${transition}`
      );
    }
  }

  if (txLocEntries.length > 0) {
    void emitTxBulk(db, txLocEntries, thresholds);
  }

  // Bulk-update bank reserves with accumulated interest payments. getBankId:
  // EUR interest accumulates under the anchor country "DE", but the doc's _id
  // is "ECB" — the raw-cid update was a silent no-op that destroyed the revenue.
  for (const [cid, inc] of bankReserveInc) {
    if (inc > 0) {
      await db
        .collection<CentralBank>("centralBanks")
        .updateOne({ _id: getBankId(cid as CountryId) }, { $inc: { reserveBalance: inc } });
    }
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
