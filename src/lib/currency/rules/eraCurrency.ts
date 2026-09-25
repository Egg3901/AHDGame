import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";

const EURO_ADOPTION_YEAR: Partial<Record<CountryId, number>> = {
  AT: 1999,
  DE: 1999,
  ES: 1999,
  FI: 1999,
  FR: 1999,
  GR: 2001,
  IE: 1999,
  IT: 1999,
};

export const MODELED_EURO_MEMBERS = Object.freeze(Object.keys(EURO_ADOPTION_YEAR) as CountryId[]);

export function currencyForCountryAtYear(
  countryId: CountryId,
  year: number,
  legacyCurrency: CurrencyCode
): CurrencyCode {
  const adoptionYear = EURO_ADOPTION_YEAR[countryId];
  return adoptionYear !== undefined && year >= adoptionYear ? "EUR" : legacyCurrency;
}

export function euroMembersAtYear(year: number): CountryId[] {
  return MODELED_EURO_MEMBERS.filter((countryId) => year >= EURO_ADOPTION_YEAR[countryId]!);
}

/** LOCAL_new = LOCAL_old × targetRate / sourceRate. */
export function currencyConversionScale(sourceRate: number, targetRate: number): number {
  if (!Number.isFinite(sourceRate) || sourceRate <= 0) {
    throw new Error(`Invalid source currency rate: ${sourceRate}`);
  }
  if (!Number.isFinite(targetRate) || targetRate <= 0) {
    throw new Error(`Invalid target currency rate: ${targetRate}`);
  }
  return targetRate / sourceRate;
}
