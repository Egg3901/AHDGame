import { describe, expect, it } from "vitest";
import {
  isWesternizedCountry,
  partitionForexRates,
  playerCurrencyCodes,
  type ForexCountryAccess,
} from "./partitionForexCurrencies";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";

function rate(countryId: CountryId, currencyCode: CurrencyCode) {
  return { countryId, currencyCode };
}

const ACCESS_1953: Partial<Record<CountryId, ForexCountryAccess>> = {
  US: { enabledForPlayers: true, economyPreview: false, econOnly: false },
  UK: { enabledForPlayers: true, economyPreview: false, econOnly: false },
  RU: { enabledForPlayers: true, economyPreview: false, econOnly: false },
  DD: { enabledForPlayers: true, economyPreview: false, econOnly: false },
  DE: { enabledForPlayers: false, economyPreview: true, econOnly: true },
  FR: { enabledForPlayers: false, economyPreview: true, econOnly: true },
  JP: { enabledForPlayers: false, economyPreview: true, econOnly: true },
  CN: { enabledForPlayers: false, economyPreview: true, econOnly: true },
  BR: { enabledForPlayers: false, economyPreview: true, econOnly: true },
  NG: { enabledForPlayers: false, economyPreview: true, econOnly: true },
};

describe("isWesternizedCountry", () => {
  it("treats market economies as westernized", () => {
    expect(isWesternizedCountry("US")).toBe(true);
    expect(isWesternizedCountry("DE")).toBe(true);
    expect(isWesternizedCountry("JP")).toBe(true);
  });

  it("treats planned-schedule countries as non-westernized", () => {
    expect(isWesternizedCountry("RU")).toBe(false);
    expect(isWesternizedCountry("DD")).toBe(false);
    expect(isWesternizedCountry("CN")).toBe(false);
  });
});

describe("partitionForexRates", () => {
  const rates = [
    rate("CN", "CNY"),
    rate("US", "USD"),
    rate("DE", "EUR"),
    rate("UK", "GBP"),
    rate("JP", "JPY"),
    rate("RU", "SUR"),
    rate("DD", "DDM"),
    rate("FR", "FRF"),
    rate("BR", "BRL"),
  ];

  it("keeps only player-enabled countries in the primary list", () => {
    const { player, other } = partitionForexRates(rates, ACCESS_1953);
    expect(player.map((r) => r.currencyCode)).toEqual(["USD", "GBP", "SUR", "DDM"]);
    expect(other.map((r) => r.currencyCode)).not.toContain("USD");
  });

  it("orders other currencies with westernized econ-only before planned", () => {
    const { other } = partitionForexRates(rates, ACCESS_1953);
    expect(other.map((r) => r.currencyCode)).toEqual(["JPY", "EUR", "BRL", "FRF", "CNY"]);
  });

  it("falls back to all rates when access is missing", () => {
    const { player, other } = partitionForexRates(rates, null);
    expect(player).toHaveLength(rates.length);
    expect(other).toHaveLength(0);
  });

  it("falls back to all rates when no player match exists", () => {
    const access: Partial<Record<CountryId, ForexCountryAccess>> = {
      DE: { enabledForPlayers: false, economyPreview: true, econOnly: true },
    };
    const { player, other } = partitionForexRates([rate("DE", "EUR")], access);
    expect(player.map((r) => r.currencyCode)).toEqual(["EUR"]);
    expect(other).toHaveLength(0);
  });
});

describe("playerCurrencyCodes", () => {
  it("returns the four 1953 player currencies", () => {
    const codes = playerCurrencyCodes(
      [
        rate("US", "USD"),
        rate("UK", "GBP"),
        rate("RU", "SUR"),
        rate("DD", "DDM"),
        rate("JP", "JPY"),
      ],
      ACCESS_1953
    );
    expect(codes).toEqual(["USD", "GBP", "SUR", "DDM"]);
  });
});
