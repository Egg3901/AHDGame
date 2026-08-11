import type { AuthUserWithCharacter } from "@/lib/auth";
import { badRequest, forbidden, notFound } from "@/lib/api/errors";
import { assertSameCountry } from "@/lib/api/sameCountry";
import { isCampaignNomineeUser } from "@/lib/campaigns/access";
import { getGameTime } from "@/lib/time/gameTime";
import { isCampaignUpgradeGeneralPhase } from "@/lib/elections/phases";
import type {
  Campaign,
  Character,
  Election,
  ElectionCandidate,
  PlayerEndorsement,
} from "@/lib/db/types";
import { isActivePlayerEndorsementDuplicateKey } from "@/lib/elections/duplicateKey";
import { ObjectId, type Db } from "mongodb";

async function getCurrentTurn(db: Db): Promise<number> {
  const gameState = await db
    .collection<{ _id: string; currentTurn?: number }>("gameState")
    .findOne({ _id: "current" });
  return gameState?.currentTurn ?? 0;
}

export async function suspendCampaignAndEndorse(params: {
  db: Db;
  campaignId: ObjectId;
  endorsedElectionCandidateId: ObjectId;
  user: AuthUserWithCharacter & { hasCharacter: true; character: Character };
}) {
  const { db, campaignId, endorsedElectionCandidateId, user } = params;

  const campaign = await db.collection<Campaign>("campaigns").findOne({ _id: campaignId });
  if (!campaign) {
    throw notFound("Campaign not found");
  }
  if (campaign.status === "archived") {
    throw badRequest("This campaign has been eliminated and can no longer be managed.");
  }
  if (campaign.candidateIsNPP) {
    throw badRequest("Only player presidential nominees can suspend and endorse.");
  }

  const isNominee = await isCampaignNomineeUser(db, campaign, user.userId, user.character._id);
  if (!isNominee && !user.isAdmin) {
    throw forbidden("Only the presidential nominee can suspend the campaign and endorse.");
  }

  const election = await db.collection<Election>("elections").findOne({ _id: campaign.electionId });
  if (!election) {
    throw notFound("Election not found");
  }
  if (election.electionType !== "president") {
    throw badRequest("Suspend and endorse is only available for presidential elections.");
  }
  if (election.status !== "active") {
    throw badRequest("This election is no longer active.");
  }
  if (!user.isAdmin) {
    assertSameCountry(user.character, election, {
      message: "You cannot manage a campaign in another country's election",
    });
  }

  const gameTime = await getGameTime();
  if (!isCampaignUpgradeGeneralPhase(election, gameTime.currentTurn, gameTime)) {
    throw badRequest("Suspend and endorse is only available during the general election.");
  }

  const ownCandidate = await db.collection<ElectionCandidate>("electionCandidates").findOne({
    electionId: campaign.electionId,
    characterId: campaign.candidateId,
    status: "active",
  });
  if (!ownCandidate) {
    throw badRequest("You are not an active candidate in this race.");
  }
  if (ownCandidate.campaignSuspended) {
    throw badRequest("Your campaign is already suspended.");
  }

  const endorsedCandidate = await db.collection<ElectionCandidate>("electionCandidates").findOne({
    _id: endorsedElectionCandidateId,
    electionId: campaign.electionId,
    status: "active",
  });
  if (!endorsedCandidate) {
    throw notFound("Endorsed candidate not found in this election.");
  }
  if (endorsedCandidate._id.equals(ownCandidate._id)) {
    throw badRequest("You cannot endorse yourself.");
  }

  const now = new Date();
  const turnNumber = await getCurrentTurn(db);
  await db.collection<ElectionCandidate>("electionCandidates").updateOne(
    { _id: ownCandidate._id },
    {
      $set: {
        campaignSuspended: true,
        suspendedAt: now,
        endorsedElectionCandidateId: endorsedCandidate._id,
        rallyTourActive: false,
      },
      $unset: { supportAccrual: "", endorsementTargetWithdrawnAt: "" },
    }
  );

  // Register the suspend-endorse as a counted player endorsement so it feeds the
  // endorsee's endorsement tally + per-turn campaign-action grant (ticket #948) —
  // in addition to the one-time strength/org transfer below. Mirrors the normal
  // /endorse route: deactivate any prior active endorsement by this character for
  // this election, then insert one keyed by the endorsed candidate ROW id.
  await db
    .collection<PlayerEndorsement>("playerEndorsements")
    .updateMany(
      { characterId: ownCandidate.characterId, electionId: campaign.electionId, isActive: true },
      { $set: { isActive: false, withdrawnAt: now } }
    );
  const suspendEndorsement: PlayerEndorsement = {
    _id: new ObjectId(),
    characterId: ownCandidate.characterId,
    characterName: ownCandidate.characterName,
    electionId: campaign.electionId,
    candidateId: endorsedCandidate._id,
    candidateName: endorsedCandidate.characterName,
    isActive: true,
    createdAt: now,
  };
  try {
    await db.collection<PlayerEndorsement>("playerEndorsements").insertOne(suspendEndorsement);
  } catch (error) {
    // Idempotent: a concurrent write already left an active endorsement in place.
    if (!isActivePlayerEndorsementDuplicateKey(error)) {
      throw error;
    }
  }

  // One-time immediate transfer: 25% of campaign strength from suspender to
  // endorsed. The suspender retains all existing votes but will not accumulate
  // any further. Additionally, 25% of the suspender's per-state character org
  // is contributed to the endorsed candidate in the vote calculation engine
  // (see accumulatePresidentVoteTurn); no org is debited from the suspender.
  const endorsedLookupKey =
    endorsedCandidate.isNPP && endorsedCandidate.nppId
      ? endorsedCandidate.nppId.toString()
      : endorsedCandidate.characterId.toString();

  // Transfer campaign strength
  const ownCampaignDoc = await db.collection<Campaign>("campaigns").findOne({
    _id: campaignId,
  });
  if (ownCampaignDoc && (ownCampaignDoc.campaignStrength ?? 0) > 0) {
    const cs = ownCampaignDoc.campaignStrength ?? 0;
    const transfer = Math.floor(cs * 0.25);
    await db
      .collection<Campaign>("campaigns")
      .updateOne({ _id: ownCampaignDoc._id }, { $inc: { campaignStrength: -transfer } });
    // Find the endorsed candidate's campaign by candidateId
    const endorsedCampaign = await db.collection<Campaign>("campaigns").findOne({
      electionId: campaign.electionId,
      candidateId: new ObjectId(endorsedLookupKey),
    });
    if (endorsedCampaign) {
      await db
        .collection<Campaign>("campaigns")
        .updateOne({ _id: endorsedCampaign._id }, { $inc: { campaignStrength: transfer } });
    }
  }

  await db.collection<Campaign>("campaigns").updateOne(
    { _id: campaignId },
    {
      $push: {
        activityHistory: {
          type: "suspend_endorse",
          targetName: endorsedCandidate.characterName,
          timestamp: now,
          turnNumber,
        },
      } as never,
      $set: { updatedAt: now },
    }
  );

  return {
    endorsedCandidateId: endorsedCandidate._id.toString(),
    endorsedCandidateName: endorsedCandidate.characterName,
    suspendedAt: now.toISOString(),
  };
}
