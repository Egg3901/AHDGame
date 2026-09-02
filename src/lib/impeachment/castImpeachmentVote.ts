import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type { Character, ElectedOfficial } from "@/lib/db/types";
import type { Impeachment, ImpeachmentVoteValue } from "@/lib/db/types/impeachment";
import {
  getLowerChamberOfficeType,
  getUpperChamberOfficeType,
} from "@/lib/legislature/chamberOfficeType";
import { getSubNationalLegislatureKey } from "@/lib/constants/countries";
import { buildEmbeddedVoteTallyUpdate } from "@/lib/votes/embeddedVoteTally";
import { getGameState } from "@/lib/gameState";
import { badRequest, forbidden, notFound } from "@/lib/api/errors";
import { clearWhippedFromVote } from "@/lib/congress/clearWhippedVote";

/**
 * Cast (or change) a vote on an active impeachment. Only sitting members of the
 * CURRENT stage's chamber may vote — the lower chamber during the "house" stage,
 * the upper chamber during the "senate" stage. Rejected once the stage's voting
 * window has closed.
 */
export async function castImpeachmentVote(
  db: Db,
  impeachmentId: string,
  voter: Pick<Character, "_id" | "name">,
  vote: ImpeachmentVoteValue
): Promise<{ success: true; stage: "house" | "senate" }> {
  if (!ObjectId.isValid(impeachmentId)) throw badRequest("Invalid impeachment id");

  const impeachment = await db
    .collection<Impeachment>("impeachments")
    .findOne({ _id: new ObjectId(impeachmentId) });
  if (!impeachment) throw notFound("Impeachment not found");
  if (impeachment.stage !== "house" && impeachment.stage !== "senate") {
    throw badRequest("This impeachment is no longer open for voting.");
  }

  const stage = impeachment.stage;
  const isGovernor = impeachment.targetOffice === "governor";

  // Governor trials are held by the state legislature (single chamber, filed at
  // stage "senate"); presidential cases use the national lower/upper chamber.
  const chamberOffice = isGovernor
    ? getSubNationalLegislatureKey(impeachment.countryId)
    : stage === "house"
      ? getLowerChamberOfficeType(impeachment.countryId)
      : getUpperChamberOfficeType(impeachment.countryId);
  if (!chamberOffice) {
    throw badRequest("This country has no chamber able to vote at this stage.");
  }

  // Voter must currently sit in the active chamber — and, for a governor trial,
  // in the SAME state as the case.
  const voterFilter: Record<string, unknown> = {
    characterId: voter._id,
    officeType: chamberOffice,
  };
  if (isGovernor) voterFilter.state = impeachment.state;
  const official = await db.collection<ElectedOfficial>("electedOfficials").findOne(voterFilter);
  if (!official) {
    throw forbidden(
      isGovernor
        ? "Only sitting members of this state's legislature may vote in the impeachment trial."
        : stage === "house"
          ? "Only sitting lower-chamber members may vote to impeach."
          : "Only sitting upper-chamber members may vote in the impeachment trial."
    );
  }

  const currentTurn = (await getGameState(db))?.currentTurn ?? 0;
  const endsOnTurn =
    stage === "house" ? impeachment.houseVotingEndsOnTurn : impeachment.senateVotingEndsOnTurn;
  if (endsOnTurn != null && currentTurn > endsOnTurn) {
    throw badRequest("Voting for this stage has closed.");
  }

  const now = new Date();
  const weight = official.seatsHeld ?? 1;
  const voteKey = voter._id.toString();
  const voteField = stage === "house" ? "houseVotes" : "senateVotes";
  const tallyFieldByVote =
    stage === "house"
      ? { aye: "houseVotesFor", nay: "houseVotesAgainst", abstain: "houseVotesAbstain" }
      : { aye: "senateVotesFor", nay: "senateVotesAgainst", abstain: "senateVotesAbstain" };

  const pipeline = buildEmbeddedVoteTallyUpdate<ImpeachmentVoteValue>({
    voteField,
    voteKey,
    vote,
    tallyFieldByVote,
    updatedAt: now,
    weight,
  });

  // Guard on stage so a vote landing during resolution cannot mutate a
  // just-advanced case.
  await db
    .collection<Impeachment>("impeachments")
    .updateOne({ _id: impeachment._id, stage }, pipeline);

  // Choosing a vote clears the Player Whip snapshot, so the "Whipped by Party"
  // badge disappears once the member has voted for themselves.
  await clearWhippedFromVote(db, "impeachments", impeachment._id, voter._id);

  return { success: true, stage };
}
