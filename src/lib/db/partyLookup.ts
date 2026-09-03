import type { Db } from "mongodb";
import type { PoliticalParty, StatePartyOrg } from "@/lib/db/types";
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
 * Resolve a party's `statePartyOrg` row for (country, state, party), tolerating
 * rows whose compound `_id` drifted from `{stateId}_{partyId}`.
 *
 * WHY THE FALLBACK EXISTS. The collection has TWO row identities: the compound
 * `_id` string and the `{countryId, stateId, partyId}` field triple, and live
 * code reads both ways. A party renumber (country merge), a region fuse, or an
 * older writer can leave a row whose `_id` suffix names a different party (or
 * region) than its fields — ticket #1256: SED's Build Org poached SPD's row
 * because `_id NW_1` held SPD's org under `partyId: "6"` while SED's numbers
 * sat on `_id NW_7`. Reads that only match the field triple and reads that only
 * match `_id` then disagree about who owns the row.
 *
 * The field triple is authoritative: it is what the country-scoped queries, the
 * Build Org poach pass, and the state breakdown all join on. The `_id` probe
 * catches the pre-migration rows so a caller never reads 0 org for a party
 * whose numbers are sitting on a stale key. Returns the row as stored; the
 * repair (renaming `_id` to the canonical key) happens on the write paths and
 * in the backfill migration, not here.
 */
export async function findStatePartyOrgRow(
  db: Db,
  countryId: CountryId,
  stateId: string,
  party: Pick<PoliticalParty, "sequentialId">
): Promise<StatePartyOrg | null> {
  const col = db.collection<StatePartyOrg>("statePartyOrg");
  const partyId = getPartyIdString(party as PoliticalParty);
  const byFields = await col.findOne({ countryId, stateId, partyId });
  if (byFields) return byFields;
  return col.findOne({ _id: getStatePartyOrgDocumentId(stateId, party as PoliticalParty) });
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
