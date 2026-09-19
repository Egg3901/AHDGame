import type { CountryEraOverride } from "../../contract";

/**
 * BR, 1953.
 *
 * ⚠ GENERATED from `__snapshots__/br.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts BR --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const BR_1953: CountryEraOverride = {
  preset: "1953-default",
  config: {
    usdExchangeRate: 0.05319148936170213,
    coalitionThreshold: 153,
    legislature: {
      name: "National Congress",
      path: "/country/br/legislature",
      bicameral: true,
      upperChamber: {
        key: "senate",
        name: "Federal Senate",
        shortName: "Senate",
        seats: 81,
        description:
          "81 senators - three per state - serving eight-year staggered terms. Reviews legislation from the Chamber.",
        elected: true,
      },
      lowerChamber: {
        key: "chamber",
        name: "Chamber of Deputies",
        shortName: "Chamber",
        seats: 304,
        description:
          "304 deputies of the 1950 legislature elected by open-list proportional representation.",
        elected: true,
      },
    },
  },
};
