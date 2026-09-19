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
        seats: 651,
        description:
          "651 elected MPs from single-member constituencies. The primary legislative chamber.",
      },
    },
  },
};
