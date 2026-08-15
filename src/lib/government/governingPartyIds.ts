import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Coalition } from "@/lib/db/types/coalition";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { ParliamentaryGovernment } from "@/lib/db/types/parliamentaryGovernment";

/** Resolve every party participating in the current national government. */
export async function resolveGoverningPartyIdsFromDocuments(
  db: Db,
  countryId: CountryId,
  govFormation: Pick<
    GovernmentFormation,
    "governingPartyId" | "coalitionPartyIds" | "coalitionId"
  > | null,
  parlGov: Pick<ParliamentaryGovernment, "governingPartyId" | "coalitionPartyIds"> | null
): Promise<Set<string>> {
  const governingPartyId = govFormation?.governingPartyId ?? parlGov?.governingPartyId ?? null;
  if (!governingPartyId) return new Set();

  const explicitPartners = govFormation?.coalitionPartyIds ?? parlGov?.coalitionPartyIds;
  if (explicitPartners && explicitPartners.length > 0) {
    return new Set([governingPartyId, ...explicitPartners]);
  }

  const coalitionId = govFormation?.coalitionId;
  if (coalitionId != null) {
    const coalition = await db
      .collection<Coalition>("coalitions")
      .findOne({ sequentialId: coalitionId, countryId });
    if (coalition?.members?.length) {
      return new Set([
        governingPartyId,
        ...coalition.members.map((member) => String(member.partySequentialId)),
      ]);
    }
  }

  // Some minority formations store their supporting bloc only in `coalitions`.
  // A coalition led by the governing party is part of the government; an
  // opposition-led coalition is not.
  const coalitions = await db.collection<Coalition>("coalitions").find({ countryId }).toArray();
  const governingCoalition = coalitions.find(
    (coalition) =>
      coalition.members?.length > 0 &&
      String(coalition.members[0]?.partySequentialId) === governingPartyId
  );
  if (governingCoalition) {
    return new Set([
      governingPartyId,
      ...governingCoalition.members.map((member) => String(member.partySequentialId)),
    ]);
  }

  return new Set([governingPartyId]);
}

/** Load the active formation documents and resolve the national government. */
export async function resolveGoverningPartyIds(db: Db, countryId: CountryId): Promise<Set<string>> {
  const [formation, parliamentary] = await Promise.all([
    db.collection<GovernmentFormation>("governmentFormations").findOne({ _id: countryId }),
    db.collection<ParliamentaryGovernment>("parliamentaryGovernments").findOne({
      _id: countryId,
    }),
  ]);
  return resolveGoverningPartyIdsFromDocuments(db, countryId, formation, parliamentary);
}
