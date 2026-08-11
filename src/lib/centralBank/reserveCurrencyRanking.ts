/**
 * Rank currencies by how much of them is held as FX reserves across all central
 * banks — i.e. the spread-fee reserve bucket (`spreadFeeReserveBalances`).
 *
 * The home lending reserve (`reserveBalance`) is deliberately EXCLUDED: it is a
 * country stuffing its own currency into its own bank (largely via cabinet
 * treasury transfers) and would otherwise let one big domestic balance crown the
 * "leading exchange currency" regardless of international demand. A reserve
 * currency is one that shows up in reserves — so only the FX reserve bucket counts.
 *
 * Totals are valued in the internal anchor (₳) via the live rate map so currencies
 * can be ranked against each other. The #1 currency is the "leading exchange
 * currency" and earns a volatility buff in the rate engine.
 *
 * Pure — no DB access; the caller supplies the banks and the rate map.
 */
import type { CurrencyCode } from "@/lib/constants/currencies";

/** Minimal shape this module needs from a CentralBank document. */
export interface ReserveBankInput {
  spreadFeeReserveBalances?: Partial<Record<CurrencyCode, number>> | null;
}

export interface ReserveCurrencyRankEntry {
  currencyCode: CurrencyCode;
  /** Total face units of this currency held as FX reserves across all CBs. */
  units: number;
  /** Value of `units` in the internal anchor (₳), used for cross-currency ranking. */
  internalValue: number;
  /** 1-based rank by internalValue (1 = leading reserve currency). */
  rank: number;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteNonNeg(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Aggregate and rank reserve currencies by FX (spread-fee) reserves held across
 * all central banks. Returns every currency with a positive total AND a usable
 * rate, sorted by internal value (descending).
 */
export function rankReserveCurrencies(
  banks: ReserveBankInput[],
  rates: Partial<Record<CurrencyCode, number>>
): ReserveCurrencyRankEntry[] {
  const reserveUnits = new Map<CurrencyCode, number>();

  for (const bank of banks) {
    const spread = bank.spreadFeeReserveBalances ?? {};
    for (const [code, amount] of Object.entries(spread) as Array<
      [CurrencyCode, number | undefined]
    >) {
      const units = finiteNonNeg(amount);
      if (units > 0) {
        reserveUnits.set(code, (reserveUnits.get(code) ?? 0) + units);
      }
    }
  }

  const entries: Omit<ReserveCurrencyRankEntry, "rank">[] = [];
  for (const [currencyCode, units] of reserveUnits) {
    const rate = rates[currencyCode];
    if (units <= 0 || !finitePositive(rate)) continue;
    // rate is "local currency per 1 internal unit" → internal value = units / rate.
    entries.push({ currencyCode, units, internalValue: units / rate });
  }

  entries.sort((a, b) => b.internalValue - a.internalValue);
  return entries.map((entry, i) => ({ ...entry, rank: i + 1 }));
}

/**
 * The leading exchange currency = the #1 ranked reserve currency, or null when
 * no central bank holds any rankable FX reserves yet.
 */
export function getLeadingReserveCurrency(
  banks: ReserveBankInput[],
  rates: Partial<Record<CurrencyCode, number>>
): CurrencyCode | null {
  return rankReserveCurrencies(banks, rates)[0]?.currencyCode ?? null;
}
