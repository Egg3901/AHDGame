// Shared Leader-of-the-Opposition resolution.
//
// The executive hub (ParliamentaryExecutiveHub.tsx) renders the Opposition
// Leader plaque, and the shadow-cabinet route authorizes appointments against
// the SAME signal. Both funnel through `resolveOppositionLeaderFromState` here
// so the route can never drift to a weaker check than the hub displays.

import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { ElectedOfficial, PoliticalParty } from "@/lib/db/types";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { ParliamentaryGovernment } from "@/lib/db/types/parliamentaryGovernment";
import { type CountryId } from "@/lib/constants/countries";
import { getLowerChamberOfficeType } from "@/lib/legislature/chamberOfficeType";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import {
  resolveGoverningPartyIdsFromDocuments,
  resolveOppositionLeader,
} from "@/lib/turn/parliamentaryGovernment";

export interface ResolvedOppositionLeader {
  /** Character id of the Leader of the Opposition (party or coalition chair). */
  chairId: ObjectId;
  /** The single opposition party, or a coalition's largest member. May be null. */
  partyDoc: PoliticalParty | null;
}

/**
 * Resolve the Leader of the Opposition from already-loaded parliamentary state.
 *
 * This mirrors exactly what the executive hub does when it renders the
 * Opposition Leader plaque: union the governing bloc via
 * `resolveGoverningPartyIdsFromDocuments`, then select the largest non-governing
 * party/coalition that has a resolvable chair via `resolveOppositionLeader`.
 * Gated on a governing party existing (matching the hub's `if (govPartyId)`),
 * so a country with no formed government surfaces no Opposition Leader.
 */
export async function resolveOppositionLeaderFromState(
  db: Db,
  countryId: CountryId,
  seatsByParty: Record<string, number>,
  partyBySeq: Map<string, PoliticalParty>,
  govFormation: Pick<
    GovernmentFormation,
    "governingPartyId" | "coalitionPartyIds" | "coalitionId"
  > | null,
  parlGov: Pick<ParliamentaryGovernment, "governingPartyId"> | null
): Promise<ResolvedOppositionLeader | null> {
  const govPartyId = govFormation?.governingPartyId ?? parlGov?.governingPartyId ?? null;
  if (!govPartyId) return null;

  const govPartyIds = await resolveGoverningPartyIdsFromDocuments(
    db,
    countryId,
    govFormation,
    parlGov
  );
  return resolveOppositionLeader(db, countryId, seatsByParty, govPartyIds, partyBySeq);
}

/**
 * Self-contained Opposition Leader resolution from `(db, countryId)`.
 *
 * Loads the same inputs the hub computes inline — the lower-chamber seat tally,
 * the country's party docs, and the government-formation documents — then
 * delegates to {@link resolveOppositionLeaderFromState}. Used by the
 * shadow-cabinet route, which starts from only the country code.
 */
export async function resolveOppositionLeaderForCountry(
  db: Db,
  countryId: CountryId
): Promise<ResolvedOppositionLeader | null> {
  const lowerChamberKey = getLowerChamberOfficeType(countryId);

  const [govFormation, parlGov, lowerOfficials, partyDocs] = await Promise.all([
    getGovernmentFormationsCollection(db).findOne({ _id: countryId }),
    db.collection<ParliamentaryGovernment>("parliamentaryGovernments").findOne({ _id: countryId }),
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ officeType: lowerChamberKey, countryId })
      .toArray(),
    db.collection<PoliticalParty>("politicalParties").find({ countryId }).toArray(),
  ]);

  // Seat composition from the lower chamber — identical to the hub's tally.
  const seatsByParty: Record<string, number> = {};
  for (const official of lowerOfficials) {
    if (!official.party) continue;
    seatsByParty[official.party] = (seatsByParty[official.party] ?? 0) + (official.seatsHeld ?? 1);
  }

  const partyBySeq = new Map(partyDocs.map((p) => [String(p.sequentialId), p]));

  return resolveOppositionLeaderFromState(
    db,
    countryId,
    seatsByParty,
    partyBySeq,
    govFormation,
    parlGov
  );
}
