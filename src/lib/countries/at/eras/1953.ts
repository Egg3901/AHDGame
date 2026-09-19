import type { CountryEraOverride } from "../../contract";

/**
 * AT, 1953.
 *
 * ⚠ GENERATED from `__snapshots__/at.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts AT --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const AT_1953: CountryEraOverride = {
  preset: "1953-default",
  config: {
    usdExchangeRate: 0.038461538461538464,
    coalitionThreshold: 83,
    legislature: {
      name: "Nationalrat",
      path: "/country/at/legislature",
      bicameral: false,
      lowerChamber: {
        key: "nationalrat",
        name: "Nationalrat",
        shortName: "Nationalrat",
        seats: 165,
        description:
          "165 deputies of the Nationalrat (the pre-1971 chamber size), elected by proportional representation under the ÖVP–SPÖ grand coalition.",
        elected: true,
      },
    },
    tagline:
      "An occupied republic between the blocs — the ÖVP–SPÖ grand coalition rebuilds under four-power occupation, bargaining toward the State Treaty and permanent neutrality.",
    descriptor:
      "A parliamentary republic where a Chancellor governs at the confidence of the unicameral 165-seat Nationalrat, while Allied occupation zones still divide the country.",
  },
};
