// Garnish income at source for distressed LOC borrowers.
//
// When a character has `lineOfCredit.drawFrozen === true` (i.e., they have
// shortfalled at least one auto-payment and draws are frozen), this turn's
// CEO salary, dividend, or bond-coupon income never lands in their wallet —
// it is converted to internal units at the spot rate and applied directly to
// their LOC obligation (arrears first, then principal, cross-currency).
//
// Hooked from `processCorporationTurn` (CEO salary + dividend payouts) and
// `processBondTurn` (coupon payouts) BEFORE the personal-balance bulkWrite,
// so the redirected portion never enters circulation. The existing
// `processLineOfCreditTurn` auto-pay step still runs afterwards for any
// non-distressed borrowers and for distressed borrowers' wallet-side payments
// (which will be zero in the garnished currencies).

import { ObjectId, type Db } from "mongodb";
import type { Character, CentralBank } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { FOREX_ACTIVE_CURRENCIES, getCountryIdForCurrency } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { getBankId } from "@/lib/centralBank/helpers";
import type { LocGarnishmentSource } from "@/lib/db/types/locLedger";
import { isLineOfCreditEnabled } from "@/lib/lineOfCredit/featureFlag";
import {
  allocateInternalPaymentToLoc,
  fromInternalUnits,
  toInternalUnits,
} from "@/lib/lineOfCredit/locMath";
import { loadExchangeRatesMap } from "@/lib/lineOfCredit/netWorth";
import { insertLocLedgerEntry } from "@/lib/lineOfCredit/ledger";
import { roundSavingsAmount } from "@/lib/currency/savingsInterest";
import { loadTxThresholds, emitTxBulk } from "@/lib/financialTxLog/emit";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";

export interface GarnishmentResult {
  borrowersGarnished: number;
  /** Total internal units redirected to LOC across all garnished borrowers. */
  totalInternalGarnished: number;
}

/**
 * Garnish in-flight income for distressed LOC borrowers. Mutates `charPayments`
 * in place: garnished currency entries are deleted (or reduced when income
 * exceeds the obligation) so the caller's subsequent `buildPersonalBalanceBulkOp`
 * loop skips them.
 *
 * Safe to call when LOC is disabled (returns zero result without touching DB or
 * the payment map).
 */
export async function garnishLocFromIncome(
  db: Db,
  charPayments: Map<string, Map<CurrencyCode, number>>,
  turn: number,
  source: LocGarnishmentSource,
  options?: {
    /**
     * Additional payment maps that should be scaled identically to
     * `charPayments` when a borrower is garnished. Use for downstream phases
     * that iterate the original payments (e.g. dividend forex auto-convert):
     * if a dividend entry was redirected to LOC, its forex trade must not
     * fire.
     */
    auxiliaryPayments?: Map<string, Map<CurrencyCode, number>>[];
  }
): Promise<GarnishmentResult> {
  if (charPayments.size === 0) {
    return { borrowersGarnished: 0, totalInternalGarnished: 0 };
  }
  if (!(await isLineOfCreditEnabled())) {
    return { borrowersGarnished: 0, totalInternalGarnished: 0 };
  }

  const rates = await loadExchangeRatesMap(db);

  // Only consider characters who are receiving income this turn AND are
  // distressed. The `drawFrozen` filter intentionally excludes healthy
  // borrowers — auto-pay handles them via the wallet path.
  const candidateObjectIds = [...charPayments.keys()]
    .filter((id) => !id.startsWith("imperial:") && ObjectId.isValid(id))
    .map((id) => new ObjectId(id));
  if (candidateObjectIds.length === 0) {
    return { borrowersGarnished: 0, totalInternalGarnished: 0 };
  }

  const distressed = await db
    .collection<Character>("characters")
    .find(
      {
        _id: { $in: candidateObjectIds },
        "lineOfCredit.drawFrozen": true,
      },
      { projection: { _id: 1, name: 1, countryId: 1, lineOfCredit: 1 } }
    )
    .toArray();

  if (distressed.length === 0) {
    return { borrowersGarnished: 0, totalInternalGarnished: 0 };
  }

  const now = new Date();
  const txEntries: Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">[] = [];
  const thresholds = await loadTxThresholds(db);
  const bankReserveInc = new Map<string, number>(); // countryId → face amount (currency of that country)
  let borrowersGarnished = 0;
  let totalInternalGarnished = 0;

  const pendingLedgerEntries: Parameters<typeof insertLocLedgerEntry>[1][] = [];

  for (const char of distressed) {
    const charIdStr = char._id.toString();
    const incoming = charPayments.get(charIdStr);
    if (!incoming || incoming.size === 0) continue;

    // Snapshot incoming income (face amounts) and convert to internal units.
    const incomeFaceByCurrency: Partial<Record<CurrencyCode, number>> = {};
    let incomeInternalTotal = 0;
    for (const [c, amt] of incoming) {
      if (!amt || amt <= 0) continue;
      const rate = rates[c];
      if (!rate || rate <= 0) continue;
      incomeFaceByCurrency[c] = (incomeFaceByCurrency[c] ?? 0) + amt;
      incomeInternalTotal += toInternalUnits(amt, rate);
    }
    if (incomeInternalTotal <= 0) continue;

    const loc = char.lineOfCredit;
    if (!loc) continue;
    const balancesBefore: Partial<Record<CurrencyCode, number>> = { ...(loc.balances ?? {}) };
    const arrearsBefore: Partial<Record<CurrencyCode, number>> = { ...(loc.arrears ?? {}) };

    // Cross-currency allocation: arrears first (stable currency order), then principal.
    const {
      principal: balancesAfter,
      arrears: arrearsAfter,
      appliedInternal,
    } = allocateInternalPaymentToLoc(incomeInternalTotal, balancesBefore, arrearsBefore, rates);

    if (appliedInternal <= 0) {
      // No outstanding obligation — leave income alone (will hit wallet normally).
      continue;
    }

    const consumedFraction = Math.min(1, appliedInternal / incomeInternalTotal);

    // Compute per-currency face deltas (interest = arrears reduction, principal = balance reduction).
    const interestPortions: Partial<Record<CurrencyCode, number>> = {};
    const principalPortions: Partial<Record<CurrencyCode, number>> = {};
    for (const c of FOREX_ACTIVE_CURRENCIES) {
      const arrDelta = roundSavingsAmount(
        Math.max(0, (arrearsBefore[c] ?? 0) - (arrearsAfter[c] ?? 0)),
        c
      );
      const balDelta = roundSavingsAmount(
        Math.max(0, (balancesBefore[c] ?? 0) - (balancesAfter[c] ?? 0)),
        c
      );
      if (arrDelta > 0) interestPortions[c] = arrDelta;
      if (balDelta > 0) principalPortions[c] = balDelta;
    }

    // Persist new LOC state. Drop empty keys to keep the document tidy.
    const newP: Partial<Record<CurrencyCode, number>> = {};
    const newA: Partial<Record<CurrencyCode, number>> = {};
    for (const c of FOREX_ACTIVE_CURRENCIES) {
      const p = balancesAfter[c] ?? 0;
      const a = arrearsAfter[c] ?? 0;
      if (p > 0) newP[c] = p;
      if (a > 0) newA[c] = a;
    }

    // Claim this exact LOC snapshot before suppressing any in-flight income.
    // A concurrent draw or repayment makes the claim miss, leaving the income
    // untouched for the caller to credit normally instead of overwriting debt.
    const locUpdate = await db.collection<Character>("characters").updateOne(
      { _id: char._id, lineOfCredit: loc },
      {
        $set: {
          "lineOfCredit.balances": newP,
          "lineOfCredit.arrears": newA,
          updatedAt: now,
        },
      }
    );
    if (locUpdate.matchedCount === 0) {
      console.warn(
        `[line-of-credit] skipped stale ${source} garnishment for character ${charIdStr} on turn ${turn}`
      );
      continue;
    }

    // Reduce or remove the in-flight income map for this character. If the
    // obligation only consumed a fraction of income, scale down each currency
    // entry; if it consumed everything (typical), delete entries entirely.
    // Auxiliary maps (e.g. dividendPayments for forex auto-convert) get the
    // same treatment so downstream phases stay consistent.
    const allMaps = [charPayments, ...(options?.auxiliaryPayments ?? [])];
    if (consumedFraction >= 1 - 1e-9) {
      for (const m of allMaps) m.delete(charIdStr);
    } else {
      for (const m of allMaps) {
        const cur = m.get(charIdStr);
        if (!cur) continue;
        const residualMap = new Map<CurrencyCode, number>();
        for (const [c, amt] of cur) {
          const residual = roundSavingsAmount(Math.max(0, amt * (1 - consumedFraction)), c);
          if (residual > 0) residualMap.set(c, residual);
        }
        if (residualMap.size > 0) m.set(charIdStr, residualMap);
        else m.delete(charIdStr);
      }
    }

    // Credit interest portion of arrears reduction to the lending bank's reserves
    // (per the LOC currency). Mirrors the auto-pay flow in `processLineOfCreditTurn`.
    for (const [c, amount] of Object.entries(interestPortions) as [CurrencyCode, number][]) {
      if (amount <= 0) continue;
      const cid = getCountryIdForCurrency(c);
      bankReserveInc.set(cid, (bankReserveInc.get(cid) ?? 0) + amount);
    }

    // Per-LOC-currency ledger row (one per currency that actually paid down).
    const obligationCurrencies = new Set<CurrencyCode>([
      ...(Object.keys(interestPortions) as CurrencyCode[]),
      ...(Object.keys(principalPortions) as CurrencyCode[]),
    ]);

    for (const c of obligationCurrencies) {
      const interest = interestPortions[c] ?? 0;
      const principal = principalPortions[c] ?? 0;
      const total = roundSavingsAmount(interest + principal, c);
      if (total <= 0) continue;
      pendingLedgerEntries.push({
        characterId: char._id,
        currencyCode: c,
        type: "garnishment",
        amount: total,
        interestPortion: interest,
        principalPortion: principal,
        balanceAfter: newP[c] ?? 0,
        arrearsAfter: newA[c] ?? 0,
        turn,
        meta: {
          garnishmentSource: source,
          garnishedInternal: appliedInternal,
          incomeInternalApplied: appliedInternal,
          distress: true,
        },
      });

      txEntries.push({
        type: "loc_garnishment",
        turn,
        createdAt: now,
        subjectType: "character",
        subjectId: char._id,
        subjectName: char.name,
        amount: -total,
        currencyCode: c,
        meta: {
          interestPortion: interest,
          principalPortion: principal,
          garnishmentSource: source,
        },
      });
    }

    borrowersGarnished += 1;
    totalInternalGarnished += appliedInternal;

    // Per-borrower log: source income breakdown → applied LOC reductions, with
    // post-garnishment obligation snapshot for verification.
    const incomeSummary = Object.entries(incomeFaceByCurrency)
      .map(([c, amt]) => `${c} ${formatNumber(amt as number)}`)
      .join(" + ");
    const reductionSummary = [...obligationCurrencies]
      .map((c) => {
        const total = (interestPortions[c] ?? 0) + (principalPortions[c] ?? 0);
        const post = (newP[c] ?? 0) + (newA[c] ?? 0);
        return `${c} -${formatNumber(total)} (post=${formatNumber(post)})`;
      })
      .join(", ");
    console.log(
      `[loc-garnish/${source}] turn ${turn} ${char.name} (${char.countryId}, distressed): ` +
        `income {${incomeSummary}} = ${formatNumber(appliedInternal)} internal → LOC [${reductionSummary}]` +
        (consumedFraction < 1
          ? ` (${(consumedFraction * 100).toFixed(1)}% of income consumed)`
          : "")
    );
  }

  if (pendingLedgerEntries.length > 0) {
    await Promise.all(pendingLedgerEntries.map((entry) => insertLocLedgerEntry(db, entry)));
  }

  // Bulk-update bank reserves with garnished interest.
  await Promise.all(
    [...bankReserveInc]
      .filter(([, inc]) => inc > 0)
      .map(([cid, inc]) =>
        db
          .collection<CentralBank>("centralBanks")
          .updateOne({ _id: getBankId(cid as CountryId) }, { $inc: { reserveBalance: inc } })
      )
  );

  if (txEntries.length > 0) {
    void emitTxBulk(db, txEntries, thresholds);
  }

  if (borrowersGarnished > 0) {
    console.log(
      `[loc-garnish/${source}] turn ${turn} summary: ${borrowersGarnished} borrower(s) garnished, ` +
        `total ${formatNumber(totalInternalGarnished)} internal redirected to LOC`
    );
  }

  return { borrowersGarnished, totalInternalGarnished };
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
}

// Re-export for callers needing to convert internal back to face for display.
export { fromInternalUnits };
