import type { CountryEraOverride } from "../../contract";

/**
 * DE, 1953.
 *
 * ⚠ GENERATED from `__snapshots__/de.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts DE --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const DE_1953: CountryEraOverride = {
  preset: "1953-default",
  config: {
    usdExchangeRate: 0.23809523809523808,
    coalitionThreshold: 244,
    federalEqualizationGrantPerCapita: 100,
    legislature: {
      name: "Bundestag",
      path: "/country/de/legislature",
      bicameral: true,
      upperChamber: {
        key: "bundesrat",
        name: "Bundesrat",
        shortName: "Bundesrat",
        seats: 69,
        description:
          "Members representing the West German Länder (appointed by state governments).",
      },
      lowerChamber: {
        key: "bundestag",
        name: "Bundestag",
        shortName: "Bundestag",
        seats: 487,
        description:
          "487 members of the 2nd Bundestag (1953) elected via mixed-member proportional representation.",
      },
    },
  },
};
