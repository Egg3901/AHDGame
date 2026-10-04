import type { Bond } from "@/lib/db/types/bond";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";

/** Keep a bond's recorded denomination through later issuer moves. Older
 * unstamped bonds use the original country's currency, as the bond turn does. */
export function resolveBondCurrency(bond: Bond): CurrencyCode {
  if (bond.currencyCode) return bond.currencyCode;
  if (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP)
    return COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP];
  return "USD";
}
