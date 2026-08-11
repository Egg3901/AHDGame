import type { Db, ObjectId } from "mongodb";
import type { Character, ExchangeRate } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";

/**
 * Minimum fields needed for personal wealth operations.
 * Satisfied by both Character and ImperialCharacter.
 */
export interface PersonalWealthHolder {
  countryId: string;
  cashOnHand?: number;
  savingsOnHand?: number;
  currencyBalances?: {
    personal: Partial<Record<CurrencyCode, number>>;
    savings?: Partial<Record<CurrencyCode, number>>;
  };
  autoConvertEnabled?: boolean;
}

// ── Read helpers ────────────────────────────────────────────────────────────────

/**
 * Get personal balance in a specific currency.
 * Pre-forex: returns `cashOnHand` (ignores currencyCode since there's only one pool).
 * Post-forex: returns `currencyBalances.personal[currencyCode]` or 0.
 */
export function getPersonalBalance(
  character: PersonalWealthHolder,
  currencyCode: CurrencyCode,
  forexEnabled: boolean
): number {
  if (forexEnabled && character.currencyBalances) {
    return character.currencyBalances.personal[currencyCode] ?? 0;
  }
  return character.cashOnHand ?? 0;
}

/**
 * Liquid cash only — use `getTotalPersonalWealth` for liquid + savings.
 */
export function getSavingsBalance(
  character: Character,
  currencyCode: CurrencyCode,
  forexEnabled: boolean
): number {
  if (forexEnabled && character.currencyBalances) {
    return character.currencyBalances.savings?.[currencyCode] ?? 0;
  }
  const home = getHomeCurrency(character);
  if (currencyCode !== home) return 0;
  return character.savingsOnHand ?? 0;
}

export function isSavingsAccountOpened(character: Character, currencyCode: CurrencyCode): boolean {
  return character.savingsAccountsOpened?.[currencyCode] === true;
}

/**
 * Get total personal wealth across all currencies.
 * Pre-forex: returns `cashOnHand` + `savingsOnHand`.
 * Post-forex with exchangeRates: converts all balances to USD-equivalent using rates.
 * Post-forex without exchangeRates: returns home currency balance only (safe default).
 *
 * For wealth rankings and cross-country comparisons, always pass exchangeRates to get
 * accurate USD-equivalent values. Without rates, JPY balances would be ~100x inflated
 * relative to USD when raw-summed.
 *
 * Exchange rate format: { USD: 1.0, GBP: 0.75, JPY: 106.0 } (local per 1 internal unit).
 */
export function getTotalPersonalWealth(
  character: PersonalWealthHolder,
  forexEnabled: boolean,
  exchangeRates?: Partial<Record<CurrencyCode, number>>
): number {
  if (forexEnabled && character.currencyBalances) {
    const personal = character.currencyBalances.personal ?? {};
    const savings = character.currencyBalances.savings ?? {};
    const codes = new Set([...Object.keys(personal), ...Object.keys(savings)]) as Set<CurrencyCode>;
    const combined: Partial<Record<CurrencyCode, number>> = {};
    for (const code of codes) {
      combined[code] = (personal[code] ?? 0) + (savings[code] ?? 0);
    }
    if (exchangeRates) {
      const usdRate = exchangeRates.USD ?? 1;
      return Object.entries(combined).reduce((sum, [code, val]) => {
        const rate = exchangeRates[code as CurrencyCode] ?? usdRate;
        if (rate <= 0) return sum;
        return sum + (val ?? 0) / rate;
      }, 0);
    }
    const homeCurrency = getHomeCurrency(character);
    return combined[homeCurrency] ?? 0;
  }
  return (character.cashOnHand ?? 0) + (character.savingsOnHand ?? 0);
}

/**
 * Liquid personal cash only (excludes high-yield savings). Used for wallet line items;
 * use `getTotalPersonalWealth` for net worth including savings.
 */
export function getTotalPersonalLiquidWealth(
  character: PersonalWealthHolder,
  forexEnabled: boolean,
  exchangeRates?: Partial<Record<CurrencyCode, number>>
): number {
  if (forexEnabled && character.currencyBalances) {
    const personal = character.currencyBalances.personal ?? {};
    if (exchangeRates) {
      const usdRate = exchangeRates.USD ?? 1;
      return Object.entries(personal).reduce((sum, [code, val]) => {
        const rate = exchangeRates[code as CurrencyCode] ?? usdRate;
        if (rate <= 0) return sum;
        return sum + (val ?? 0) / rate;
      }, 0);
    }
    const homeCurrency = getHomeCurrency(character);
    return personal[homeCurrency] ?? 0;
  }
  return character.cashOnHand ?? 0;
}

/**
 * Savings only, converted when rates provided (same rules as total wealth).
 */
export function getTotalSavingsWealth(
  character: Character,
  forexEnabled: boolean,
  exchangeRates?: Partial<Record<CurrencyCode, number>>
): number {
  if (forexEnabled && character.currencyBalances) {
    const savings = character.currencyBalances.savings ?? {};
    if (exchangeRates) {
      const usdRate = exchangeRates.USD ?? 1;
      return Object.entries(savings).reduce((sum, [code, val]) => {
        const rate = exchangeRates[code as CurrencyCode] ?? usdRate;
        if (rate <= 0) return sum;
        return sum + (val ?? 0) / rate;
      }, 0);
    }
    const homeCurrency = getHomeCurrency(character);
    return savings[homeCurrency] ?? 0;
  }
  return character.savingsOnHand ?? 0;
}

/**
 * Lifetime interest credited to savings for one currency (from ledger accrual counters).
 */
export function getLifetimeInterestEarnedInCurrency(
  character: Character,
  currencyCode: CurrencyCode,
  forexEnabled: boolean
): number {
  if (forexEnabled && character.currencyBalances?.interestEarned) {
    return character.currencyBalances.interestEarned[currencyCode] ?? 0;
  }
  if (!forexEnabled && currencyCode === getHomeCurrency(character)) {
    return character.savingsInterestEarnedLifetime ?? 0;
  }
  return 0;
}

/**
 * Get the home currency for a character based on their countryId.
 */
export function getHomeCurrency(character: PersonalWealthHolder): CurrencyCode {
  return (COUNTRY_CURRENCY_MAP[character.countryId as keyof typeof COUNTRY_CURRENCY_MAP] ??
    "USD") as CurrencyCode;
}

// ── MongoDB $inc helpers ────────────────────────────────────────────────────────

/**
 * Build $inc update for personal balance in a specific currency.
 * Pre-forex: `{ cashOnHand: amount }`. Post-forex: `{ "currencyBalances.personal.<code>": amount }`.
 */
export function buildPersonalBalanceInc(
  amount: number,
  currencyCode: CurrencyCode,
  forexEnabled: boolean
): Record<string, number> {
  if (forexEnabled) {
    return { [`currencyBalances.personal.${currencyCode}`]: amount };
  }
  return { cashOnHand: amount };
}

/**
 * Increment savings only (e.g. interest accrual).
 */
export function buildSavingsBalanceInc(
  amount: number,
  currencyCode: CurrencyCode,
  forexEnabled: boolean
): Record<string, number> {
  if (forexEnabled) {
    return { [`currencyBalances.savings.${currencyCode}`]: amount };
  }
  return { savingsOnHand: amount };
}

/**
 * Move funds from liquid personal to savings (deposit).
 */
export function buildTransferToSavingsInc(
  amount: number,
  currencyCode: CurrencyCode,
  forexEnabled: boolean
): Record<string, number> {
  if (forexEnabled) {
    return {
      [`currencyBalances.personal.${currencyCode}`]: -amount,
      [`currencyBalances.savings.${currencyCode}`]: amount,
    };
  }
  return { cashOnHand: -amount, savingsOnHand: amount };
}

/**
 * Move funds from savings to liquid personal (withdrawal).
 */
export function buildTransferFromSavingsInc(
  amount: number,
  currencyCode: CurrencyCode,
  forexEnabled: boolean
): Record<string, number> {
  if (forexEnabled) {
    return {
      [`currencyBalances.personal.${currencyCode}`]: amount,
      [`currencyBalances.savings.${currencyCode}`]: -amount,
    };
  }
  return { cashOnHand: amount, savingsOnHand: -amount };
}

export function buildSetSavingsAccountOpened(
  currencyCode: CurrencyCode,
  opened: boolean
): Record<string, boolean> {
  return { [`savingsAccountsOpened.${currencyCode}`]: opened };
}

// ── MongoDB $set helpers ────────────────────────────────────────────────────────

/**
 * Build $set update for personal balance in a specific currency (used when setting to an absolute value).
 * Pre-forex: `{ cashOnHand: amount }`. Post-forex: `{ "currencyBalances.personal.<code>": amount }`.
 */
export function buildPersonalBalanceSet(
  amount: number,
  currencyCode: CurrencyCode,
  forexEnabled: boolean
): Record<string, number> {
  if (forexEnabled) {
    return { [`currencyBalances.personal.${currencyCode}`]: amount };
  }
  return { cashOnHand: amount };
}

// ── Bulk write operation builders ───────────────────────────────────────────────
// For use in turn processing where operations are batched into bulkWrite calls.

/**
 * Build a bulkWrite updateOne operation to increment personal balance.
 * Drop-in replacement for the pattern:
 *   { updateOne: { filter: { _id }, update: { $inc: { cashOnHand: amount } } } }
 */
export function buildPersonalBalanceBulkOp(
  characterId: ObjectId,
  amount: number,
  currencyCode: CurrencyCode,
  forexEnabled: boolean
) {
  return {
    updateOne: {
      filter: { _id: characterId },
      update: { $inc: buildPersonalBalanceInc(amount, currencyCode, forexEnabled) },
    },
  };
}

export function buildSavingsBalanceBulkOp(
  characterId: ObjectId,
  amount: number,
  currencyCode: CurrencyCode,
  forexEnabled: boolean
) {
  return {
    updateOne: {
      filter: { _id: characterId },
      update: { $inc: buildSavingsBalanceInc(amount, currencyCode, forexEnabled) },
    },
  };
}

/**
 * Interest accrual: credits savings balance and lifetime interest-earned counters together.
 */
export function buildSavingsInterestAccrualBulkOp(
  characterId: ObjectId,
  interest: number,
  currencyCode: CurrencyCode,
  forexEnabled: boolean
) {
  const inc = forexEnabled
    ? {
        [`currencyBalances.savings.${currencyCode}`]: interest,
        [`currencyBalances.interestEarned.${currencyCode}`]: interest,
      }
    : {
        savingsOnHand: interest,
        savingsInterestEarnedLifetime: interest,
      };
  return {
    updateOne: {
      filter: { _id: characterId },
      update: { $inc: inc },
    },
  };
}

// ── FX rate loader ──────────────────────────────────────────────────────────────

/**
 * Load the live FX rate for a character's home currency (local per 1 ₳).
 *
 * Returns { rate, ok: true } on success.
 * Returns { rate: 1.0, ok: false } when the rate document is missing or
 * invalid — callers must decide the failure policy:
 *   - API routes: hard-fail 503
 *   - Turn processing: fall back to INITIAL_RATES
 *
 * All named currencies — including USD — float against ₳ and must use the
 * live rate from the exchangeRates collection. ₳ is its own anchor unit;
 * there is no currency that is 1:1 with ₳ by definition. See
 * `src/lib/currency/corporationCapital.ts` header comment.
 */
export async function loadCharacterFxRate(
  db: Db,
  homeCurrency: CurrencyCode
): Promise<{ rate: number; ok: boolean }> {
  const rateDoc = await db
    .collection<ExchangeRate>("exchangeRates")
    .findOne({ currencyCode: homeCurrency }, { projection: { rate: 1 } });
  if (!rateDoc || !Number.isFinite(rateDoc.rate) || rateDoc.rate <= 0) {
    return { rate: 1.0, ok: false };
  }
  return { rate: rateDoc.rate, ok: true };
}
