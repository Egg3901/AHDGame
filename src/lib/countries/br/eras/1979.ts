import type { CountryEraOverride } from "../../contract";

/**
 * BR, 1979.
 *
 * ⚠ GENERATED from `__snapshots__/br.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts BR --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * Presidential renewal uses the modeled congressional college in this era.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const BR_1979: CountryEraOverride = {
  preset: "1979-default",
  config: {
    electionSystems: {
      lowerChamber: "pr_hareQuota",
      upperChamber: "fptp",
      headOfState: "parliamentary",
    },
  },
};
