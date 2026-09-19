import type { CountryEraOverride } from "../../contract";

/**
 * UK, 1953.
 *
 * ⚠ GENERATED from `__snapshots__/uk.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts UK --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const UK_1953: CountryEraOverride = {
  preset: "1953-default",
  config: {
    usdExchangeRate: 2.801120448179272,
    coalitionThreshold: 313,
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
        seats: 625,
        description:
          "625 elected MPs from single-member constituencies (1950–1955 redistribution). The primary legislative chamber.",
      },
    },
  },
};
