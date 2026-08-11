import { createHash } from "crypto";
import { ObjectId } from "mongodb";

/**
 * Deterministic ObjectId for a country, used as `EventInstance.scopeId` /
 * `EventCooldownLedger.scopeId` for scope "country".
 *
 * The event substrate's document shapes type `scopeId` as `ObjectId` (it was
 * built character-first, where scopeId is the character's real `_id`).
 * Countries are keyed by their string `CountryId` everywhere else in the
 * codebase (federalBudget, governmentApprovals, centralBanks, …), so there is
 * no natural ObjectId to reuse. This hashes the countryId into a stable
 * 12-byte ObjectId instead of widening `scopeId` to `ObjectId | string`
 * across every character-scope call site.
 *
 * The real countryId string is carried separately in `instance.payload.countryId`
 * for effect application and decision routing — this id is only a lookup key
 * for the pending-event / cooldown-ledger collections.
 */
export function countryScopeId(countryId: string): ObjectId {
  const hex = createHash("md5").update(`worldEvent:${countryId}`).digest("hex").slice(0, 24);
  return new ObjectId(hex);
}
