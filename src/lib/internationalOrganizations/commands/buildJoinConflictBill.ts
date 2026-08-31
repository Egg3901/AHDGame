import { ObjectId, type Db } from "mongodb";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getNationalStateId } from "@/lib/policy/nationalStateId";
import type { Bill } from "@/lib/db/types";
import type { JoinConflictProvision } from "@/lib/db/types/legislation";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { getJointSittingOfficeTypes } from "@/lib/legislature/chamberOfficeType";
import { notifyChambersVoteOpen } from "@/lib/turn/billLifecycle/lifecycleHelpers";

/** Both chambers get the same 24-turn clock — they are voting at the same time. */
const JOIN_CONFLICT_VOTE_HOURS = 24;

/**
 * Mint the mirrored bill a passed `join_conflict` resolution spawns in one member's
 * legislature, opened at PR2's concurrent status so both chambers vote at once.
 *
 * Unlike `buildMembershipBill`, which files an ordinary `active` bill the country
 * raised for itself, this one arrives unbidden at a bloc's call — so it opens both
 * chambers, and it announces itself.
 */
export async function buildJoinConflictBill(params: {
  db: Db;
  countryId: CountryId;
  preset?: string;
  sponsor: { characterId: ObjectId; characterName: string; party?: string; isNpp?: boolean };
  conflictName: string;
  organizationId: string;
  provision: JoinConflictProvision;
}): Promise<ObjectId> {
  const { db, countryId, preset, sponsor, conflictName, organizationId, provision } = params;
  const existing = await db.collection<Bill>("bills").findOne(
    {
      countryId,
      provisions: {
        $elemMatch: { type: "join_conflict", resolutionId: provision.resolutionId },
      },
    } as never,
    { projection: { _id: 1 } }
  );
  if (existing) return existing._id;

  // ⚠️ getCountryConfig, NOT COUNTRY_CONFIGS[...] — buildMembershipBill reads the
  // static table directly, and legislature shape is preset-dependent (DE 1953 flips
  // `bicameral`; TR and ES flip `upperElectionSystem` between eras).
  const config = getCountryConfig(countryId, preset);
  const lowerKey = config.legislature.lowerChamber.key;
  const now = new Date();
  const currentTurn = await getCurrentTurn(db);
  const endsAt = new Date(now.getTime() + JOIN_CONFLICT_VOTE_HOURS * 60 * 60 * 1000);
  const endsOnTurn = currentTurn + JOIN_CONFLICT_VOTE_HOURS;
  const billId = new ObjectId();

  const bill = {
    _id: billId,
    countryId,
    // `NATIONAL_POLICY_STATE_IDS`, not `getNationalDocId` with a
    // `${lower}_national` fallback: that map covers ten countries, and this bill
    // is spawned in seventeen. The fallback is right for the eight Eastern-bloc
    // ones only by luck, and provably wrong for the Soviet Union, whose id is
    // `su_national` — "NOT ru_national, which nothing else reads". This map is
    // keyed by CountryId, so it is exhaustive by construction.
    stateId: getNationalStateId(countryId),
    title: `Entry into the ${conflictName} (${organizationId})`,
    summary: `Enter the ${conflictName} on side ${provision.side} at ${organizationId}'s call.`,
    fullText: "",
    category: "foreign policy",
    provisions: [provision],
    // `active_both` has no single current chamber, but nationalBillActions derives a
    // voter's chamber from it and the card / timeline / whip surfaces read it. The
    // lower chamber is the same opening value every other bill takes, so unconverted
    // readers degrade rather than seeing undefined. Never the authority.
    originChamber: lowerKey,
    currentChamber: lowerKey,
    status: "active_both" as const,
    sponsorId: sponsor.characterId,
    sponsorName: sponsor.characterName,
    sponsorParty: sponsor.party ?? undefined,
    nppSponsored: sponsor.isNpp === true,
    votes: {},
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    otherChamberVotes: {},
    otherChamberVotesFor: 0,
    otherChamberVotesAgainst: 0,
    otherChamberVotesAbstain: 0,
    // BOTH pairs: the NPP fetch ORs them and the close ANDs them, so a missing pair
    // either stops polling one chamber or refuses its votes against an undefined
    // deadline — and the bill then never closes at all.
    votingStartedAt: now,
    votingEndsAt: endsAt,
    votingEndsOnTurn: endsOnTurn,
    otherChamberVotingStartedAt: now,
    otherChamberVotingEndsAt: endsAt,
    otherChamberVotingEndsOnTurn: endsOnTurn,
    // The diplomatic action spent tabling the bloc resolution is the cost; the member
    // countries did not file this.
    proposalActionCost: 0,
    proposedAt: now,
    proposedTurn: currentTurn,
    createdAt: now,
    updatedAt: now,
  } as unknown as Bill;

  await db.collection<Bill>("bills").insertOne(bill);

  // The engine notifies on activation; a builder-inserted bill never passes through
  // it, and this one lands unbidden in chambers that did not ask for it.
  //
  // Driven by `getJointSittingOfficeTypes` — the same authority the concurrent stage
  // resolves its chambers from — so a legislature whose upper house does not vote
  // gets one notice, not a second one pointing at a chamber with no say.
  for (const officeType of getJointSittingOfficeTypes(countryId, preset)) {
    await notifyChambersVoteOpen(db, { ...bill, currentChamber: officeType }, officeType);
  }

  return billId;
}
