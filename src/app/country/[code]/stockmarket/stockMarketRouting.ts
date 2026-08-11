import { ALL_EXCHANGES, getExchangeApiKey } from "@/lib/constants/exchangeRegistry";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { ExchangeFilter } from "./types";

export interface ExchangeMetaEntry {
  title: string;
  subtitle: string;
  exchangeApi: string;
}

const BASE_EXCHANGE_META: Record<string, ExchangeMetaEntry> = {
  global: {
    title: "Stock Market",
    subtitle: "All listed corporations worldwide",
    exchangeApi: "global",
  },
  ...Object.fromEntries(
    ALL_EXCHANGES.filter((ex) => {
      const status = COUNTRY_CONFIGS[ex.countryId as CountryId]?.status;
      return status === "active" || status === "beta";
    }).map((ex) => [
      ex.countryId,
      {
        title: ex.exchangeName,
        subtitle: `${ex.exchangeName} - ${COUNTRY_CONFIGS[ex.countryId as CountryId]?.name ?? ex.countryId}`,
        exchangeApi: ex.apiKey,
      },
    ])
  ),
};

export function buildRuntimeExchangeMeta(
  economyVisibleCountryIds: Set<CountryId> | null,
  currentCountryId: CountryId
): Record<string, ExchangeMetaEntry> {
  if (!economyVisibleCountryIds) {
    // The registry is the sole source of the api key. Deriving it here as
    // `exchangeName.toLowerCase()` would skip the whitespace-to-hyphen step in
    // `toApiKey`, producing "gosplan ssr" instead of "gosplan-ssr" — a key that
    // matches nothing in EXCHANGE_API_KEYS.
    const currentName = COUNTRY_CONFIGS[currentCountryId]?.exchangeName;
    const currentApiKey = getExchangeApiKey(currentCountryId);

    return {
      ...BASE_EXCHANGE_META,
      ...(currentName && currentApiKey && !BASE_EXCHANGE_META[currentCountryId]
        ? {
            [currentCountryId]: {
              title: currentName,
              subtitle: `${currentName} - ${COUNTRY_CONFIGS[currentCountryId].name}`,
              exchangeApi: currentApiKey,
            },
          }
        : {}),
    };
  }

  return {
    global: BASE_EXCHANGE_META.global,
    ...Object.fromEntries(
      ALL_EXCHANGES.filter((ex) => economyVisibleCountryIds.has(ex.countryId as CountryId)).map(
        (ex) => [
          ex.countryId,
          {
            title: ex.exchangeName,
            subtitle: `${ex.exchangeName} - ${COUNTRY_CONFIGS[ex.countryId as CountryId]?.name ?? ex.countryId}`,
            exchangeApi: ex.apiKey,
          },
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
