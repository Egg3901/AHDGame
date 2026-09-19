import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { LeadershipRemovalRuleset } from "@/lib/uk/leadership/leadershipRemoval";

/** Party family for leadership-removal defaults + committee naming. */
export type LeadershipPartyFamily = "con" | "lab" | "other";

/** Lifecycle of a leadership challenge. */
export type LeadershipChallengeStatus =
  "gathering" | "ballot" | "removed" | "survived" | "cancelled" | "expired";

/** A letter/nomination backing a gathering challenge. */
export interface LeadershipBacker {
  characterId: ObjectId;
  characterName: string;
  backedAtTurn: number;
}

/**
 * One leadership challenge against a sitting party leader.
 *
 * Gathering = collecting letters/nominations toward the ruleset trigger
 * threshold. Ballot = the electorate (MPs or members per ruleset) votes
 * remove (aye) / retain (nay). Terminal states record the outcome.
 */
export interface LeadershipChallenge {
  _id: ObjectId;
  countryId: CountryId;
  /** Party sequentialId as a string. */
  partyId: string;
  /** Sitting leader under challenge (the party chair at initiation). */
  targetCharacterId: ObjectId;
  targetName: string;
  status: LeadershipChallengeStatus;
  backers: LeadershipBacker[];
  /** Snapshot of the ruleset that opened the ballot (immune to later amendments). */
  ballotRuleset: LeadershipRemovalRuleset | null;
  openedBallotAtTurn: number | null;
  closesOnTurn: number | null;
  /** Aye = remove the leader. */
  votesFor: number;
  /** Nay = retain the leader. */
  votesAgainst: number;
  votes: Record<string, "aye" | "nay">;
  createdAtTurn: number;
  createdByCharacterId: ObjectId;
  resolvedAtTurn: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Audit/history entry kinds. Append-only, bounded per document. */
export type LeadershipHistoryKind =
  | "seeded"
  | "rulesAmended"
  | "challengeInitiated"
  | "challengeBacked"
  | "backingWithdrawn"
  | "ballotOpened"
  | "ballotResolved"
  | "challengeExpired"
  | "challengeCancelled";

export interface LeadershipHistoryEntry {
  turn: number;
  at: Date;
  kind: LeadershipHistoryKind;
  actorCharacterId?: ObjectId;
  actorName?: string;
  detail: string;
}

/**
 * Per-party leadership-removal state. One document per UK party, keyed
 * `<countryId>:<partySequentialId>`.
 *
 * The sitting party leader is the party's chairId (PoliticalParty) — removal
 * vacates the chair, and the existing national chair-election machinery seats
 * the successor. No duplicate election system is built here.
 */
export interface UKPartyLeadership {
  _id: string;
  countryId: CountryId;
  partyId: string;
  family: LeadershipPartyFamily;
  committeeName: string;
  ruleset: LeadershipRemovalRuleset;
  lastAmendedTurn: number | null;
  lastAmendedByCharacterId?: ObjectId | null;
  /** Turn a survived ballot resolved on; drives the immunity window. Null = never. */
  lastSurvivalTurn: number | null;
  /**
   * Receipts for conference committee motions (ticket #862) applied to this
   * ruleset. The conference apply writes the ruleset patch and pushes the
   * motion id here in ONE conditional update guarded by
   * `appliedConferenceMotionIds: {$ne: motionId}` (same-motion exactly-once)
   * AND `lastAmendedTurn` equal to the observed value (distinct-motion
   * cooldown serialization: the first writer moves the turn, later distinct
   * writers miss and void). Absent = none applied (covers every legacy row,
   * no migration).
   */
  appliedConferenceMotionIds?: string[];
  /** The one live challenge for this party, if any. */
  activeChallengeId: ObjectId | null;
  history: LeadershipHistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}
