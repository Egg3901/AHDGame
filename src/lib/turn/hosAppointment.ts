import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getCountryConfig, getHeadOfStateOfficeType } from "@/lib/constants/countries";
import { getJointSittingOfficeTypes } from "@/lib/legislature/chamberOfficeType";
import {
  getGovernmentFormationsCollection,
  getPMAppointmentVotesCollection,
} from "@/lib/db/collections/governmentFormation";
import { computeParliamentaryGovernmentTally } from "@/lib/congress/governmentVoteBreakdown";
import { autoAyeNPPsForParliamentaryAppointment } from "@/lib/turn/parliamentaryGovernment";
import { createNotifications } from "@/lib/notifications";
import { sendCountryGameEvent, DISCORD_COLORS } from "@/lib/discordWebhooks";
import type { Character, ElectedOfficial } from "@/lib/db/types";

/**
 * Resolve an expired head-of-state appointment vote (`office: "headOfState"`,
 * spec §2.3 — RU Chairman of the Presidium under
 * `headOfStateSelection: "legislatureAppointment"`).
 *
 * Mirrors resolveParliamentaryAppointmentVote: seat-weighted recompute over
 * the JOINT sitting (both Supreme Soviet chambers), atomic claim, then seat
 * the config's isHeadOfState officeType row and stamp the formation's hos
 * fields. Ceremonial office — no cabinet clear, no leader-confidence install,
 * no vacancy clock, and the holder's currentOffice is untouched (the office
 * stacks on their primary seat, partyChairHeadOfState precedent).
 */
export async function resolveHeadOfStateAppointmentVote(
  db: Db,
  countryId: CountryId,
  voteId: ObjectId,
  now: Date
): Promise<void> {
  const votesColl = getPMAppointmentVotesCollection(db);
  await autoAyeNPPsForParliamentaryAppointment(db, countryId, voteId);
  const vote = await votesColl.findOne({ _id: voteId });
  if (!vote || vote.status !== "active" || vote.office !== "headOfState") return;

  const tally = await computeParliamentaryGovernmentTally(
    db,
    countryId,
    getJointSittingOfficeTypes(countryId),
    vote.votes
  );
  const passed = tally.votesFor > tally.votesAgainst;

  const claimed = await votesColl.findOneAndUpdate(
    { _id: voteId, status: "active" },
    {
      $set: {
        status: passed ? "passed" : "failed",
        closedAt: now,
        updatedAt: now,
        votesFor: tally.votesFor,
        votesAgainst: tally.votesAgainst,
      },
    }
  );
  if (!claimed) return;
  if (!passed) return;

  const config = getCountryConfig(countryId);
  const hosOfficeType = getHeadOfStateOfficeType(config);
  if (!hosOfficeType) return;

  // Replace the seated head-of-state row.
  await db.collection<ElectedOfficial>("electedOfficials").deleteMany({
    countryId,
    officeType: hosOfficeType,
  });
  const nomineeChar = await db
    .collection<Character>("characters")
    .findOne({ _id: vote.nomineeCharacterId }, { projection: { party: 1, userId: 1 } });
  await db.collection<ElectedOfficial>("electedOfficials").insertOne({
    _id: new ObjectId(),
    countryId,
    officeType: hosOfficeType,
    state: countryId,
    isAppointment: true,
    characterId: vote.nomineeCharacterId,
    characterName: vote.nomineeName,
    party: nomineeChar?.party ?? vote.nomineePartyId,
    isNPP: false,
    electedAt: now,
    createdAt: now,
    updatedAt: now,
  } as ElectedOfficial);

  await getGovernmentFormationsCollection(db).updateOne(
    { _id: countryId },
    {
      $set: {
        hosCharacterId: vote.nomineeCharacterId,
        hosNppId: null,
        hosName: vote.nomineeName,
        updatedAt: now,
      },
    }
  );

  // Cancel sibling head-of-state votes — the office is filled.
  await votesColl.updateMany(
    { countryId, status: "active", office: "headOfState", _id: { $ne: voteId } },
    { $set: { status: "cancelled", closedAt: now, updatedAt: now } }
  );

  if (nomineeChar?.userId) {
    await createNotifications([
      {
        userId: nomineeChar.userId,
        title: `Appointed ${config.headOfStateTitle}`,
        message: `The legislature has elected you ${config.headOfStateTitle} (${tally.votesFor} ayes, ${tally.votesAgainst} nays).`,
        type: "system",
        metadata: { recipientCharacterId: vote.nomineeCharacterId.toString() },
      },
    ]);
  }
  sendCountryGameEvent(countryId, {
    title: `New ${config.headOfStateTitle} Elected`,
    description: `**${vote.nomineeName}** has been elected ${config.headOfStateTitle} by the legislature (${tally.votesFor}–${tally.votesAgainst}).`,
    color: DISCORD_COLORS.govFormed,
    footer: { text: "A House Divided" },
    timestamp: now.toISOString(),
  }).catch(() => {});
}
