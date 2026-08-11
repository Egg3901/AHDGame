/**
 * NPC legislator auto-vote for sovereign-crisis legislative ratification.
 *
 * Per design Section 6.6: "Executive's NPC choice goes to existing legislation
 * flow. No new NPC voting logic — uses whatever AHD's legislative system
 * already does for party-line/standing-orders voting."
 *
 * AHD's existing NPP voting hook (`ideologyVote`) takes a Bill object. We
 * don't have a Bill here — Phase 9b stored votes on the SovereignCrisisDecision
 * row directly. So we approximate the same logic: each NPP votes "for"
 * with a probability biased by their ideology alignment with the executive's
 * chosen resolution path. Determinism: the algorithm is deterministic per
 * NPP (uses NPP._id as a hash seed) so re-runs across turns don't flip votes.
 *
 * Idempotency: each updateOne filters on the NPP's vote field NOT yet
 * existing, so re-runs are safe.
 */

import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { SovereignResolutionChoice } from "@/lib/db/types/budget";
import type { SovereignCrisisDecision } from "@/lib/db/types/sovereignCrisisDecision";
import type { NPP } from "@/lib/db/types/npp";

interface NpcLegislatorAutoVoteInput {
  decision: SovereignCrisisDecision;
  /** Index into decision.legislativePhases of the active chamber. */
  chamberIndex: number;
  /** Pure deterministic seed derived from decision._id so re-runs are stable. */
  countryCode: CountryId;
}

export interface NpcLegislatorAutoVoteReport {
  npcsVoted: number;
  votesFor: number;
  votesAgainst: number;
}

const SUPPORT_THRESHOLD = 0.5;

/**
 * Pure: derive a 0..1 support score for an NPP given the executive's choice.
 * Higher = more likely to vote "for". Maps NPP economic/social positions and
 * loyalty into an alignment score with each resolution path.
 *
 * Heuristic — calibration may revise. Each ideological lean nudges support
 * for one option and away from another:
 *   - Free-market (e>0): support bailout/restructure
 *   - Far-left (e<-50): support repudiate/monetize
 *   - Loyalist (loyalty high): defaults to "for" with mild bias
 */
export function computeNpcSupportScore(
  npp: Pick<NPP, "policies" | "personality">,
  choice: SovereignResolutionChoice
): number {
  const e = npp.policies?.economic ?? 0;
  const s = npp.policies?.social ?? 0;
  const loyalty = (npp.personality?.loyalty ?? 50) / 100;

  // Base: loyalty pulls support toward 0.55 (slight default-for bias).
  let score = 0.5 + (loyalty - 0.5) * 0.1;

  if (choice === "bailout") {
    if (e > 30) score += 0.15; // free-market backs bailout
    if (e < -50) score -= 0.15; // far-left opposes
  } else if (choice === "restructure") {
    if (e > 0) score += 0.1;
    if (e < -50 && s > 0) score -= 0.1;
  } else if (choice === "monetize") {
    if (e < -30 || s < -50) score += 0.15; // populist/socialist favor
    if (e > 50) score -= 0.15; // conservatives oppose
  } else if (choice === "repudiate") {
    if (e < -50 || s > 60) score += 0.2; // populist/nationalist back
    if (e > 30 && s < 30) score -= 0.15; // technocrats oppose
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Deterministic 0..1 derived from the NPP and decision IDs — stable across
 * runs so re-evaluations never flip votes.
 */
function deterministicJitter(nppId: ObjectId, decisionId: ObjectId): number {
  const a = nppId.toHexString();
  const b = decisionId.toHexString();
  let hash = 0;
  for (const ch of a + b) {
    hash = (hash * 31 + ch.charCodeAt(0)) % 1_000_000_007;
  }
  return (hash % 1000) / 1000;
}

export async function runNpcLegislatorAutoVote(
  db: Db,
  input: NpcLegislatorAutoVoteInput
): Promise<NpcLegislatorAutoVoteReport> {
  const { decision, chamberIndex } = input;
  const phase = decision.legislativePhases?.[chamberIndex];
  if (!phase || phase.outcome !== "pending") {
    return { npcsVoted: 0, votesFor: 0, votesAgainst: 0 };
  }
  const choice = decision.executiveChoice;
  if (!choice) return { npcsVoted: 0, votesFor: 0, votesAgainst: 0 };

  // Find NPPs holding seats in the active chamber for this country, who
  // have NOT already voted on this phase.
  const alreadyVotedIds = Object.keys(phase.votes ?? {});
  const npps = await db
    .collection<NPP>("npps")
    .find({
      countryId: input.countryCode,
      "currentOffice.type": phase.chamberKey,
      retiredAt: null,
    } as never)
    .toArray();

  const report: NpcLegislatorAutoVoteReport = {
    npcsVoted: 0,
    votesFor: 0,
    votesAgainst: 0,
  };

  for (const npp of npps) {
    const nppKey = npp._id.toString();
    if (alreadyVotedIds.includes(nppKey)) continue;

    const support = computeNpcSupportScore(npp, choice);
    const jitter = deterministicJitter(npp._id, decision._id);
    const vote: "for" | "against" =
      support + (jitter - 0.5) * 0.1 >= SUPPORT_THRESHOLD ? "for" : "against";

    const voteFieldKey = `legislativePhases.${chamberIndex}.votes.${nppKey}`;
    const counterField = vote === "for" ? "votesFor" : "votesAgainst";
    const result = await db
      .collection<SovereignCrisisDecision>("sovereignCrisisDecisions")
      .updateOne(
        { _id: decision._id, [voteFieldKey]: { $exists: false } },
        {
          $set: { [voteFieldKey]: vote },
          $inc: { [`legislativePhases.${chamberIndex}.${counterField}`]: 1 },
        }
      );
    if (result.modifiedCount === 1) {
      report.npcsVoted += 1;
      if (vote === "for") report.votesFor += 1;
      else report.votesAgainst += 1;
    }
  }

  return report;
}
