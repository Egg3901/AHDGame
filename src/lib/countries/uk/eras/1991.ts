import type { CountryEraOverride } from "../../contract";

/**
 * UK, 1991.
 *
 * ⚠ GENERATED from `__snapshots__/uk.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts UK --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 *
 * ⚠️ `usdExchangeRate` IS SET HERE BECAUSE NO 1991 ERA SET IT. The field is the
 * anchor value of ONE unit of this country's stored seed currency, and its base
 * value is a modern 1.0. `ukRegions1991` authors regional GDP in GBP millions,
 * so the anchor must be the reciprocal of `INITIAL_RATES_1991` (0.57 GBP/USD) — the
 * same table `seedExchangeRates` writes into the `exchangeRates` collection.
 * Left unset, the UK read as a $433B economy against a real ~$1.03T.
 *
 * ⚠️ NOT EVERY COUNTRY TAKES THE RECIPROCAL. RU and NG deliberately do not: RU's
 * 1991 rate is a placeholder for a country this era does not enable, and NG's
 * bundle is ~900x too large for the unit its header claims, so the reciprocal
 * would read Nigeria as a $24 trillion economy. See `gdpAnchorRate1991.test.ts`.
 */
export const UK_1991: CountryEraOverride = {
  preset: "1991-default",
  config: {
    usdExchangeRate: 1.7543859649122808,
    legislature: {
      name: "Parliament",
      path: "/country/uk/legislature",
      bicameral: false,
      upperChamber: {
        key: "lords",
        name: "House of Lords",
        shortName: "Lords",
        seats: 784,
        description: "Appointed and hereditary peers. Revises and scrutinises legislation.",
      },
      lowerChamber: {
        key: "commons",
        name: "House of Commons",
        shortName: "Commons",
        // 650, not 651: this world opens in January 1991, and the 651-seat
        // chamber is the one the 1992 boundary review created. See the header
        // of `ukRegions1991.ts`, whose districts this total must equal.
        seats: 650,
        description:
          "650 elected MPs from single-member constituencies. The primary legislative chamber.",
      },
    },
  },
};
