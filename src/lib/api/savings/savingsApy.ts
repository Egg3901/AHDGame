import type { Db } from "mongodb";
import type { CentralBank } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency, FOREX_ACTIVE_CURRENCIES } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { savingsApyPercent } from "@/lib/currency/savingsInterest";

const DEFAULT_PRIME = 2.5;

/**
 * APY percent = half the REAL prime rate (nominal prime − local inflation),
 * matching what {@link computeSavingsInterestForTurn} actually pays. Displaying
 * the nominal ½-prime here would overstate returns for high-inflation currencies.
 */
export async function loadSavingsApyByCurrency(
  db: Db
): Promise<Partial<Record<CurrencyCode, number>>> {
  const bankIds = [
    ...new Set(FOREX_ACTIVE_CURRENCIES.map((c) => getBankId(getCountryIdForCurrency(c)))),
  ];
  const banks = await db
    .collection<CentralBank>("centralBanks")
    .find({ _id: { $in: bankIds } })
    .project({ _id: 1, primeRate: 1, inflationHistory: 1 })
    .toArray();
  const primeByBankId = new Map(banks.map((b) => [String(b._id), b.primeRate ?? DEFAULT_PRIME]));
  const inflationByBankId = new Map(
    banks.map((b) => [String(b._id), b.inflationHistory?.at(-1)?.rate ?? 0])
  );
  const out: Partial<Record<CurrencyCode, number>> = {};
  for (const c of FOREX_ACTIVE_CURRENCIES) {
    const bankId = getBankId(getCountryIdForCurrency(c));
    const prime = primeByBankId.get(bankId) ?? DEFAULT_PRIME;
    const inflation = inflationByBankId.get(bankId) ?? 0;
    out[c] = Math.round(savingsApyPercent(prime, inflation) * 100) / 100;
  }
  return out;
}
