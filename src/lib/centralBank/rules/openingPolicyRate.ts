/**
 * Opening central-bank rates use observed policy benchmarks for January 1991.
 * getOpeningPolicyRate leaves other years and unauthored countries at their
 * supplied default; subsequent rate decisions remain ordinary game policy.
 */
import type { CountryId } from "@/lib/constants/countries";

/** Percent per year, January 1, 1991; distinct from neutral policy targets. */
export const OPENING_POLICY_RATES_1991: Partial<Record<CountryId, number>> = {
  // Intended federal funds target after December 18, 1990, not the annual mean.
  // https://www.federalreserve.gov/foia/files/20190829-changes-intended-federal-funds-rate.pdf
  US: 7,
  // Official Bank Rate from October 8, 1990 until February 13, 1991.
  // https://www.bankofengland.co.uk/boeapps/database/Bank-Rate.asp
  UK: 13.88,
  // Official discount rate from August 30, 1990 until July 1, 1991.
  // https://www.boj.or.jp/en/statistics/boj/other/discount/index.htm
  JP: 6,
  // Bundesbank discount rate; the separate Lombard rate was 8.5 percent.
  // https://www.bundesbank.de/resource/blob/651504/9dad568ed96af0fda517b17a3fe7f1cf/mL/s510ttdiscount-data.pdf
  DE: 6,
  // Short-term facility after December 21, 1990. OECD country-survey chronology.
  // https://www.oecd.org/content/dam/oecd/en/publications/reports/1991/01/oecd-economic-surveys-ireland-1991_g1g1718f/eco_surveys-irl-1991-en.pdf
  IE: 11.25,
};

export function getOpeningPolicyRate(
  countryId: CountryId,
  startingYear: number | undefined,
  fallback: number
): number {
  return startingYear === 1991 ? (OPENING_POLICY_RATES_1991[countryId] ?? fallback) : fallback;
}
