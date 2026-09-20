import type { CountryEraOverride } from "../../contract";

/**
 * Japan, 1991. Phase D3.
 *
 * ⚠️ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * Config override: legislature.
 *
 * ⚠️ getCountryConfig is a SHALLOW merge, so supplying `legislature` replaces the
 * WHOLE object. A partial one would silently drop chamber keys, names and
 * descriptions with nothing failing loudly.
 *
 * ⚠️ `usdExchangeRate` IS SET HERE BECAUSE NO 1991 ERA SET IT. The field is the
 * anchor value of ONE unit of this country's stored seed currency, and its base
 * value is 0.00943, which is 1/106 — the 2019 rate. `jpRegions1991` authors regional GDP in JPY millions,
 * so the anchor must be the reciprocal of `INITIAL_RATES_1991` (134.5 JPY/USD) — the
 * same table `seedExchangeRates` writes into the `exchangeRates` collection.
 * Left unset, Japan read as a $4.15T economy against a real ~$3.53T.
 *
 * ⚠️ NOT EVERY COUNTRY TAKES THE RECIPROCAL. RU and NG deliberately do not: RU's
 * 1991 rate is a placeholder for a country this era does not enable, and NG's
 * bundle is ~900x too large for the unit its header claims, so the reciprocal
 * would read Nigeria as a $24 trillion economy. See `gdpAnchorRate1991.test.ts`.
 */
export const JP_1991: CountryEraOverride = {
  preset: "1991-default",
  config: {
    usdExchangeRate: 0.007434944237918215,
    legislature: {
      name: "Kokkai",
      path: "/country/jp/legislature",
      bicameral: true,
      upperChamber: {
        key: "sangiin",
        name: "Sangiin",
        shortName: "Sangiin",
        seats: 252,
        description:
          "252 councillors elected on staggered 6-year terms. Half are contested every 3 years. Cannot be dissolved.",
        elected: true,
      },
      lowerChamber: {
        key: "shugiin",
        name: "Shūgiin",
        shortName: "Shūgiin",
        seats: 512,
        description:
          "512 members elected from multi-member constituencies under the pre-1994 system.",
      },
    },
  },
  institutions: {
    military: {
      ordersOfBattle: [
        {
          branchId: "jgsdf",
          type: "Infantry Division",
          count: 6,
        },
        {
          branchId: "jgsdf",
          type: "Mechanized Brigade",
          count: 2,
        },
        {
          branchId: "jgsdf",
          type: "Artillery Regiment",
          count: 2,
        },
        {
          branchId: "jgsdf",
          type: "Air Defense Battalion",
          count: 2,
        },
        {
          branchId: "jmsdf",
          type: "Frigate Squadron",
          count: 5,
        },
        {
          branchId: "jmsdf",
          type: "Attack Submarine",
          count: 4,
        },
        {
          branchId: "jmsdf",
          type: "Guided-Missile Destroyer",
          count: 3,
        },
        {
          branchId: "jasdf",
          type: "Fighter Wing",
          count: 4,
        },
        {
          branchId: "jasdf",
          type: "Air Defense Wing",
          count: 2,
        },
        {
          branchId: "jasdf",
          type: "Airlift Wing",
          count: 1,
        },
      ],
    },
  },
};
