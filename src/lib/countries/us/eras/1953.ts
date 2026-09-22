import type { CountryEraOverride } from "../../contract";

/**
 * US, 1953.
 *
 * ⚠ GENERATED from `__snapshots__/us.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts US --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const US_1953: CountryEraOverride = {
  preset: "1953-default",
  config: {
    legislature: {
      name: "Congress",
      path: "/country/us/legislature",
      bicameral: true,
      upperChamber: {
        key: "senate",
        name: "Senate",
        shortName: "Senate",
        seats: 96,
        description: "96 senators from 48 states, six-year staggered terms.",
        elected: true,
        regionElectedClasses: true,
      },
      lowerChamber: {
        key: "house",
        name: "House of Representatives",
        shortName: "House",
        seats: 435,
        description: "435 representatives, two-year terms. All revenue bills originate here.",
      },
    },
  },
};
