import { ObjectId, type Db } from "mongodb";
import type {
  BargainingCampaign,
  BargainingRatification,
  BargainingRatificationBallot,
  Character,
  Corporation,
  Union,
} from "@/lib/db/types";
import { createNotification, createNotifications } from "@/lib/notifications";
import { isSameCountry } from "@/lib/api/sameCountry";
import { isUnionsBanned, UNIONS_BANNED_MESSAGE } from "@/lib/labour/unionLaws";
import { loadUnionVoteWeights } from "@/lib/unions/unionLeadershipVote";
import {
  isRatificationOpen,
  openRatificationVote,
  ratificationBlockReason,
  ratificationWeightFor,
  resolveRatification,
  tallyRatificationBallots,
  type RatificationOutcome,
  type RatificationTally,
} from "@/lib/unions/ratification";
import { persistBargainingSettlement, restoreEscalationExpectations } from "./bargaining";
import { rejectIfTurnProcessing, type UnionActionResult } from "./unionActions";

export const RATIFICATION_BALLOTS = "bargainingRatificationBallots";

/** Ballots cast on one campaign, newest write per organizer per offer. */
async function loadBallots(db: Db, campaignId: ObjectId): Promise<BargainingRatificationBallot[]> {
  return db
    .collection<BargainingRatificationBallot>(RATIFICATION_BALLOTS)
    .find({ campaignId })
    .toArray();
}

/**
 * Put the offer the president moved to accept to the members. Returns null when
 * the union has no organizer holding strength, which tells the caller to settle
 * the way it always did: there is no electorate to ask, and a vote nobody can
 * answer would only strand the settlement until the campaign lapsed.
 */
export async function openSettlementRatification(
  db: Db,
  union: Pick<Union, "_id" | "name">,
  campaign: BargainingCampaign,
  currentTurn: number
): Promise<UnionActionResult | null> {
  // The same two rules accepting has always applied, checked before a ballot
  // goes out so members are never asked about an offer that cannot be accepted.
  if (campaign.status !== "negotiating" && campaign.status !== "dispute") {
    return { ok: false, status: 400, error: "This campaign can no longer be settled." };
  }
  if (campaign.currentOffer.proposedBy === "union") {
    return {
      ok: false,
      status: 400,
      error: "The party that made an offer cannot accept its own offer.",
    };
  }
  const blocked = ratificationBlockReason(campaign, currentTurn);
  if (blocked) return { ok: false, status: 409, error: blocked };

  const weights = await loadUnionVoteWeights(db, campaign.unionId);
  const ratification = openRatificationVote({
    campaign,
    weights,
    currentTurn,
    now: new Date(),
  });
  if (!ratification) return null;

  const result = await db.collection<BargainingCampaign>("bargainingCampaigns").updateOne(
    {
      _id: campaign._id,
      status: campaign.status,
      "currentOffer.revision": campaign.currentOffer.revision,
      "ratification.status": { $ne: "open" },
    },
    {
      $set: {
        ratification,
        lastActionTurn: currentTurn,
        updatedAt: ratification.openedAt,
      },
    }
  );
  if (result.modifiedCount === 0) {
    return { ok: false, status: 409, error: "Campaign state changed. Reload and try again." };
  }
  // Ballots from an earlier vote on an earlier offer are not part of this one.
  // They are filtered out by revision anyway; clearing them keeps the
  // collection from growing a tail of dead rows per campaign.
  await db
    .collection<BargainingRatificationBallot>(RATIFICATION_BALLOTS)
    .deleteMany({ campaignId: campaign._id, offerRevision: { $ne: ratification.offerRevision } });
  await notifyOrganizers(db, union, campaign, ratification);

  return {
    ok: true,
    status: 200,
    campaignId: campaign._id.toString(),
    campaignStatus: campaign.status,
    currentOffer: campaign.currentOffer,
    ratification,
  };
}

/** Tell every organizer holding a ballot that there is a settlement to answer. */
async function notifyOrganizers(
  db: Db,
  union: Pick<Union, "_id" | "name">,
  campaign: BargainingCampaign,
  ratification: BargainingRatification
): Promise<void> {
  const characters = await db
    .collection<Character>("characters")
    .find(
      { _id: { $in: ratification.weights.map((weight) => weight.characterId) } },
      { projection: { userId: 1 } }
    )
    .toArray();
  await createNotifications(
    characters
      .filter((character) => character.userId)
      .map((character) => ({
        userId: character.userId,
        type: "bargaining_ratification_open" as const,
        title: "Settlement put to the members",
        message: `${union.name} has a settlement on the table at ${ratification.offerRevision > 1 ? "revision " + ratification.offerRevision : "the opening offer"}: ${campaign.currentOffer.wageLevel.toFixed(2)}x wage floor over ${campaign.currentOffer.agreementDurationTurns} turns, with ${campaign.currentOffer.noStrikeTurns} turns of labour peace. Vote to ratify or reject before turn ${ratification.closesAtTurn}.`,
        metadata: {
          campaignId: campaign._id,
          unionId: union._id,
          closesAtTurn: ratification.closesAtTurn,
        },
      }))
  );
}

export type CastRatificationResult =
  | {
      ok: true;
      status: 200;
      vote: "ratify" | "reject";
      weight: number;
      tally: RatificationTally;
      outcome: RatificationOutcome | null;
      campaignStatus: BargainingCampaign["status"];
    }
  | { ok: false; status: number; error: string };

/**
 * Cast or change one organizer's ballot, then close the vote if the result can
 * no longer change. Weight comes from the snapshot on the campaign, never from
 * a live read: an organizer who has drifted since the vote opened still holds
 * the say they had when they were asked, and one who organized since holds
 * none until the next vote.
 */
export async function castRatificationBallot(
  db: Db,
  character: Character,
  unionRouteId: string,
  campaignId: string,
  vote: "ratify" | "reject",
  currentTurn: number
): Promise<CastRatificationResult> {
  const turnBusy = await rejectIfTurnProcessing(db);
  if (turnBusy) return turnBusy as CastRatificationResult;
  if (!ObjectId.isValid(campaignId) || !ObjectId.isValid(unionRouteId)) {
    return { ok: false, status: 400, error: "Invalid campaign ID." };
  }
  const campaign = await db
    .collection<BargainingCampaign>("bargainingCampaigns")
    .findOne({ _id: new ObjectId(campaignId) });
  if (!campaign || !campaign.unionId.equals(new ObjectId(unionRouteId))) {
    return { ok: false, status: 404, error: "Bargaining campaign not found for this union." };
  }
  const union = await db
    .collection<Union>("unions")
    .findOne({ _id: campaign.unionId }, { projection: { name: 1, countryId: 1 } });
  if (!union) return { ok: false, status: 404, error: "Union not found" };
  // Same country gate the leadership ballot applies, and the same ban freeze.
  if (!isSameCountry(character, { countryId: union.countryId })) {
    return { ok: false, status: 403, error: "You must be in this union's country to vote." };
  }
  if (await isUnionsBanned(db, union.countryId)) {
    return { ok: false, status: 403, error: UNIONS_BANNED_MESSAGE };
  }

  const ratification = campaign.ratification;
  if (!ratification || ratification.status !== "open") {
    return { ok: false, status: 409, error: "There is no open ratification vote to answer." };
  }
  if (campaign.status !== "negotiating" && campaign.status !== "dispute") {
    return { ok: false, status: 409, error: "This campaign is no longer open." };
  }
  if (!isRatificationOpen(campaign, currentTurn)) {
    // The deadline passed and the turn pass has not swept yet. Close it now
    // rather than accepting a late ballot into a vote that is already over.
    const closed = await closeRatificationVote(db, campaign, currentTurn);
    return {
      ok: false,
      status: 409,
      error: `This vote closed on turn ${ratification.closesAtTurn} (${closed.outcome ?? "void"}).`,
    };
  }
  const weight = ratificationWeightFor(ratification, character._id);
  if (!(weight > 0)) {
    return {
      ok: false,
      status: 403,
      error: "Only organizers holding strength when this vote opened can answer it.",
    };
  }

  const now = new Date();
  await db.collection<BargainingRatificationBallot>(RATIFICATION_BALLOTS).updateOne(
    {
      campaignId: campaign._id,
      offerRevision: ratification.offerRevision,
      voterCharacterId: character._id,
    },
    {
      $set: { vote, updatedAt: now },
      $setOnInsert: {
        campaignId: campaign._id,
        offerRevision: ratification.offerRevision,
        voterCharacterId: character._id,
        createdAt: now,
      },
    },
    { upsert: true }
  );

  const ballots = await loadBallots(db, campaign._id);
  const tally = tallyRatificationBallots(ratification, ballots);
  const outcome = resolveRatification(ratification, tally, currentTurn);
  let campaignStatus: BargainingCampaign["status"] = campaign.status;
  if (outcome) {
    const closed = await closeRatificationVote(db, campaign, currentTurn, { ballots });
    campaignStatus = closed.campaignStatus;
  }
  return { ok: true, status: 200, vote, weight, tally, outcome, campaignStatus };
}

export interface CloseRatificationResult {
  outcome: RatificationOutcome | "void" | null;
  campaignStatus: BargainingCampaign["status"];
  /** Set when a ratified vote could not be settled after all. */
  error?: string;
}

/**
 * Decide one open vote and apply the consequence.
 *
 * A ratified vote settles the campaign exactly as accepting used to. A rejected
 * one leaves the campaign where it stands, with the employer's offer still on
 * the table: the union must move the package or live with the clocks. That is
 * the only rejection path that obeys the rule in the `lapsed` docblock, because
 * it invents no new state to be stuck in. The deadline still runs the campaign
 * into dispute and the dispute still lapses, so a membership that rejects
 * everything ends the campaign by the existing exit rather than freezing it.
 */
export async function closeRatificationVote(
  db: Db,
  campaign: BargainingCampaign,
  currentTurn: number,
  options?: { ballots?: BargainingRatificationBallot[] }
): Promise<CloseRatificationResult> {
  const ratification = campaign.ratification;
  if (!ratification || ratification.status !== "open") {
    return { outcome: null, campaignStatus: campaign.status };
  }

  const campaigns = db.collection<BargainingCampaign>("bargainingCampaigns");
  const now = new Date();
  const voidVote = async (campaignStatus: BargainingCampaign["status"]) => {
    await campaigns.updateOne(
      { _id: campaign._id, "ratification.status": "open" },
      {
        $set: {
          "ratification.status": "void",
          "ratification.closedAtTurn": currentTurn,
          "ratification.updatedAt": now,
          updatedAt: now,
        },
      }
    );
    return { outcome: "void" as const, campaignStatus };
  };

  // The campaign died under the vote: withdrawn by the president, or lapsed.
  if (campaign.status !== "negotiating" && campaign.status !== "dispute") {
    return voidVote(campaign.status);
  }
  // A settlement needs a counterparty. A dissolved employer cannot be bound by
  // an agreement, and leaving the campaign open would hold the union in a
  // campaign no answer can ever end.
  const employer = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: campaign.employerCorporationId }, { projection: { _id: 1 } });
  if (!employer) {
    await voidVote(campaign.status);
    await campaigns.updateOne(
      { _id: campaign._id, status: campaign.status },
      {
        $set: {
          status: "lapsed",
          escalationLevel: "none",
          endedAtTurn: currentTurn,
          lastActionTurn: currentTurn,
          updatedAt: now,
        },
      }
    );
    await restoreEscalationExpectations(db, campaign);
    await notifyRatificationClosed(db, campaign, "void", currentTurn);
    return { outcome: "void", campaignStatus: "lapsed" };
  }

  const ballots = options?.ballots ?? (await loadBallots(db, campaign._id));
  const tally = tallyRatificationBallots(ratification, ballots);
  const outcome = resolveRatification(ratification, tally, currentTurn);
  if (!outcome) return { outcome: null, campaignStatus: campaign.status };

  const claimed = await campaigns.updateOne(
    { _id: campaign._id, "ratification.status": "open" },
    {
      $set: {
        "ratification.status": outcome,
        "ratification.closedAtTurn": currentTurn,
        "ratification.updatedAt": now,
        updatedAt: now,
      },
    }
  );
  if (claimed.modifiedCount === 0) {
    // Another writer closed the same vote. Whatever it decided stands.
    return { outcome: null, campaignStatus: campaign.status };
  }

  if (outcome === "rejected") {
    await notifyRatificationClosed(db, campaign, "rejected", currentTurn);
    return { outcome, campaignStatus: campaign.status };
  }

  // Settle from the campaign as the members saw it, so a settlement can never
  // bind them to terms that changed after the ballot opened.
  const settled = await persistBargainingSettlement(
    db,
    { ...campaign, ratification: { ...ratification, status: "ratified" } },
    "union",
    currentTurn
  );
  if (!settled.ok) {
    // The offer moved under the vote. Leave the campaign open and put the
    // ratification back to void rather than reporting a settlement that is not
    // there; the president can put the new offer to the members.
    await campaigns.updateOne(
      { _id: campaign._id, "ratification.status": "ratified" },
      {
        $set: {
          "ratification.status": "void",
          "ratification.updatedAt": new Date(),
        },
      }
    );
    return { outcome: null, campaignStatus: campaign.status, error: settled.error };
  }
  await notifyRatificationClosed(db, campaign, "ratified", currentTurn);
  return { outcome, campaignStatus: "settled" };
}

/** Tell the president how the members answered, whichever way they went. */
async function notifyRatificationClosed(
  db: Db,
  campaign: BargainingCampaign,
  outcome: RatificationOutcome | "void",
  currentTurn: number
): Promise<void> {
  const union = await db
    .collection<Union>("unions")
    .findOne({ _id: campaign.unionId }, { projection: { name: 1, ownerId: 1, ownerType: 1 } });
  // An NPP-led union has no User behind its leader, and a vacant presidency has
  // nobody to tell. The vote still closed on schedule either way.
  if (!union?.ownerId || union.ownerType === "npp") return;
  const leader = await db
    .collection<Character>("characters")
    .findOne({ _id: union.ownerId }, { projection: { userId: 1 } });
  if (!leader?.userId) return;
  await createNotification({
    userId: leader.userId,
    type: "bargaining_ratification_closed",
    title:
      outcome === "ratified"
        ? "Members ratified the settlement"
        : outcome === "rejected"
          ? "Members rejected the settlement"
          : "Ratification vote void",
    message:
      outcome === "ratified"
        ? `Organizers of ${union.name} ratified the settlement on turn ${currentTurn}. The collective agreement is in force.`
        : outcome === "rejected"
          ? `Organizers of ${union.name} rejected the settlement on turn ${currentTurn}. The offer is still on the table and the campaign clocks are still running: move the package or the campaign runs its course.`
          : `The ratification vote at ${union.name} ended without a decision on turn ${currentTurn} because the campaign could no longer be settled.`,
    metadata: {
      campaignId: campaign._id,
      unionId: campaign.unionId,
      employerCorporationId: campaign.employerCorporationId,
      turn: currentTurn,
    },
  });
}

/**
 * Turn-pass sweep: close every vote that has reached its deadline turn. A vote
 * that could hang forever is a bug, and the president who opened it has no
 * reason to come back and close it when the answer is no.
 */
export async function closeDueRatificationVotes(
  db: Db,
  currentTurn: number
): Promise<{ ratified: number; rejected: number; voided: number }> {
  const counts = { ratified: 0, rejected: 0, voided: 0 };
  const due = await db
    .collection<BargainingCampaign>("bargainingCampaigns")
    .find({ "ratification.status": "open", "ratification.closesAtTurn": { $lte: currentTurn } })
    .toArray();
  for (const campaign of due) {
    const closed = await closeRatificationVote(db, campaign, currentTurn);
    if (closed.outcome === "ratified") counts.ratified++;
    else if (closed.outcome === "rejected") counts.rejected++;
    else if (closed.outcome === "void") counts.voided++;
  }
  return counts;
}
