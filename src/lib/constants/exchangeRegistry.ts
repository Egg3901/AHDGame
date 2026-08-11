/**
 * Exchange Registry — config-driven stock exchange lookups.
 *
 * All mappings are derived from COUNTRY_CONFIGS.exchangeName.
 * Adding a country with an exchangeName automatically registers its exchange.
 * No hardcoded NYSE/FTSE/Nikkei values outside this file and countries.ts.
 */

import { COUNTRY_CONFIGS, COUNTRY_ORDER, type CountryId } from "./countries";

export interface ExchangeInfo {
  countryId: CountryId;
  /** Display name: "NYSE", "FTSE", "Nikkei", "GOSPLAN", etc. */
  exchangeName: string;
  /** Lowercase API key: "nyse", "ftse", "nikkei", "gosplan", etc. */
  apiKey: string;
  /** "market" = tradable bourse; "stateRegister" = command-economy enterprise register. */
  kind: "market" | "stateRegister";
}

/**
 * Lowercase, URL-safe key for an exchange name. Whitespace collapses to a
 * hyphen so a multi-word register ("GOSPLAN BSSR") does not put a space into
 * `?exchange=` query strings or into `stockExchangeSnapshots._id`. This is a
 * no-op for every single-word exchange name, so live snapshot ids are unchanged.
 */
function toApiKey(exchangeName: string): string {
  return exchangeName.toLowerCase().replace(/\s+/g, "-");
}

/**
 * One row per COUNTRY that declares an exchangeName.
 *
 * Iterates COUNTRY_ORDER first (so display order is stable and matches the rest
 * of the app), then any remaining COUNTRY_CONFIGS key. That tail matters:
 * SCO, WAL, BAL and BLR are configured countries that are deliberately absent
 * from COUNTRY_ORDER, and building only from COUNTRY_ORDER left them with no
 * resolvable exchange at all — so their corporations fell through to whatever
 * fallback the caller used (NYSE).
 */
function buildCountryEntries(): ExchangeInfo[] {
  const ordered: CountryId[] = [
    ...COUNTRY_ORDER,
    ...(Object.keys(COUNTRY_CONFIGS) as CountryId[]).filter((id) => !COUNTRY_ORDER.includes(id)),
  ];

  return ordered
    .map((id) => [id, COUNTRY_CONFIGS[id]] as const)
    .filter(([, config]) => config?.exchangeName)
    .map(([id, config]) => ({
      countryId: id,
      exchangeName: config.exchangeName!,
      apiKey: toApiKey(config.exchangeName!),
      kind: config.exchangeKind ?? ("market" as const),
    }));
}

/** Per-country venue rows. Several countries may share one venue (UK/SCO/WAL → FTSE). */
const COUNTRY_ENTRIES: ExchangeInfo[] = buildCountryEntries();

/**
 * All registered exchanges — one row per VENUE, deduped by apiKey (first wins).
 *
 * Deduping is load-bearing: the turn snapshot writes one `stockExchangeSnapshots`
 * document per entry keyed on `apiKey`, so three FTSE rows would collide on _id.
 */
export const ALL_EXCHANGES: ExchangeInfo[] = COUNTRY_ENTRIES.filter(
  (entry, index) => COUNTRY_ENTRIES.findIndex((e) => e.apiKey === entry.apiKey) === index
);

/** Set of valid lowercase API keys (for validation). Includes "global". */
export const EXCHANGE_API_KEYS: Set<string> = new Set([
  "global",
  ...ALL_EXCHANGES.map((e) => e.apiKey),
]);

/** Map: apiKey → ExchangeInfo (one venue per key) */
const BY_API_KEY = new Map(ALL_EXCHANGES.map((e) => [e.apiKey, e]));

/** Map: countryId → ExchangeInfo (every configured country, shared venues included) */
const BY_COUNTRY = new Map(COUNTRY_ENTRIES.map((e) => [e.countryId, e]));

// ── Lookup helpers ──────────────────────────────────────────────────────────

/** Get the display exchange name for a country. Returns undefined if country has no exchange. */
export function getExchangeForCountry(countryId: string): string | undefined {
  return BY_COUNTRY.get(countryId as CountryId)?.exchangeName;
}

/** Get the lowercase API key for a country's exchange (e.g. "nyse", "nikkei"). */
export function getExchangeApiKey(countryId: string): string | undefined {
  return BY_COUNTRY.get(countryId as CountryId)?.apiKey;
}

/** Reverse lookup: API key → countryId (e.g. "nyse" → "US", "nikkei" → "JP"). */
export function getCountryForExchange(apiKey: string): CountryId | undefined {
  return BY_API_KEY.get(apiKey.toLowerCase())?.countryId;
}

/** Get display label for an exchange, given either a countryId or apiKey. */
export function getExchangeLabel(countryIdOrApiKey: string): string {
  // Try as countryId first
  const byCountry = BY_COUNTRY.get(countryIdOrApiKey as CountryId);
  if (byCountry) return byCountry.exchangeName;
  // Try as apiKey
  const byKey = BY_API_KEY.get(countryIdOrApiKey.toLowerCase());
  if (byKey) return byKey.exchangeName;
  // Fallback
  return countryIdOrApiKey.toUpperCase();
}

/** Get all exchanges as a record suitable for EXCHANGE_NAMES maps: apiKey → displayName. */
export function getExchangeNamesMap(): Record<string, string> {
  const map: Record<string, string> = { global: "Global Markets" };
  for (const e of ALL_EXCHANGES) {
    map[e.apiKey] = e.exchangeName;
  }
  return map;
}

/** Get exchange-to-country mapping: apiKey → countryId. */
export function getExchangeCountryMap(): Record<string, CountryId> {
  const map: Record<string, CountryId> = {};
  for (const e of ALL_EXCHANGES) {
    map[e.apiKey] = e.countryId;
  }
  return map;
}

/**
 * True when the country's (or venue's) listing venue is a command economy's
 * enterprise register rather than a tradable exchange.
 */
export function isStateRegister(countryIdOrApiKey: string): boolean {
  const byCountry = BY_COUNTRY.get(countryIdOrApiKey as CountryId);
  if (byCountry) return byCountry.kind === "stateRegister";
  return BY_API_KEY.get(countryIdOrApiKey.toLowerCase())?.kind === "stateRegister";
}
