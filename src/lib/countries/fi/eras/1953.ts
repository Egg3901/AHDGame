import type { CountryEraOverride } from "../../contract";

/**
 * FI, 1953.
 *
 * ⚠ GENERATED from `__snapshots__/fi.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts FI --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const FI_1953: CountryEraOverride = {
  preset: "1953-default",
  config: {
    usdExchangeRate: 0.004347826086956522,
    majorPartyIds: ["fi_ml", "fi_sdp"],
    tagline:
      "The republic that paid its way out — reparations to Moscow delivered, Karelian evacuees resettled, and the Paasikivi line holding a precarious neutrality while agrarian-social democratic coalitions rebuild.",
    descriptor:
      "A parliamentary republic where a Prime Minister governs at the confidence of the unicameral 200-seat Eduskunta, under a presidency that owns the delicate relationship with the Soviet Union.",
  },
};
