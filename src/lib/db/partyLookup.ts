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
  return `${stateId}_${getPartyIdString(party)}`;
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
