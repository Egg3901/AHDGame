import { ObjectId, type Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import type { Bill } from "@/lib/db/types";
import type { InternationalOrganizationProvision } from "@/lib/db/types/legislation";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

/**
 * Create a national-legislature bill carrying an `international_organization`
 * provision (join / fund), through the country's normal lower-chamber lifecycle.
 * Mirrors the withdrawal-bill insert in `proposeLeave`. The bill carries no
 * action-point cost (`proposalActionCost: 0`) — these are raised by an org-page
 * action whose own gating (e.g. the join diplomatic action) is the cost.
 * Returns the new bill id.
 */
export async function buildMembershipBill(params: {
  db: Db;
  countryId: CountryId;
  sponsor: { characterId: ObjectId; characterName: string; party?: string };
  title: string;
  summary: string;
  fullText: string;
  provisions: InternationalOrganizationProvision[];
}): Promise<ObjectId> {
  const { db, countryId, sponsor, title, summary, fullText, provisions } = params;
  const lowerChamberKey = COUNTRY_CONFIGS[countryId].legislature.lowerChamber.key;
  const nationalStateId = getNationalDocId(countryId) ?? `${countryId.toLowerCase()}_national`;
  const now = new Date();
  const currentTurn = await getCurrentTurn(db);
  const billId = new ObjectId();

  await db.collection<Bill>("bills").insertOne({
    _id: billId,
    countryId,
    stateId: nationalStateId,
    title,
    summary,
    fullText,
    originChamber: lowerChamberKey,
    currentChamber: lowerChamberKey,
    sponsorId: sponsor.characterId,
    sponsorName: sponsor.characterName,
    sponsorParty: sponsor.party ?? undefined,
    status: "active",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    category: "foreign policy",
    provisions,
    proposalActionCost: 0,
    proposedAt: now,
    votingStartedAt: now,
    votingEndsAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    votingEndsOnTurn: currentTurn + 24,
    createdAt: now,
    updatedAt: now,
  });

  return billId;
}
