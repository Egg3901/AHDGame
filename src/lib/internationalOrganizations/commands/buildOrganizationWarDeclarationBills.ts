import { ObjectId, type Db } from "mongodb";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getNationalStateId } from "@/lib/policy/nationalStateId";
import type { Bill, DeclareWarProvision } from "@/lib/db/types/legislation";
import { getJointSittingOfficeTypes } from "@/lib/legislature/chamberOfficeType";
import { notifyBillsVoteOpen } from "@/lib/turn/billLifecycle/lifecycleHelpers";
import { warGoalLabel } from "@/lib/military/warGoals";

const WAR_DECLARATION_VOTE_HOURS = 24;

export interface OrganizationWarDeclarationSponsor {
  countryId: CountryId;
  characterId: ObjectId;
  characterName: string;
  party?: string;
  isNpp?: boolean;
}

/**
 * File one organization-backed declaration in every eligible player legislature.
 * Documents are inserted together so a large bloc does not add one write round trip
 * per member. Each bill opens every voting chamber on the same 24-turn clock.
 */
export async function buildOrganizationWarDeclarationBills(params: {
  db: Db;
  preset?: string;
  currentTurn: number;
  organizationId: string;
  resolutionId: string;
  targetCountryId: CountryId;
  targetCountryName: string;
  provision: DeclareWarProvision;
  sponsors: OrganizationWarDeclarationSponsor[];
}): Promise<Map<CountryId, ObjectId>> {
  const {
    db,
    preset,
    currentTurn,
    organizationId,
    resolutionId,
    targetCountryId,
    targetCountryName,
    provision,
    sponsors,
  } = params;
  if (sponsors.length === 0) return new Map();

  const bills = db.collection<Bill>("bills");
  const existing = await bills
    .find(
      {
        countryId: { $in: sponsors.map((sponsor) => sponsor.countryId) },
        provisions: { $elemMatch: { type: "declare_war", resolutionId } },
      } as never,
      { projection: { _id: 1, countryId: 1 } }
    )
    .toArray();
  const result = new Map<CountryId, ObjectId>();
  for (const bill of existing) {
    if (bill.countryId) result.set(bill.countryId, bill._id);
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + WAR_DECLARATION_VOTE_HOURS * 60 * 60 * 1000);
  const endsOnTurn = currentTurn + WAR_DECLARATION_VOTE_HOURS;
  const newBills: Bill[] = [];

  for (const sponsor of sponsors) {
    if (result.has(sponsor.countryId)) continue;
    const config = getCountryConfig(sponsor.countryId, preset);
    const lowerKey = config.legislature.lowerChamber.key;
    const billId = new ObjectId();
    const bill = {
      _id: billId,
      countryId: sponsor.countryId,
      stateId: getNationalStateId(sponsor.countryId),
      title: `Declaration of War against ${targetCountryName} (${organizationId})`,
      summary: `${organizationId} calls on ${config.name} to declare war on ${targetCountryName}. Stated aim: ${warGoalLabel(provision.warGoal)}.`,
      fullText: "",
      category: "foreign policy",
      provisions: [
        {
          ...provision,
          targetCountry: targetCountryId,
          organizationId,
          resolutionId,
        },
      ],
      originChamber: lowerKey,
      currentChamber: lowerKey,
      status: "active_both" as const,
      sponsorId: sponsor.characterId,
      sponsorName: sponsor.characterName,
      sponsorParty: sponsor.party,
      nppSponsored: sponsor.isNpp === true,
      votes: {},
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      otherChamberVotes: {},
      otherChamberVotesFor: 0,
      otherChamberVotesAgainst: 0,
      otherChamberVotesAbstain: 0,
      votingStartedAt: now,
      votingEndsAt: endsAt,
      votingEndsOnTurn: endsOnTurn,
      otherChamberVotingStartedAt: now,
      otherChamberVotingEndsAt: endsAt,
      otherChamberVotingEndsOnTurn: endsOnTurn,
      proposalActionCost: 0,
      proposedAt: now,
      proposedTurn: currentTurn,
      createdAt: now,
      updatedAt: now,
    } as unknown as Bill;
    newBills.push(bill);
    result.set(sponsor.countryId, billId);
  }

  if (newBills.length > 0) {
    await bills.insertMany(newBills);
    await notifyBillsVoteOpen(
      db,
      newBills.flatMap((bill) =>
        getJointSittingOfficeTypes(bill.countryId!, preset).map((chamberType) => ({
          bill: { ...bill, currentChamber: chamberType },
          chamberType,
        }))
      )
    );
  }

  return result;
}
