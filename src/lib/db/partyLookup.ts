import type { Db } from "mongodb";
import type { PoliticalParty } from "@/lib/db/types";
import { ALL_COUNTRY_IDS, type CountryId } from "@/lib/constants/countries";

/**
 * Look up a party by its sequential ID and country.
 * Returns null if not found.
 */
export async function findPartyBySequentialId(
  db: Db,
  sequentialId: number | string,
  countryId: CountryId
): Promise<PoliticalParty | null> {
  const seqId = typeof sequentialId === "string" ? parseInt(sequentialId, 10) : sequentialId;
  if (isNaN(seqId)) return null;

  return db.collection<PoliticalParty>("politicalParties").findOne({
    countryId,
    sequentialId: seqId,
  });
}

/**
 * Get the party identifier string (sequentialId as string) for storage.
 */
export function getPartyIdString(party: PoliticalParty): string {
  return String(party.sequentialId);
}

/**
 * Canonical `statePartyOrg._id` / composite key: `{stateId}_{partySequential}`.
 * Always use this after resolving the party — raw URL segments may differ (e.g. "01" vs "1").
 */
export function getStatePartyOrgDocumentId(stateId: string, party: PoliticalParty): string {
  return statePartyOrgIdFor(stateId, getPartyIdString(party));
}

/**
 * The same key from raw parts, for callers that hold a party's sequentialId but
 * not its document — the merge paths, which RE-KEY these rows.
 *
 * Both components are remapped by a reunification (parties are renumbered, and a
 * fused region takes the survivor's id) and a Mongo `_id` is immutable, so those
 * paths must delete and re-insert rather than `$set`. Sharing one builder is
 * what stops the rebuilt key drifting from the one every reader looks up by.
 */
export function statePartyOrgIdFor(stateId: string, partySequentialId: string | number): string {
  return `${stateId}_${partySequentialId}`;
}

/**
 * Parse country from URL parameter or character context.
 * Case-insensitive: accepts "us", "US", "Us", etc.
 */
export function parseCountryParam(param: string | null): CountryId | null {
  if (!param) return null;
  const upper = param.toUpperCase();
  // Validate against ALL configured countries (incl. runtime-activated SCO/WAL),
  // not just COUNTRY_ORDER — otherwise a seceded country's `?country=` is dropped
  // and callers fall back to a wrong-country match (e.g. party logos by seqId).
  return (ALL_COUNTRY_IDS as readonly string[]).includes(upper) ? (upper as CountryId) : null;
}
