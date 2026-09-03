import { ALL_EXCHANGES, getExchangeApiKey } from "@/lib/constants/exchangeRegistry";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { ExchangeFilter } from "./types";

export interface ExchangeMetaEntry {
  title: string;
  subtitle: string;
  exchangeApi: string;
}

const GLOBAL_EXCHANGE_META: ExchangeMetaEntry = {
  title: "Stock Market",
  subtitle: "All listed corporations worldwide",
  exchangeApi: "global",
};

/**
 * How a country is named in an exchange subtitle.
 *
 * Takes a resolver rather than reading `COUNTRY_CONFIGS` directly, because the
 * compiled name is wrong for a country renamed at runtime — the reunified
 * German exchange read "VVB - East Germany". Callers pass
 * `useCountryDisplayName()`; the default keeps this module usable (and its unit
 * tests honest) without a React tree.
 */
export type CountryNameResolver = (id: CountryId) => string;

const compiledName: CountryNameResolver = (id) => COUNTRY_CONFIGS[id]?.name ?? id;

function metaFor(
  countryId: CountryId,
  exchangeName: string,
  apiKey: string,
  countryName: CountryNameResolver
): ExchangeMetaEntry {
  return {
    title: exchangeName,
    subtitle: `${exchangeName} - ${countryName(countryId)}`,
    exchangeApi: apiKey,
  };
}

/**
 * Built per call rather than once at module load: a subtitle now depends on
 * runtime renames, which a frozen module-level constant cannot see.
 */
function baseExchangeMeta(countryName: CountryNameResolver): Record<string, ExchangeMetaEntry> {
  return {
    global: GLOBAL_EXCHANGE_META,
    ...Object.fromEntries(
      ALL_EXCHANGES.filter((ex) => {
        const status = COUNTRY_CONFIGS[ex.countryId as CountryId]?.status;
        return status === "active" || status === "beta";
      }).map((ex) => [
        ex.countryId,
        metaFor(ex.countryId as CountryId, ex.exchangeName, ex.apiKey, countryName),
      ])
    ),
  };
}

export function buildRuntimeExchangeMeta(
  economyVisibleCountryIds: Set<CountryId> | null,
  currentCountryId: CountryId,
  countryName: CountryNameResolver = compiledName
): Record<string, ExchangeMetaEntry> {
  if (!economyVisibleCountryIds) {
    const base = baseExchangeMeta(countryName);
    // The registry is the sole source of the api key. Deriving it here as
    // `exchangeName.toLowerCase()` would skip the whitespace-to-hyphen step in
    // `toApiKey`, producing "gosplan ssr" instead of "gosplan-ssr" — a key that
    // matches nothing in EXCHANGE_API_KEYS.
    const currentName = COUNTRY_CONFIGS[currentCountryId]?.exchangeName;
    const currentApiKey = getExchangeApiKey(currentCountryId);

    return {
      ...base,
      ...(currentName && currentApiKey && !base[currentCountryId]
        ? {
            [currentCountryId]: metaFor(currentCountryId, currentName, currentApiKey, countryName),
          }
        : {}),
    };
  }

  return {
    global: GLOBAL_EXCHANGE_META,
    ...Object.fromEntries(
      ALL_EXCHANGES.filter((ex) => economyVisibleCountryIds.has(ex.countryId as CountryId)).map(
        (ex) => [
          ex.countryId,
          metaFor(ex.countryId as CountryId, ex.exchangeName, ex.apiKey, countryName),
        ]
      )
    ),
  };
}

export function getStockMarketBasePath(
  exchangeFilter: ExchangeFilter,
  fallbackCountryCode: string
): string {
  if (exchangeFilter === "global") {
    return "/stockmarket/global";
  }

  const upperFilter = exchangeFilter.toUpperCase();
  if (upperFilter in COUNTRY_CONFIGS) {
    return `/country/${exchangeFilter.toLowerCase()}/stockmarket`;
  }

  return fallbackCountryCode.toLowerCase() === "global"
    ? "/stockmarket/global"
    : `/country/${fallbackCountryCode.toLowerCase()}/stockmarket`;
}
