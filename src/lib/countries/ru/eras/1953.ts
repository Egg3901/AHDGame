import type { CountryEraOverride } from "../../contract";

/**
 * RU, 1953.
 *
 * ⚠ GENERATED from `__snapshots__/ru.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts RU --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const RU_1953: CountryEraOverride = {
  preset: "1953-default",
  config: {
    usdExchangeRate: 0.1111111111111111,
    coalitionThreshold: 355,
    legislature: {
      name: "Supreme Soviet",
      path: "/country/ru/legislature",
      bicameral: true,
      upperChamber: {
        key: "sovietOfNationalities",
        name: "Soviet of Nationalities",
        shortName: "Nationalities",
        elected: true,
        seats: 515,
        description:
          "Deputies representing the union republics and autonomous republics of the Soviet Union.",
      },
      lowerChamber: {
        key: "sovietOfTheUnion",
        name: "Soviet of the Union",
        shortName: "Union",
        seats: 526,
        description:
          "526 deputies of the Soviet of the Union (RU's share of the 1954 convocation), elected by population.",
      },
    },
  },
};
