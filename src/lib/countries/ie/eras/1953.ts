import type { CountryEraOverride } from "../../contract";

/**
 * IE, 1953.
 *
 * ⚠ GENERATED from `__snapshots__/ie.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts IE --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const IE_1953: CountryEraOverride = {
  preset: "1953-default",
  config: {
    usdExchangeRate: 2.801120448179272,
    coalitionThreshold: 74,
    legislature: {
      name: "Oireachtas",
      path: "/country/ie/legislature",
      bicameral: false,
      upperChamber: {
        key: "seanad",
        name: "Seanad Éireann",
        shortName: "Seanad",
        seats: 60,
        description:
          "60 senators - 43 elected from vocational panels, 11 nominated by the Taoiseach, 6 from universities.",
      },
      lowerChamber: {
        key: "dail",
        name: "Dáil Éireann",
        shortName: "Dáil",
        seats: 147,
        description:
          "147 TDs elected by PR-STV across multi-seat constituencies (1948 redistribution).",
        elected: true,
      },
    },
  },
};
