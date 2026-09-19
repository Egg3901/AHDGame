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
 */
export const UK_1991: CountryEraOverride = {
  preset: "1991-default",
  config: {
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
