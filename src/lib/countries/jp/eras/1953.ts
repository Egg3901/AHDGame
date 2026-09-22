import type { CountryEraOverride } from "../../contract";

/**
 * Japan, 1953. Phase D3.
 *
 * ⚠️ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * Config override: usdExchangeRate, majorPartyIds, coalitionThreshold, legislature.
 *
 * ⚠️ getCountryConfig is a SHALLOW merge, so supplying `legislature` replaces the
 * WHOLE object. A partial one would silently drop chamber keys, names and
 * descriptions with nothing failing loudly.
 *
 * No era orders of battle: ORDERS_OF_BATTLE_BY_ERA starts at 1979, so this
 * era falls back to the base set in institutions.ts.
 */
export const JP_1953: CountryEraOverride = {
  preset: "1953-default",
  config: {
    usdExchangeRate: 1,
    majorPartyIds: ["ryo", "jsp"],
    coalitionThreshold: 234,
    legislature: {
      name: "Kokkai",
      path: "/country/jp/legislature",
      bicameral: true,
      upperChamber: {
        key: "sangiin",
        name: "Sangiin",
        shortName: "Sangiin",
        seats: 248,
        description:
          "248 councillors elected on staggered 6-year terms. Half are contested every 3 years. Cannot be dissolved.",
        elected: true,
      },
      lowerChamber: {
        key: "shugiin",
        name: "Shūgiin",
        shortName: "Shūgiin",
        seats: 466,
        description:
          "466 members elected in the April 1953 general election from regional constituencies.",
      },
    },
  },
};
