import { ObjectId } from "mongodb";
import type {
  BargainingCampaign,
  BargainingRatification,
  BargainingRatificationBallot,
} from "@/lib/db/types";
import type { UnionVoteWeights } from "@/lib/unions/unionLeadershipVote";

/**
 * Turns a ratification ballot stays open. Deliberately short and measured in
 * turns, not dates: every other clock in this system (the bargaining deadline,
 * the dispute lapse, the mediation window) is a turn count, and the campaign
 * clocks keep running while the members vote. A long window would let a
 * president park a campaign in a vote to dodge the lapse rule.
 */
export const RATIFICATION_VOTE_TURNS = 3;

export type RatificationOutcome = "ratified" | "rejected";

export interface RatificationTally {
  ratifyStrength: number;
  rejectStrength: number;
  /** Strength that has answered, whichever way. */
  castStrength: number;
  /** Snapshot strength that has not answered yet. */
  outstandingStrength: number;
  ratifyCount: number;
  rejectCount: number;
}

/** Strength a character may cast in this vote, from the snapshot taken at open. */
export function ratificationWeightFor(
  ratification: Pick<BargainingRatification, "weights">,
  characterId: ObjectId | string
): number {
  const key = characterId.toString();
  const entry = ratification.weights.find((weight) => weight.characterId.toString() === key);
  return entry?.strength ?? 0;
}

/**
 * Freeze the current organizing strengths into a ballot. Returns null when no
 * organizer holds any strength: with an empty electorate there is nobody to
 * ask, and opening a vote that can never be answered would strand the
 * settlement. The caller settles directly in that case.
 */
export function openRatificationVote(args: {
  campaign: Pick<BargainingCampaign, "currentOffer">;
  weights: UnionVoteWeights;
  currentTurn: number;
  now: Date;
}): BargainingRatification | null {
  const weights = [...args.weights.entries()]
    .filter(([, strength]) => Number.isFinite(strength) && strength > 0)
    .map(([characterId, strength]) => ({ characterId, strength }));
  if (weights.length === 0) return null;
  const totalStrength = weights.reduce((sum, weight) => sum + weight.strength, 0);
  return {
    offerRevision: args.campaign.currentOffer.revision,
    status: "open",
    openedAtTurn: args.currentTurn,
    closesAtTurn: args.currentTurn + RATIFICATION_VOTE_TURNS,
    // `loadUnionVoteWeights` keys by character id string, the same shape the
    // leadership tally uses. The snapshot stores ids so it can be read back
    // without a second lookup.
    weights: weights.map((weight) => ({
      characterId: new ObjectId(weight.characterId),
      strength: weight.strength,
    })),
    totalStrength,
    openedAt: args.now,
    updatedAt: args.now,
  };
}

/** Weighted yes/no totals, counting only ballots that carry snapshot strength. */
export function tallyRatificationBallots(
  ratification: Pick<BargainingRatification, "weights" | "totalStrength" | "offerRevision">,
  ballots: readonly Pick<
    BargainingRatificationBallot,
    "voterCharacterId" | "vote" | "offerRevision"
  >[]
): RatificationTally {
  let ratifyStrength = 0;
  let rejectStrength = 0;
  let ratifyCount = 0;
  let rejectCount = 0;
  const counted = new Set<string>();
  for (const ballot of ballots) {
    if (ballot.offerRevision !== ratification.offerRevision) continue;
    const key = ballot.voterCharacterId.toString();
    if (counted.has(key)) continue;
    const weight = ratificationWeightFor(ratification, key);
    if (!(weight > 0)) continue;
    counted.add(key);
    if (ballot.vote === "ratify") {
      ratifyStrength += weight;
      ratifyCount++;
    } else {
      rejectStrength += weight;
      rejectCount++;
    }
  }
  const castStrength = ratifyStrength + rejectStrength;
  return {
    ratifyStrength,
    rejectStrength,
    castStrength,
    outstandingStrength: Math.max(0, ratification.totalStrength - castStrength),
    ratifyCount,
    rejectCount,
  };
}

/**
 * The one close rule, used both when a ballot lands and when the turn pass
 * sweeps. A vote closes early the moment the result cannot change, and closes
 * on its deadline turn otherwise.
 *
 * At the deadline a tie ratifies, and so does silence: an unanswered ballot
 * leaves the president's acceptance standing, which is exactly what happened
 * before members had a vote at all. Rejecting on apathy would let an inactive
 * membership veto every settlement and hand the campaign to the lapse clock
 * with nobody having decided anything.
 */
export function resolveRatification(
  ratification: Pick<BargainingRatification, "totalStrength" | "closesAtTurn" | "status">,
  tally: RatificationTally,
  currentTurn: number
): RatificationOutcome | null {
  if (ratification.status !== "open") return null;
  // A majority of ALL outstanding strength one way settles it now.
  if (tally.ratifyStrength * 2 > ratification.totalStrength) return "ratified";
  if (tally.rejectStrength * 2 > ratification.totalStrength) return "rejected";
  if (currentTurn >= ratification.closesAtTurn) {
    return tally.ratifyStrength >= tally.rejectStrength ? "ratified" : "rejected";
  }
  return null;
}

/** True while members can still cast a ballot on this campaign. */
export function isRatificationOpen(
  campaign: Pick<BargainingCampaign, "status" | "ratification">,
  currentTurn: number
): boolean {
  const ratification = campaign.ratification;
  if (!ratification || ratification.status !== "open") return false;
  if (campaign.status !== "negotiating" && campaign.status !== "dispute") return false;
  return currentTurn < ratification.closesAtTurn;
}

/** Everything a player surface needs to render one ratification vote. */
export interface RatificationView extends RatificationTally {
  status: BargainingRatification["status"];
  offerRevision: number;
  openedAtTurn: number;
  closesAtTurn: number;
  closedAtTurn: number | null;
  totalStrength: number;
  voterCount: number;
  /** The viewer's own snapshot weight, zero when they hold no ballot. */
  viewerWeight: number;
  viewerVote: "ratify" | "reject" | null;
}

/**
 * One shared shape for the union panel and the employer's surface. Only the
 * viewer's own ballot is disclosed, matching the leadership election, which
 * publishes the tally and each viewer's own vote and nobody else's.
 */
export function buildRatificationView(
  ratification: BargainingRatification,
  ballots: readonly Pick<
    BargainingRatificationBallot,
    "voterCharacterId" | "vote" | "offerRevision"
  >[],
  viewerCharacterId: ObjectId | string | null
): RatificationView {
  const tally = tallyRatificationBallots(ratification, ballots);
  const viewerKey = viewerCharacterId?.toString() ?? null;
  const viewerBallot = viewerKey
    ? ballots.find(
        (ballot) =>
          ballot.offerRevision === ratification.offerRevision &&
          ballot.voterCharacterId.toString() === viewerKey
      )
    : undefined;
  return {
    ...tally,
    status: ratification.status,
    offerRevision: ratification.offerRevision,
    openedAtTurn: ratification.openedAtTurn,
    closesAtTurn: ratification.closesAtTurn,
    closedAtTurn: ratification.closedAtTurn ?? null,
    totalStrength: ratification.totalStrength,
    voterCount: ratification.weights.length,
    viewerWeight: viewerKey ? ratificationWeightFor(ratification, viewerKey) : 0,
    viewerVote: viewerBallot?.vote ?? null,
  };
}

/**
 * Whether the president may put the current offer to the members. A rejected
 * offer cannot simply be re-tabled to the same electorate: without this the
 * president could reopen the identical vote every turn until turnout happened
 * to favour them. Moving the package (a counteroffer, which bumps the revision)
 * is the way back to a vote.
 */
export function ratificationBlockReason(
  campaign: Pick<BargainingCampaign, "status" | "ratification" | "currentOffer">,
  currentTurn: number
): string | null {
  const ratification = campaign.ratification;
  if (!ratification) return null;
  if (ratification.offerRevision !== campaign.currentOffer.revision) return null;
  if (ratification.status === "open") {
    return currentTurn < ratification.closesAtTurn
      ? `Members are already voting on this offer through turn ${ratification.closesAtTurn}.`
      : null;
  }
  if (ratification.status === "rejected") {
    return "Members rejected this offer. Table a counteroffer before asking them again.";
  }
  return null;
}
