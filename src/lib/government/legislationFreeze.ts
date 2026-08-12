/**
 * Legislation freeze predicate (S#17).
 *
 * A parliamentary country whose government is `pending` (awaiting PM formation)
 * has its legislation frozen. This module holds the *rule* — who is frozen and
 * when — with no HTTP or turn-loop dependencies, so both sides of the game can
 * ask the same question and cannot drift apart:
 *
 * - Player paths go through {@link import("@/lib/api/parliamentaryFreeze").checkLegislationFreeze},
 *   which wraps this in a 400 response.
 * - NPP autonomous bill sponsorship calls this directly to skip the country
 *   (`src/lib/turn/npp/billSponsorship.ts`).
 *
 * Non-parliamentary countries (US, CA) are never frozen. `onePartyState`
 * counts as parliamentary — DD/CN/RU seat a head of government the same way.
 * A parliamentary country with no formation doc is not frozen either (first
 * boot / unseeded countries).
 */
import type { Db } from "mongodb";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { COUNTRY_CONFIGS, isParliamentarySystem, type CountryId } from "@/lib/constants/countries";

/** Player-facing copy for the freeze; shared so the NPP log and the API agree. */
export const LEGISLATION_FREEZE_MESSAGE =
  "Government is in formation; legislation is frozen until a PM is seated";

/**
 * True when `countryId` currently has its legislation frozen pending government
 * formation.
 */
export async function isLegislationFrozen(db: Db, countryId: CountryId): Promise<boolean> {
  if (!isParliamentarySystem(COUNTRY_CONFIGS[countryId])) return false;

  const gov = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
  return gov?.status === "pending";
}
