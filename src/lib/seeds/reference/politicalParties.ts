import type { PoliticalParty } from "@/lib/db/types";

/**
 * Party seed data type - excludes fields generated at insert time.
 * seedOrder determines the sequentialId assignment order.
 */
export type PartySeed = Omit<PoliticalParty, "_id" | "sequentialId" | "createdAt" | "updatedAt"> & {
  seedOrder: number;
  /**
   * When set, this party is only seeded for the listed preset IDs (e.g.
   * `["1991-default"]` for UUP — the historically-dominant unionist
   * party in NI pre-1998 that doesn't fit a 2019 roster). When omitted,
   * the party is preset-agnostic (the common case).
   *
   * `ensureDefaultParties` and `seedUKParties` skip parties whose
   * `validForPresets` excludes the current preset, and `resetGameWorld`
   * deletes default parties whose `validForPresets` no longer matches
   * the new preset on reset.
   */
  validForPresets?: string[];
};

/**
 * The United States' default parties.
 *
 * ⚠️ A FORWARDER, NOT A COPY. The rows now live in
 * `@/lib/countries/us/data/usParties`, beside every other country's roster.
 * This export stays so the wiki dashboard and `finalizeResetGameWorld` are
 * untouched, and because dropping it would silently remove the US default
 * parties from a reset.
 *
 * ⚠️ `PartySeed` ABOVE IS SHARED AND STAYS HERE. Every country's roster
 * imports it, including `jp/data/jpParties.ts`. Moving the TYPE into one
 * country's folder would make 23 other countries depend on the United States
 * to describe a party, which is the mixing this split exists to undo.
 */
export { usParties as politicalParties } from "@/lib/countries/us/data/usParties";
