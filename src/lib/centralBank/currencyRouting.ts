import { COUNTRY_CONFIGS, type CountryConfig, type CountryId } from "@/lib/constants/countries";
import {
  COUNTRY_CURRENCY_MAP,
  CURRENCY_ANCHOR_COUNTRY,
  ZOD_CURRENCY_ENUM,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import { intorgCentralBankApiUrl } from "@/lib/urls";

const CURRENCY_CODE_SET = new Set<string>(ZOD_CURRENCY_ENUM);

export interface ResolvedCentralBankCurrency {
  code: CurrencyCode;
  anchorCountryId: CountryId;
  config: CountryConfig;
  /** Set when the anchor bank is intorg-run (ECB) — the client fetches from the intorg API. */
  apiBasePath?: string;
}

/**
 * Resolve a /centralbank/[currency] slug to the bank that backs it. Every
 * CurrencyCode maps to exactly one anchor country (CURRENCY_ANCHOR_COUNTRY),
 * whose (possibly shared) bank doc is the live one for that currency.
 */
export function resolveCentralBankCurrency(slug: string): ResolvedCentralBankCurrency | null {
  const code = slug.toUpperCase();
  if (!CURRENCY_CODE_SET.has(code)) return null;
  const currency = code as CurrencyCode;
  const anchorCountryId = CURRENCY_ANCHOR_COUNTRY[currency];
  const config = COUNTRY_CONFIGS[anchorCountryId];
  if (!config) return null;
  const intorgId = config.centralBank.centralBankIntorgId;
  return {
    code: currency,
    anchorCountryId,
    config,
    ...(intorgId ? { apiBasePath: intorgCentralBankApiUrl(intorgId) } : {}),
  };
}

/**
 * Registered countries whose home currency is `code`, in registration order.
 * Latent countries (SCO/WAL/BLR/BAL) appear only once activated, since
 * getRegisteredCountryIds only adds them then.
 */
export function getCurrencyMemberCountries(
  code: CurrencyCode,
  registeredCountryIds: CountryId[]
): CountryId[] {
  return registeredCountryIds.filter((id) => COUNTRY_CURRENCY_MAP[id] === code);
}

/** Rebuild a query string from a server-page `searchParams` object onto `base`. */
export function appendSearchParams(
  base: string,
  searchParams: Record<string, string | string[] | undefined>
): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) for (const v of value) sp.append(key, v);
    else if (value != null) sp.append(key, value);
  }
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}
