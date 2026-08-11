import { describe, it, expect } from "vitest";
import { COUNTRY_CONFIGS, ERA_COUNTRY_CONFIG_OVERRIDES, getCountryConfig } from "./countries";
import type { CountryId } from "./countries";
import { FOREX_ACTIVE_COUNTRIES, INITIAL_RATES_1953 } from "./currencies";

/**
 * `usdExchangeRate` for a 1953 world must be the reciprocal of the rate
 * `seedExchangeRates` writes into the `exchangeRates` collection for the same
 * preset — one FX truth, not two. Before this was enforced the two disagreed by
 * up to 83x (FR), and the seeder BAKED the wrong side into `unownedSectors`.
 */
const LOCAL_CURRENCY_1953: CountryId[] = [
  "UK",
  "IE",
  "DE",
  "DD",
  "FR",
  "ES",
  "SE",
  "TR",
  "GR",
  "AT",
  "FI",
  "BR",
  "RU",
];

/**
 * Countries whose 1953 regional GDP is authored in USD millions (refs #3498 —
 * see the header of each `*Regions1953.ts`). They are already ₳-denominated, so
 * 1.0 IS their era-correct normalization; 1/INITIAL_RATES_1953 would read Italy
 * as a $27M economy.
 */
const USD_ANCHORED_1953: CountryId[] = ["IT", "JP", "CN", "NG"];

/** Soviet union republics: GDP authored in Soviet rubles, so they take RU's basis. */
const SOVIET_RUBLE_1953: CountryId[] = ["BLR", "BAL"];

/**
 * Warsaw-Pact / non-aligned satellites (refs #3778 §1). Budget-only economies —
 * deliberately outside `FOREX_ACTIVE_COUNTRIES`, so `seedExchangeRates` writes
 * no `exchangeRates` row for them — but their 1953 GDP→₳ rate is still authored
 * in `INITIAL_RATES_1953` so there is one table to derive the config override
 * from. Per-rate sourcing lives on the constants.
 */
const BLOC_LOCAL_CURRENCY_1953: CountryId[] = ["PL", "CS", "RO", "HU", "YU", "BG"];

/**
 * Σ authored 1953 national seed GDP, in local-currency millions, for the bloc.
 * `reconcileStateGdp` normalizes each country's regions to these, so this IS the
 * `state.gdp` sum the world-organizations GDP table reads. Kept beside the
 * plausibility band it feeds so a magnitude edit in `budgets.ts` trips here.
 */
const BLOC_NATIONAL_SEED_GDP_MILLIONS: Partial<Record<CountryId, number>> = {
  PL: 300_000,
  CS: 200_000,
  RO: 80_000,
  HU: 100_000,
  YU: 100_000,
  BG: 40_000,
};

/** 1953 population from the same seed configs, for the per-capita sanity band. */
const BLOC_POPULATION_1953: Partial<Record<CountryId, number>> = {
  PL: 25_500_000,
  CS: 12_400_000,
  RO: 16_600_000,
  HU: 9_500_000,
  YU: 16_900_000,
  BG: 7_300_000,
};

describe("1953 era usdExchangeRate overrides", () => {
  it("matches the reciprocal of INITIAL_RATES_1953 for local-currency seeds", () => {
    for (const countryId of LOCAL_CURRENCY_1953) {
      const rate = INITIAL_RATES_1953[countryId];
      expect(rate, `INITIAL_RATES_1953.${countryId}`).toBeGreaterThan(0);
      expect(
        getCountryConfig(countryId, "1953-default").usdExchangeRate,
        `${countryId} 1953 usdExchangeRate`
      ).toBe(1 / rate!);
    }
  });

  it("keeps USD-anchored 1953 seeds at 1.0", () => {
    for (const countryId of USD_ANCHORED_1953) {
      expect(getCountryConfig(countryId, "1953-default").usdExchangeRate).toBe(1);
    }
  });

  it("normalizes the Soviet union republics on RU's rouble basis", () => {
    for (const countryId of SOVIET_RUBLE_1953) {
      expect(getCountryConfig(countryId, "1953-default").usdExchangeRate).toBe(
        1 / INITIAL_RATES_1953.RU!
      );
    }
  });

  it("puts the 1953 world economy in a historically plausible order", () => {
    // ₳ ≈ 1953 USD. Sanity band: every modelled economy is smaller than the US,
    // and the USSR lands in the 30-50% band the RU seed is calibrated to.
    const usdGdp = (countryId: CountryId, localMillions: number) =>
      localMillions * getCountryConfig(countryId, "1953-default").usdExchangeRate;
    const us = usdGdp("US", 387_000);
    // Local-currency national seed GDPs (millions) from budgets.ts 1953 configs.
    for (const [countryId, local] of [
      ["FR", 16_450_000],
      ["RU", 1_400_000],
      ["UK", 14_400],
      ["DE", 138_000],
      ["FI", 790_000],
    ] as Array<[CountryId, number]>) {
      expect(usdGdp(countryId, local), `${countryId} vs US`).toBeLessThan(us);
    }
    const ruShare = usdGdp("RU", 1_400_000) / us;
    expect(ruShare).toBeGreaterThan(0.3);
    expect(ruShare).toBeLessThan(0.5);
  });

  it("authors a 1953 rate for every Warsaw-Pact / non-aligned satellite", () => {
    for (const countryId of BLOC_LOCAL_CURRENCY_1953) {
      const rate = INITIAL_RATES_1953[countryId];
      expect(rate, `INITIAL_RATES_1953.${countryId}`).toBeGreaterThan(0);
      expect(
        getCountryConfig(countryId, "1953-default").usdExchangeRate,
        `${countryId} 1953 usdExchangeRate`
      ).toBe(1 / rate!);
      // The override must actually MOVE the country off its era-blind base
      // config — that base is a 1979 rate (or, for BG, a lev-at-dollar-par 1.0).
      expect(
        getCountryConfig(countryId, "1953-default").usdExchangeRate,
        `${countryId} still on its base rate`
      ).not.toBe(COUNTRY_CONFIGS[countryId].usdExchangeRate);
    }
  });

  it("leaves the bloc OUT of the forex-active roster", () => {
    // Authoring a config-side GDP normalizer must not turn these into tradable,
    // convertible currencies — `seedExchangeRates` iterates this list.
    for (const countryId of BLOC_LOCAL_CURRENCY_1953) {
      expect(FOREX_ACTIVE_COUNTRIES, countryId).not.toContain(countryId);
    }
  });

  it("puts every bloc economy at a plausible 1953 size", () => {
    const usdGdp = (countryId: CountryId) =>
      BLOC_NATIONAL_SEED_GDP_MILLIONS[countryId]! *
      getCountryConfig(countryId, "1953-default").usdExchangeRate;

    // In-world yardsticks, ₳m: the 1953 United States and West Germany.
    const us = 387_000;
    const westGermany = 138_000 * getCountryConfig("DE", "1953-default").usdExchangeRate;
    // The GDR, the closest comparable command economy, at ~$647 per head.
    const gdrPerCapita =
      (50_000 * getCountryConfig("DD", "1953-default").usdExchangeRate * 1_000_000) / 18_400_000;

    for (const countryId of BLOC_LOCAL_CURRENCY_1953) {
      const gdp = usdGdp(countryId);
      // The headline regression: Bulgaria read as a $40B economy, larger than
      // West Germany, off a lev-at-dollar-par base rate.
      expect(gdp, `${countryId} vs West Germany`).toBeLessThan(westGermany);
      expect(gdp, `${countryId} vs US`).toBeLessThan(us * 0.1);
      expect(gdp, `${countryId} is not vanishing`).toBeGreaterThan(1_000);

      // No satellite may read richer per head than the GDR, and none may read
      // as a subsistence economy either. Wide band on purpose — these are
      // administered-rate conversions of plan accounting, not measurements.
      const perCapita = (gdp * 1_000_000) / BLOC_POPULATION_1953[countryId]!;
      expect(perCapita, `${countryId} per capita vs GDR`).toBeLessThan(gdrPerCapita);
      expect(perCapita, `${countryId} per capita floor`).toBeGreaterThan(gdrPerCapita * 0.3);
    }

    // Ordering that matters: Czechoslovakia was the richest satellite per head,
    // Poland the largest in total.
    const perCapita = (c: CountryId) => (usdGdp(c) * 1_000_000) / BLOC_POPULATION_1953[c]!;
    expect(perCapita("CS")).toBeGreaterThan(perCapita("PL"));
    expect(perCapita("CS")).toBeGreaterThan(perCapita("BG"));
    for (const other of ["CS", "RO", "HU", "YU", "BG"] as CountryId[]) {
      expect(usdGdp("PL"), `PL vs ${other}`).toBeGreaterThan(usdGdp(other));
    }
  });

  it("changes nothing outside the 1953 preset", () => {
    const presets = [
      "1979-default",
      "1991-default",
      "1999-default",
      "2007-default",
      "2019-default",
      "2023-default",
    ];
    for (const preset of presets) {
      for (const countryId of Object.keys(COUNTRY_CONFIGS) as CountryId[]) {
        expect(
          getCountryConfig(countryId, preset).usdExchangeRate,
          `${countryId} @ ${preset}`
        ).toBe(COUNTRY_CONFIGS[countryId].usdExchangeRate);
      }
    }
    // Only the 1953 table carries usdExchangeRate overrides at all.
    for (const [preset, table] of Object.entries(ERA_COUNTRY_CONFIG_OVERRIDES)) {
      if (preset === "1953-default") continue;
      for (const override of Object.values(table)) {
        expect(override?.usdExchangeRate).toBeUndefined();
      }
    }
  });
});
