/** Accepted income diversion and residual wallet payout share a character receipt. */
import { ObjectId, type Db } from "mongodb";
import type { Character } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { FOREX_ACTIVE_CURRENCIES, getCountryIdForCurrency } from "@/lib/constants/currencies";
import type { LocGarnishmentSource } from "@/lib/db/types/locLedger";
import { isLineOfCreditEnabled } from "./featureFlag";
import { allocateInternalPaymentToLoc, fromInternalUnits, toInternalUnits } from "./locMath";
import { loadExchangeRatesMap } from "./netWorth";
import { roundSavingsAmount } from "@/lib/currency/savingsInterest";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import { loadLocSettlement, locInterestCredits, settleLocPlan, type LocEffect } from "./settlement";
import { isDeepStrictEqual } from "node:util";

export interface GarnishmentResult {
  borrowersGarnished: number;
  totalInternalGarnished: number;
}
const faceMap = (map: Map<CurrencyCode, number> | undefined) =>
  Object.fromEntries([...(map ?? [])].sort(([a], [b]) => a.localeCompare(b)));

/**
 * Once accepted, this helper owns the borrower's residual payout too. Caller
 * maps are removed only after debt, cash, receipts and residual FX finish.
 * A retry therefore cannot duplicate the residual in its following bulkWrite.
 */
export async function garnishLocFromIncome(
  db: Db,
  charPayments: Map<string, Map<CurrencyCode, number>>,
  turn: number,
  source: LocGarnishmentSource,
  options?: { auxiliaryPayments?: Map<string, Map<CurrencyCode, number>>[] }
): Promise<GarnishmentResult> {
  if (!charPayments.size || !(await isLineOfCreditEnabled()))
    return { borrowersGarnished: 0, totalInternalGarnished: 0 };
  const ids = [...charPayments.keys()].filter((id) => ObjectId.isValid(id));
  const chars = await db
    .collection<Character & { lineOfCreditRevision?: number }>("characters")
    .find(
      { _id: { $in: ids.map((id) => new ObjectId(id)) } },
      { projection: { _id: 1, name: 1, countryId: 1, lineOfCredit: 1, lineOfCreditRevision: 1 } }
    )
    .toArray();
  const rates = await loadExchangeRatesMap(db);
  let borrowersGarnished = 0,
    totalInternalGarnished = 0;
  for (const char of chars) {
    const id = char._id.toHexString(),
      key = `loc:garnish:${source}:${turn}:${id}`;
    const income = faceMap(charPayments.get(id));
    const auxiliary = (options?.auxiliaryPayments ?? []).map((map) => faceMap(map.get(id)));
    const request = { operation: "garnish", source, turn, income, auxiliary };
    const original = await loadLocSettlement(db, key);
    let result: Record<string, unknown>;
    if (original) {
      if (!isDeepStrictEqual(original.locSettlement.request, request))
        throw new Error("Accepted LOC income event changed; payout stopped for reconciliation");
      const settled = await settleLocPlan(db, key, turn, original.locSettlement);
      if (settled.error) throw new Error(settled.error);
      result = settled.result;
    } else {
      const loc = char.lineOfCredit;
      if (!loc?.drawFrozen) continue;
      let incomeInternal = 0;
      for (const [code, amount] of Object.entries(income)) {
        const rate = rates[code as CurrencyCode];
        if (amount > 0 && rate && rate > 0) incomeInternal += toInternalUnits(amount, rate);
      }
      if (incomeInternal <= 0) continue;
      const allocated = allocateInternalPaymentToLoc(
        incomeInternal,
        loc.balances ?? {},
        loc.arrears ?? {},
        rates
      );
      if (allocated.appliedInternal <= 0) continue;
      const fraction = Math.min(1, allocated.appliedInternal / incomeInternal);
      const principal: Partial<Record<CurrencyCode, number>> = {},
        arrears: Partial<Record<CurrencyCode, number>> = {},
        interest: Partial<Record<CurrencyCode, number>> = {},
        principalPaid: Partial<Record<CurrencyCode, number>> = {};
      for (const c of FOREX_ACTIVE_CURRENCIES) {
        if ((allocated.principal[c] ?? 0) > 0) principal[c] = allocated.principal[c];
        if ((allocated.arrears[c] ?? 0) > 0) arrears[c] = allocated.arrears[c];
        interest[c] = roundSavingsAmount(
          Math.max(0, (loc.arrears?.[c] ?? 0) - (allocated.arrears[c] ?? 0)),
          c
        );
        principalPaid[c] = roundSavingsAmount(
          Math.max(0, (loc.balances?.[c] ?? 0) - (allocated.principal[c] ?? 0)),
          c
        );
      }
      const residual = (amounts: Record<string, number>) =>
        Object.fromEntries(
          Object.entries(amounts).map(([code, amount]) => [
            code,
            fraction >= 1 - 1e-9
              ? 0
              : roundSavingsAmount(Math.max(0, amount * (1 - fraction)), code as CurrencyCode),
          ])
        );
      const remaining = residual(income);
      // Salary stays in its original currency. Only the dividend auxiliary map
      // is converted for corporation income; bond income converts all residuals.
      const conversions = source === "bond_coupon" ? remaining : residual(auxiliary[0] ?? {});
      const ledger: LocEffect["ledger"] = [],
        transactions: LocEffect["transactions"] = [];
      for (const c of FOREX_ACTIVE_CURRENCIES) {
        const i = interest[c] ?? 0,
          p = principalPaid[c] ?? 0,
          total = roundSavingsAmount(i + p, c);
        if (total <= 0) continue;
        const portions = { interestPortion: i, principalPortion: p };
        ledger.push({
          characterId: char._id,
          countryId: getCountryIdForCurrency(c),
          currencyCode: c,
          type: "garnishment",
          amount: total,
          ...portions,
          balanceAfter: principal[c] ?? 0,
          arrearsAfter: arrears[c] ?? 0,
          turn,
          meta: {
            garnishmentSource: source,
            garnishedInternal: allocated.appliedInternal,
            incomeInternalApplied: allocated.appliedInternal,
            distress: true,
          },
        });
        transactions.push({
          type: "loc_garnishment",
          turn,
          subjectType: "character",
          subjectId: char._id,
          subjectName: char.name,
          amount: -total,
          currencyCode: c,
          meta: { ...portions, garnishmentSource: source },
        });
      }
      const flows: LocEffect["flows"] = Object.entries(income).map(([currency, amount]) => ({
        currency,
        kind: "source_income",
        amount,
        note: `Accepted ${source} income before wallet payout`,
      }));
      for (const c of FOREX_ACTIVE_CURRENCIES)
        for (const [kind, amount, note] of [
          ["credit", remaining[c] ?? 0, "Residual personal wallet payout"],
          ["credit", interest[c] ?? 0, "Lender interest reserve"],
          ["burn", principalPaid[c] ?? 0, "LOC principal retired"],
        ] as const)
          if (amount > 0) flows.push({ currency: c, kind, amount, note });
      const settled = await settleLocPlan(db, key, turn, {
        characterId: char._id,
        expectedLoc: loc,
        expectedRevision: char.lineOfCreditRevision ?? null,
        request,
        createdAt: new Date(),
        effect: {
          locAfter: { ...loc, balances: principal, arrears },
          walletInc: Object.fromEntries(
            Object.entries(remaining)
              .filter(([, amount]) => amount > 0)
              .map(([c, amount]) => [`currencyBalances.personal.${c}`, amount])
          ),
          reserves: locInterestCredits(interest),
          ledger,
          transactions,
          flows,
          result: {
            appliedInternal: allocated.appliedInternal,
            fraction,
            remaining,
            conversions,
            home: getHomeCurrency(char),
            countryId: char.countryId,
            rates,
          },
        },
      });
      if (settled.error) throw new Error(settled.error);
      result = settled.result;
    }
    charPayments.delete(id);
    for (const map of options?.auxiliaryPayments ?? []) map.delete(id);
    borrowersGarnished += 1;
    totalInternalGarnished += Number(result.appliedInternal);
  }
  return { borrowersGarnished, totalInternalGarnished };
}
export { fromInternalUnits };
