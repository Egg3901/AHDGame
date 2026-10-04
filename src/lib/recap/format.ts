import { COUNTRY_CURRENCY_MAP, CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import type { CharacterRecap, RecapRankedStat } from "./types";

/**
 * Formatting shared by the story, the public share page and the OG/poster
 * images, so a number reads the same everywhere it is shown. Client-safe; the
 * currency tables are only consulted for v1 recaps, which predate
 * `currencySymbol`.
 */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return fmt(n);
}

export function pct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

/** The recap's money symbol: frozen at build time (v2), else derived from the country (v1). */
export function currencySymbol(
  recap: Pick<CharacterRecap, "currency" | "currencySymbol" | "countryId">
): string {
  if (recap.currencySymbol) return recap.currencySymbol;
  const code = recap.currency ?? COUNTRY_CURRENCY_MAP[recap.countryId as CountryId] ?? "USD";
  return (CURRENCY_SYMBOLS as Record<string, string>)[code] ?? "$";
}

/** Money in the recap's home currency, compact ("£4.2M", "DM 4.2M"). */
export function money(
  recap: Pick<CharacterRecap, "currency" | "currencySymbol" | "countryId">,
  n: number
): string {
  const sym = currencySymbol(recap);
  const sign = n < 0 ? "-" : "";
  // Letter symbols (DM, M, Ft, kr) read as words: a non-breaking space, and
  // k/mn/bn so the East German mark never reads "M 4.2M".
  if (/[A-Za-z.]$/.test(sym)) return `${sign}${sym}\u00A0${compactWords(Math.abs(n))}`;
  return `${sign}${sym}${compact(Math.abs(n))}`;
}

function compactWords(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}tn`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}bn`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}mn`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return fmt(n);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmt(n)} ${n === 1 ? one : many}`;
}

/** "March 1961" from a `{year, month}` game date (month 0-based). */
export function monthYear(d: { year: number; month: number } | null | undefined): string {
  if (!d) return "";
  return `${MONTHS[d.month] ?? ""} ${d.year}`.trim();
}

/** "Top 4%" for a ranked stat, or null when unranked. */
export function topPercent(stat: RecapRankedStat | null | undefined): string | null {
  if (!stat || stat.rank == null || stat.total <= 1) return null;
  return `Top ${Math.max(1, Math.ceil((stat.rank / stat.total) * 100))}%`;
}

export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
