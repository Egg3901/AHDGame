/**
 * Phase 11b — system-driven no-confidence trigger.
 *
 * When a parliamentary country ratifies Repudiate or Monetize, automatically
 * fire a no-confidence vote against the sitting PM. Bypasses the proposer-
 * Character requirement that the player-driven `proposeNoConfidence`
 * function enforces.
 *
 * Skips when:
 *   - The country is presidential (no PM to no-confidence)
 *   - The country lacks a confidence-vote mechanism
 *   - There's no sitting PM
 *   - A no-confidence vote is already active
 */

import { ObjectId, type Db } from "mongodb";
import {
  COUNTRY_CONFIGS,
  hasConfidenceVoteMechanism,
  isParliamentarySystem,
  type CountryId,
} from "@/lib/constants/countries";
import type { GovernmentFormation, NoConfidenceVote } from "@/lib/db/types/governmentFormation";

/** Hours the no-confidence vote stays open. Mirrors the player-driven path. */
const SYSTEM_NO_CONFIDENCE_HOURS = 24;

export interface TriggerSystemNoConfidenceResult {
  triggered: boolean;
  reason?: "not-parliamentary" | "no-confidence-mechanism" | "no-pm" | "vote-already-active";
  voteId?: string;
}

export async function triggerSystemNoConfidence(
  db: Db,
  countryId: CountryId,
  reason: string,
  currentTurn: number
): Promise<TriggerSystemNoConfidenceResult> {
  const config = COUNTRY_CONFIGS[countryId];
  if (!isParliamentarySystem(config)) {
    return { triggered: false, reason: "not-parliamentary" };
  }
  if (!hasConfidenceVoteMechanism(config)) {
    return { triggered: false, reason: "no-confidence-mechanism" };
  }

  const formation = await db
    .collection<GovernmentFormation>("governmentFormations")
    .findOne({ _id: countryId });

  if (!formation || formation.status !== "formed" || !formation.pmCharacterId) {
    return { triggered: false, reason: "no-pm" };
  }

  if (formation.activeVoteId) {
    return { triggered: false, reason: "vote-already-active" };
  }

  const now = new Date();
  const voteId = new ObjectId();
  const voteDoc: NoConfidenceVote = {
    _id: voteId,
    countryId,
    proposedByCharacterId: null,
    proposedByName: `System — ${reason}`,
    targetPmCharacterId: formation.pmCharacterId,
    targetPmName: formation.pmName ?? "Unknown",
    votesFor: 0,
    votesAgainst: 0,
    votes: {},
    status: "active",
    openedAt: now,
    closesAt: new Date(now.getTime() + SYSTEM_NO_CONFIDENCE_HOURS * 3_600_000),
    closesOnTurn: currentTurn + SYSTEM_NO_CONFIDENCE_HOURS,
    closedAt: null,
    turnProposed: currentTurn,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection<NoConfidenceVote>("noConfidenceVotes").insertOne(voteDoc);

  // Stamp the active vote on the formation row so player-driven
  // proposeNoConfidence can't double-fire while this is in progress.
  await db
    .collection<GovernmentFormation>("governmentFormations")
    .updateOne({ _id: countryId }, { $set: { activeVoteId: voteId, updatedAt: now } });

  return { triggered: true, voteId: voteId.toString() };
}
