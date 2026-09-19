import type { CountryEraOverride } from "../../contract";

/**
 * IT, 1953.
 *
 * ⚠ GENERATED from `__snapshots__/it.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts IT --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const IT_1953: CountryEraOverride = {
  preset: "1953-default",
  config: {
    usdExchangeRate: 1,
    coalitionThreshold: 296,
    legislature: {
      name: "Parliament",
      path: "/country/it/legislature",
      bicameral: true,
      upperChamber: {
        key: "senato",
        name: "Senate of the Republic",
        shortName: "Senato",
        seats: 280,
        description:
          "280 elected senators on a regional basis for five-year terms (1953 First Republic apportionment).",
        elected: true,
      },
      lowerChamber: {
        key: "cameraDeputati",
        name: "Chamber of Deputies",
        shortName: "Camera",
        seats: 590,
        description:
          "590 deputies elected by proportional representation (Camera size in force 1948–1963).",
        elected: true,
      },
    },
  },
};
