import type { CountryEraOverride } from "../../contract";

/**
 * NG, 1953.
 *
 * ⚠ GENERATED from `__snapshots__/ng.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts NG --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const NG_1953: CountryEraOverride = {
  preset: "1953-default",
  config: {
    usdExchangeRate: 1,
    coalitionThreshold: 69,
    legislature: {
      name: "National Assembly",
      path: "/country/ng/legislature",
      bicameral: true,
      upperChamber: {
        key: "senate",
        name: "Senate",
        shortName: "Senate",
        seats: 109,
        description: "Senators elected from constituencies across the Nigerian federation.",
        elected: true,
      },
      lowerChamber: {
        key: "house",
        name: "House of Representatives",
        shortName: "House",
        seats: 136,
        description:
          "136 representatives of the Federal House under the Lyttelton Constitution (1954).",
        elected: true,
      },
    },
  },
};
