import { ObjectId, type Db } from "mongodb";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { createNotification } from "@/lib/notifications";
import { createSystemNewsPost } from "@/lib/news";
import { recordAudit } from "@/lib/audit/recordAudit";
import {
  buildEmbeddedVoteTallyUpdate,
  buildMotionVoteTallyUpdate,
} from "@/lib/votes/embeddedVoteTally";
import { getEligibleVoterSet } from "@/lib/parties/proposals";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { validateManifestoPledges } from "@/lib/db/collections/manifestos";
import { MANIFESTO_PLEDGE_COUNT } from "@/lib/db/types/manifesto";
import type { PartyGroupFavorability } from "@/lib/db/types/partyGroupFavorability";
import {
  getUKPartyConferencesCollection,
  getUKPartyPlatformsCollection,
} from "@/lib/db/collections/ukPartyConferences";
import { pledgeCatalogFor } from "@/lib/uk/manifesto/pledgeCatalog";
import { selectNppPledges } from "@/lib/uk/manifesto/nppManifesto";
import {
  getOrSeedPartyLeadership,
  historyEntry,
  pushHistoryEntry,
} from "@/lib/uk/leadership/leadershipStore";
import { getUKPartyLeadershipCollection } from "@/lib/db/collections/ukPartyLeadership";
import {
  LEADERSHIP_AMENDMENT_COOLDOWN_TURNS,
  validateRulesetAmendment,
  type RulesetAmendmentPatch,
} from "@/lib/uk/leadership/rules";
import { resolvePartyPsCap, resolvePartyTier } from "@/lib/parties/partyTier";
import { NATIONAL_PS_CAP } from "@/lib/politicalStrength/strengthConstants";
import {
  CONFERENCE_APPROVAL_DELTA,
  CONFERENCE_COHESION_PS,
  CONFERENCE_MAX_PAYOFF_GROUPS,
  CONFERENCE_MOTION_QUORUM_FLOOR,
  CONFERENCE_PAYOFF_DURATION_TURNS,
  CONFERENCE_PLATFORM_QUORUM_FLOOR,
  conferenceOpensAtTurn,
  conferenceVotingClosesTurn,
  conferenceYearForTurn,
  conferenceYearStartTurn,
  isConferencePayoffEnabled,
  payoffGroupsForPledges,
  quorumFor,
  resolveConferenceMotion,
  resolvePlatformRatification,
} from "@/lib/uk/conference/rules";
import {
  conferenceDocId,
  conferenceHistoryEntry,
  getConference,
  getOrSeedConference,
  pushConferenceHistory,
} from "@/lib/uk/conference/conferenceStore";
import type {
  ConferenceHistoryEntry,
  ConferenceRulesMotion,
  UKPartyConference,
} from "@/lib/uk/conference/types";
import type { Character, PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

/**
 * UK party conferences — shell commands (epic #856, ticket #862).
 *
 * Annual per-party lifecycle stacked on the #861 committee model:
 *  - the conference RATIFIES the standing platform (pledge catalog ids in
 *    manifesto shape) between elections; the leader finalises the election
 *    manifesto FROM it at dissolution (see manifestoLifecycle handoff);
 *  - committee business runs as rules-amendment motions under the #861
 *    authority model (committee proposes/votes; safe bounds + cooldown
 *    enforced on apply, so a passed motion can still void);
 *  - a ratified conference pays a bounded approval/cohesion payoff once,
 *    through the vote engine's partyGroupFavorability rows (approval) and
 *    the party PS reserve (cohesion).
 *
 * Ratifying a platform never touches the manifestos collection; locking an
 * election manifesto never touches the platform row. That split IS the
 * conference/manifesto distinction.
 */

export interface ConferenceActor {
  _id: ObjectId;
  name: string;
  party?: string;
  userId?: ObjectId;
}

async function requireParty(
  db: Db,
  countryId: CountryId,
  partySeqId: string
): Promise<PoliticalParty> {
  const party = await findPartyBySequentialId(db, partySeqId, countryId);
  if (!party) throw notFound("Party");
  return party;
}

function partySeqIdOf(party: PoliticalParty): string {
  return String(party.sequentialId);
}

function isPartyMember(actor: ConferenceActor, party: PoliticalParty): boolean {
  return actor.party != null && actor.party === partySeqIdOf(party);
}

function isCommitteeMember(actor: ConferenceActor, party: PoliticalParty): boolean {
  return getEligibleVoterSet(party).has(actor._id.toString());
}

function isLeader(actor: ConferenceActor, party: PoliticalParty): boolean {
  return party.chairId != null && party.chairId.equals(actor._id);
}

/** Player members of the party (the platform-ratification electorate). */
async function countPartyMembers(db: Db, party: PoliticalParty): Promise<number> {
  return db.collection<Character>("characters").countDocuments({
    party: partySeqIdOf(party),
    userId: { $exists: true },
  });
}

async function requirePartyMemberCharacter(
  db: Db,
  party: PoliticalParty,
  voter: ConferenceActor
): Promise<void> {
  const member = await db
    .collection<Character>("characters")
    .findOne({ _id: voter._id, userId: { $exists: true } }, { projection: { party: 1 } });
  if (!member || member.party !== partySeqIdOf(party)) {
    throw forbidden("Only party members vote at conference");
  }
}

interface EligibleRoll {
  memberIds: string[];
  committeeIds: string[];
}

/** The durable roll on a row, or null when it has not frozen yet. */
function frozenRollOf(doc: UKPartyConference): EligibleRoll | null {
  if (Array.isArray(doc.eligibleMemberIds) && Array.isArray(doc.eligibleCommitteeIds)) {
    return { memberIds: doc.eligibleMemberIds, committeeIds: doc.eligibleCommitteeIds };
  }
  return null;
}

/** Live electorate: player-member characters plus the committee voter set. */
async function computeEligibleRoll(db: Db, party: PoliticalParty): Promise<EligibleRoll> {
  const rows = await db
    .collection<Character>("characters")
    .find({ party: partySeqIdOf(party), userId: { $exists: true } }, { projection: { _id: 1 } })
    .toArray();
  return {
    memberIds: rows.map((row) => row._id.toString()).sort(),
    committeeIds: [...getEligibleVoterSet(party)].sort(),
  };
}

/**
 * Freeze the conference's authoritative roll, exactly once. The in-hand doc
 * is authoritative when it already carries a roll (no extra read on the
 * steady path); otherwise one guarded write elects the freezer and every
 * loser re-reads the winner's roll, so concurrent first touches converge on
 * one electorate instead of racing live membership reads.
 *
 * `persisted: false` is the defensive remainder: the row vanished under the
 * freeze, so the caller decides from live inputs without a roll filter
 * rather than failing a legitimate vote.
 */
async function ensureEligibleRoll(
  db: Db,
  party: PoliticalParty,
  doc: UKPartyConference,
  now: Date
): Promise<EligibleRoll & { persisted: boolean }> {
  const existing = frozenRollOf(doc);
  if (existing) return { ...existing, persisted: true };
  const live = await computeEligibleRoll(db, party);
  const collection = getUKPartyConferencesCollection(db);
  const claimed = await collection.findOneAndUpdate(
    { _id: doc._id, eligibleMemberIds: null, eligibleCommitteeIds: null },
    {
      $set: {
        eligibleMemberIds: live.memberIds,
        eligibleCommitteeIds: live.committeeIds,
        updatedAt: now,
      },
    },
    { returnDocument: "after" }
  );
  const won = claimed ? frozenRollOf(claimed) : null;
  if (won) return { ...won, persisted: true };
  const reread = await collection.findOne({ _id: doc._id });
  const raced = reread ? frozenRollOf(reread) : null;
  if (raced) return { ...raced, persisted: true };
  return { ...live, persisted: false };
}

/** Valid catalog ids for the standing-platform shape (mirrors manifestos). */
function validPlatformIds(countryId: CountryId): Set<string> {
  return new Set(pledgeCatalogFor(countryId).map((e) => e.id));
}

function validatePlatformShape(countryId: CountryId, pledgeIds: string[]): void {
  const pledges = pledgeIds.map((catalogEntryId) => ({ catalogEntryId }));
  const validation = validateManifestoPledges(pledges, validPlatformIds(countryId));
  if (!validation.ok) throw badRequest(validation.error ?? "Invalid platform");
}

export interface ConferenceCatalogEntry {
  id: string;
  label: string;
  blurb: string;
}

export interface ConferenceStateView {
  conferenceId: string;
  year: number;
  status: UKPartyConference["status"];
  partyId: string;
  partyName: string;
  isNpp: boolean;
  opensAtTurn: number;
  votingClosesTurn: number;
  turnsUntilOpen: number;
  turnsUntilClose: number;
  proposal:
    | (UKPartyConference["proposal"] & {
        quorumNeeded: number;
        eligibleVoters: number;
      })
    | null;
  motions: (ConferenceRulesMotion & { quorumNeeded: number; eligibleVoters: number })[];
  /**
   * True once the conference's voter roll froze. While false the counts
   * below are live; once true they are the frozen electorate, and members
   * who joined afterwards wait for next year's conference.
   */
  rollFrozen: boolean;
  platform: { pledgeIds: string[]; ratifiedYear: number; ratifiedAtTurn: number } | null;
  ratified: boolean;
  outcome: UKPartyConference["outcome"];
  payoff: { due: boolean; appliedTurn: number | null };
  catalog: ConferenceCatalogEntry[];
  capabilities: {
    isPartyMember: boolean;
    isCommitteeMember: boolean;
    isLeader: boolean;
    canPropose: boolean;
    canVote: boolean;
  };
  history: UKPartyConference["history"];
}

/** Read model for the party-hub conference panel + capability gating. */
export async function getConferenceState(
  db: Db,
  countryId: CountryId,
  partySeqId: string,
  year: number,
  viewer: ConferenceActor | null,
  currentTurn: number,
  now: Date
): Promise<ConferenceStateView> {
  const party = await requireParty(db, countryId, partySeqId);
  const doc = await getOrSeedConference(
    db,
    countryId,
    party,
    year,
    conferenceOpensAtTurn(year),
    conferenceVotingClosesTurn(conferenceOpensAtTurn(year)),
    now,
    currentTurn
  );
  const platform = await getUKPartyPlatformsCollection(db).findOne({
    _id: `${countryId}:${partySeqIdOf(party)}`,
  });
  // Surfaced electorate: the frozen roll once it exists, live counts before
  // the first agenda touch freezes it. Quorum denominators below follow the
  // same source, so the panel never shows a bar the resolution will not use.
  const frozen = frozenRollOf(doc);
  const memberCount = frozen != null ? frozen.memberIds.length : await countPartyMembers(db, party);
  const committeeSize =
    frozen != null ? frozen.committeeIds.length : getEligibleVoterSet(party).size;
  const isMember = viewer != null && isPartyMember(viewer, party);
  const isCommittee = viewer != null && isCommitteeMember(viewer, party);
  const leader = viewer != null && isLeader(viewer, party);
  const onRoll =
    viewer == null || frozen == null
      ? viewer != null
      : frozen.memberIds.includes(viewer._id.toString());

  return {
    conferenceId: doc._id,
    year: doc.conferenceYear,
    status: doc.status,
    partyId: partySeqIdOf(party),
    partyName: party.name,
    isNpp: !party.chairId,
    opensAtTurn: doc.opensAtTurn,
    votingClosesTurn: doc.votingClosesTurn,
    turnsUntilOpen: Math.max(0, doc.opensAtTurn - currentTurn),
    turnsUntilClose: doc.status === "open" ? Math.max(0, doc.votingClosesTurn - currentTurn) : 0,
    proposal: doc.proposal
      ? {
          ...doc.proposal,
          quorumNeeded: quorumFor(memberCount, CONFERENCE_PLATFORM_QUORUM_FLOOR),
          eligibleVoters: memberCount,
        }
      : null,
    motions: doc.motions.map((m) => ({
      ...m,
      quorumNeeded: quorumFor(committeeSize, CONFERENCE_MOTION_QUORUM_FLOOR),
      eligibleVoters: committeeSize,
    })),
    rollFrozen: frozen != null,
    platform: platform
      ? {
          pledgeIds: platform.pledgeIds,
          ratifiedYear: platform.ratifiedYear,
          ratifiedAtTurn: platform.ratifiedAtTurn,
        }
      : null,
    ratified: doc.ratified,
    outcome: doc.outcome,
    payoff: { due: doc.payoffDue, appliedTurn: doc.payoffAppliedTurn },
    catalog: pledgeCatalogFor(countryId).map((e) => ({
      id: e.id,
      label: e.label,
      blurb: e.blurb ?? "",
    })),
    capabilities: {
      isPartyMember: isMember,
      isCommitteeMember: isCommittee,
      isLeader: leader,
      canPropose: (leader || isCommittee) && doc.status === "open",
      // Voting needs a roll seat as well as live membership: joining after
      // the freeze confers no vote at this conference.
      canVote: isMember && onRoll && doc.status === "open",
    },
    history: doc.history,
  };
}

/**
 * Manually schedule this year's conference (normally the turn driver seeds
 * it at the year's first turn). Idempotent: re-scheduling returns the row.
 */
export async function scheduleConference(
  db: Db,
  countryId: CountryId,
  partySeqId: string,
  actor: ConferenceActor,
  currentTurn: number,
  now: Date
): Promise<{ success: true; conferenceId: string; status: UKPartyConference["status"] }> {
  const party = await requireParty(db, countryId, partySeqId);
  if (!isPartyMember(actor, party)) throw forbidden("Only party members can schedule a conference");
  if (!isLeader(actor, party) && !isCommitteeMember(actor, party)) {
    throw forbidden("Only the leader or committee can schedule a conference");
  }
  const year = conferenceYearForTurn(currentTurn);
  const opensAt = Math.max(currentTurn + 1, conferenceOpensAtTurn(year));
  const closesAt = conferenceVotingClosesTurn(opensAt);
  if (!(await getConference(db, countryId, partySeqId, year))) {
    // A conference only lives inside its own conference year: every agenda
    // command and the turn driver address the current year's row, so a
    // window that spills past the year's last turn could never resolve.
    // Late in the year there is no room left; the next annual conference
    // seeds automatically at the year's first turn.
    const yearEndTurn = conferenceYearStartTurn(year + 1) - 1;
    if (closesAt > yearEndTurn) {
      throw badRequest(
        `Too late in the conference year to schedule: voting would close on turn ${closesAt}, after year ${year} ends (turn ${yearEndTurn})`
      );
    }
  }
  const doc = await getOrSeedConference(
    db,
    countryId,
    party,
    year,
    opensAt,
    closesAt,
    now,
    currentTurn
  );
  return { success: true, conferenceId: doc._id, status: doc.status };
}

/**
 * Propose (or replace) the standing-platform draft: exactly
 * MANIFESTO_PLEDGE_COUNT valid catalog pledges. Leader or committee only;
 * replacing resets the vote. Never writes manifestos.
 */
export async function proposePlatform(
  db: Db,
  countryId: CountryId,
  partySeqId: string,
  actor: ConferenceActor,
  pledgeIds: string[],
  currentTurn: number,
  now: Date
): Promise<{ success: true; conferenceId: string }> {
  const party = await requireParty(db, countryId, partySeqId);
  if (!isPartyMember(actor, party)) throw forbidden("Only party members can propose a platform");
  if (!isLeader(actor, party) && !isCommitteeMember(actor, party)) {
    throw forbidden("Only the leader or committee can propose the conference platform");
  }
  validatePlatformShape(countryId, pledgeIds);
  const year = conferenceYearForTurn(currentTurn);
  const doc = await getOrSeedConference(
    db,
    countryId,
    party,
    year,
    conferenceOpensAtTurn(year),
    conferenceVotingClosesTurn(conferenceOpensAtTurn(year)),
    now,
    currentTurn
  );
  if (doc.status !== "open") {
    throw badRequest(`Conference is ${doc.status}: platforms can only be proposed while open`);
  }
  // First agenda touch freezes the roll: the electorate for every vote and
  // quorum at this conference is the membership as of now, not as of resolve.
  await ensureEligibleRoll(db, party, doc, now);
  const updated = await getUKPartyConferencesCollection(db).findOneAndUpdate(
    { _id: doc._id, status: "open" },
    {
      $set: {
        proposal: {
          pledgeIds: [...pledgeIds],
          proposedByCharacterId: actor._id,
          proposedByName: actor.name,
          proposedAtTurn: currentTurn,
          votesFor: 0,
          votesAgainst: 0,
          votes: {},
          status: "voting",
          resolvedAtTurn: null,
        },
        history: pushConferenceHistory(
          doc.history,
          conferenceHistoryEntry(
            currentTurn,
            "platformProposed",
            `${actor.name} proposed a ${pledgeIds.length}-pledge standing platform`,
            { characterId: actor._id, actorName: actor.name }
          )
        ),
        updatedAt: now,
      },
    },
    { returnDocument: "after" }
  );
  if (!updated) throw conflict("Conference closed while proposing");
  recordAudit({
    source: "api",
    category: "party",
    action: "uk.conference.platformProposed",
    outcome: "ok",
    actor: { kind: "player", characterId: actor._id, name: actor.name },
    subject: { type: "party", id: partySeqIdOf(party), name: party.name },
    meta: { conferenceId: doc._id, pledgeIds },
  });
  return { success: true, conferenceId: doc._id };
}

/** Cast (or change) a platform vote. Aye ratifies, nay rejects. */
export async function voteOnPlatform(
  db: Db,
  countryId: CountryId,
  partySeqId: string,
  voter: ConferenceActor,
  vote: "aye" | "nay",
  currentTurn: number,
  now: Date
): Promise<{ success: true; votesFor: number; votesAgainst: number }> {
  const party = await requireParty(db, countryId, partySeqId);
  if (!isPartyMember(voter, party)) throw forbidden("Only party members vote at conference");
  await requirePartyMemberCharacter(db, party, voter);
  const year = conferenceYearForTurn(currentTurn);
  const doc = await getConference(db, countryId, partySeqId, year);
  if (!doc || doc.status !== "open" || !doc.proposal || doc.proposal.status !== "voting") {
    throw badRequest("No conference platform is open for voting");
  }
  // The roll is the authority at write time, not the party/member rows read
  // above: a join or removal landing between those reads and the tally write
  // cannot seat a ballot the frozen electorate does not hold, and the live
  // pre-checks above keep removals rejected on their next vote while ballots
  // already cast stand.
  const roll = await ensureEligibleRoll(db, party, doc, now);
  const voteKey = voter._id.toString();
  if (roll.persisted && !roll.memberIds.includes(voteKey)) {
    throw forbidden("Only members on the conference roll vote at this conference");
  }
  if (currentTurn >= doc.votingClosesTurn) throw badRequest("Conference voting has closed");
  const updateResult = await getUKPartyConferencesCollection(db).updateOne(
    {
      _id: doc._id,
      status: "open",
      votingClosesTurn: { $gte: currentTurn + 1 },
      ...(roll.persisted ? { eligibleMemberIds: voteKey } : {}),
    },
    buildEmbeddedVoteTallyUpdate({
      voteField: "proposal.votes",
      voteKey,
      vote,
      tallyFieldByVote: { aye: "proposal.votesFor", nay: "proposal.votesAgainst" },
      updatedAt: now,
    })
  );
  if (updateResult.matchedCount === 0) {
    // The write is conditional on open status, window, motion state, and
    // roll seat: re-read to report which guard refused the ballot instead
    // of collapsing every race into one error.
    const reread = await getUKPartyConferencesCollection(db).findOne({ _id: doc._id });
    if (!reread || reread.status !== "open") throw badRequest("Conference voting has closed");
    if (!reread.proposal || reread.proposal.status !== "voting") {
      throw badRequest("No conference platform is open for voting");
    }
    if (roll.persisted && !roll.memberIds.includes(voteKey)) {
      throw forbidden("Only members on the conference roll vote at this conference");
    }
    throw badRequest("Conference voting has closed");
  }
  const updated = await getUKPartyConferencesCollection(db).findOne({ _id: doc._id });
  return {
    success: true,
    votesFor: updated?.proposal?.votesFor ?? 0,
    votesAgainst: updated?.proposal?.votesAgainst ?? 0,
  };
}

/**
 * Propose a leadership-ruleset amendment as conference committee business.
 * Committee only; the patch must pass the #861 safe-bounds validation now.
 * Cooldown is enforced at resolve time (a passed motion can still void).
 */
export async function proposeRulesMotion(
  db: Db,
  countryId: CountryId,
  partySeqId: string,
  actor: ConferenceActor,
  patch: RulesetAmendmentPatch,
  currentTurn: number,
  now: Date
): Promise<{ success: true; conferenceId: string; motionId: string }> {
  const party = await requireParty(db, countryId, partySeqId);
  if (!isPartyMember(actor, party)) throw forbidden("Only party members can propose motions");
  if (!isCommitteeMember(actor, party)) {
    throw forbidden("Only the party committee can propose leadership-rules motions");
  }
  const validation = validateRulesetAmendment(patch);
  if (!validation.ok) throw badRequest(validation.errors.join("; "));
  const year = conferenceYearForTurn(currentTurn);
  const doc = await getOrSeedConference(
    db,
    countryId,
    party,
    year,
    conferenceOpensAtTurn(year),
    conferenceVotingClosesTurn(conferenceOpensAtTurn(year)),
    now,
    currentTurn
  );
  if (doc.status !== "open") {
    throw badRequest(`Conference is ${doc.status}: motions can only be proposed while open`);
  }
  // First agenda touch freezes the roll, same as platforms: motion quorum is
  // the committee as of now, not as of resolve.
  await ensureEligibleRoll(db, party, doc, now);
  const motionId = new ObjectId().toString();
  const motion: ConferenceRulesMotion = {
    motionId,
    patch,
    proposedByCharacterId: actor._id,
    proposedByName: actor.name,
    createdAtTurn: currentTurn,
    votesFor: 0,
    votesAgainst: 0,
    votes: {},
    status: "voting",
    voidReason: null,
    resolvedAtTurn: null,
  };
  const updated = await getUKPartyConferencesCollection(db).findOneAndUpdate(
    { _id: doc._id, status: "open" },
    {
      $set: {
        history: pushConferenceHistory(
          doc.history,
          conferenceHistoryEntry(
            currentTurn,
            "motionProposed",
            `${actor.name} proposed a leadership-rules amendment at conference`,
            { characterId: actor._id, actorName: actor.name }
          )
        ),
        updatedAt: now,
      },
      $push: { motions: motion },
    },
    { returnDocument: "after" }
  );
  if (!updated) throw conflict("Conference closed while proposing");
  recordAudit({
    source: "api",
    category: "party",
    action: "uk.conference.motionProposed",
    outcome: "ok",
    actor: { kind: "player", characterId: actor._id, name: actor.name },
    subject: { type: "party", id: partySeqIdOf(party), name: party.name },
    meta: { conferenceId: doc._id, motionId, patch },
  });
  return { success: true, conferenceId: doc._id, motionId };
}

/** Cast (or change) a committee vote on a rules motion. */
export async function voteOnMotion(
  db: Db,
  countryId: CountryId,
  partySeqId: string,
  motionId: string,
  voter: ConferenceActor,
  vote: "aye" | "nay",
  currentTurn: number,
  now: Date
): Promise<{ success: true; votesFor: number; votesAgainst: number }> {
  const party = await requireParty(db, countryId, partySeqId);
  if (!isPartyMember(voter, party)) throw forbidden("Only party members vote at conference");
  if (!isCommitteeMember(voter, party)) {
    throw forbidden("Only the party committee votes on leadership-rules motions");
  }
  const year = conferenceYearForTurn(currentTurn);
  const doc = await getConference(db, countryId, partySeqId, year);
  const motion = doc?.motions.find((m) => m.motionId === motionId);
  if (!doc || doc.status !== "open" || !motion || motion.status !== "voting") {
    throw badRequest("No such motion is open for voting");
  }
  // Atomic per-motion tally: the $map pipeline reads the stored vote at write
  // time, so concurrent votes on the same motion converge (new vote applies,
  // repeat vote is a tally no-op, changed vote moves the tally) instead of
  // clobbering each other like the old whole-array read/modify/write. The
  // status + votingClosesTurn guard in the filter makes the write conditional:
  // a vote racing the window close or the resolution claim matches zero
  // documents and reports closed instead of writing into a decided row.
  //
  // Member-roll drift is closed by the frozen committee roll: eligibility is
  // pre-checked from the live party row (so removals are rejected on their
  // next vote and ballots already cast stand), and the write additionally
  // requires a roll seat, so a join or removal landing between the read and
  // the write cannot seat a ballot the frozen electorate does not hold. A
  // deferred write from a ballot cast while eligible still lands, because the
  // roll is immutable.
  //
  // Leadership-cooldown serialization lives in applyPassedMotion, not here:
  // the cooldown travels with the leadership write (compare-and-swap on the
  // observed lastAmendedTurn), so concurrent applies of distinct motions
  // elect exactly one winner and every loser voids on re-read instead of
  // landing a second patch inside the window. Voting needs no cooldown gate:
  // a passed motion can still void at apply time.
  const roll = await ensureEligibleRoll(db, party, doc, now);
  const voteKey = voter._id.toString();
  if (roll.persisted && !roll.committeeIds.includes(voteKey)) {
    throw forbidden("Only committee members on the conference roll vote on motions");
  }
  if (currentTurn >= doc.votingClosesTurn) throw badRequest("Conference voting has closed");
  const updateResult = await getUKPartyConferencesCollection(db).updateOne(
    {
      _id: doc._id,
      status: "open",
      votingClosesTurn: { $gte: currentTurn + 1 },
      ...(roll.persisted ? { eligibleCommitteeIds: voteKey } : {}),
    },
    buildMotionVoteTallyUpdate({
      motionId,
      voteKey,
      vote,
      tallyFieldByVote: { aye: "votesFor", nay: "votesAgainst" },
      updatedAt: now,
    })
  );
  if (updateResult.matchedCount === 0) {
    const reread = await getUKPartyConferencesCollection(db).findOne({ _id: doc._id });
    if (!reread || reread.status !== "open") throw badRequest("Conference voting has closed");
    const rereadMotion = reread.motions.find((m) => m.motionId === motionId);
    if (!rereadMotion || rereadMotion.status !== "voting") {
      throw badRequest("No such motion is open for voting");
    }
    if (roll.persisted && !roll.committeeIds.includes(voteKey)) {
      throw forbidden("Only committee members on the conference roll vote on motions");
    }
    throw badRequest("Conference voting has closed");
  }
  const updated = await getUKPartyConferencesCollection(db).findOne({ _id: doc._id });
  const resolved = updated?.motions.find((m) => m.motionId === motionId);
  if (!resolved) throw badRequest("Conference voting has closed");
  return { success: true, votesFor: resolved.votesFor, votesAgainst: resolved.votesAgainst };
}

/**
 * Deterministic NPP platform proposal for AI-run parties (no chair):
 * the catalog pledges closest to the party's own ideology, via the same
 * selector the election manifesto path uses. No conference motion business
 * for NPPs; their rulesets stay at seed.
 */
export async function ensureNppPlatformProposal(
  db: Db,
  countryId: CountryId,
  party: PoliticalParty,
  doc: UKPartyConference,
  currentTurn: number,
  now: Date
): Promise<boolean> {
  if (doc.proposal) return false;
  const catalog = pledgeCatalogFor(countryId);
  const pledgeIds = selectNppPledges(
    catalog,
    party.economicPosition ?? 0,
    party.socialPosition ?? 0
  );
  if (pledgeIds.length !== MANIFESTO_PLEDGE_COUNT) return false;
  const updated = await getUKPartyConferencesCollection(db).findOneAndUpdate(
    { _id: doc._id, status: "open", proposal: null },
    {
      $set: {
        proposal: {
          pledgeIds,
          proposedByCharacterId: new ObjectId("000000000000000000000000"),
          proposedByName: "Conference committee",
          proposedAtTurn: currentTurn,
          votesFor: 0,
          votesAgainst: 0,
          votes: {},
          status: "voting",
          resolvedAtTurn: null,
        },
        history: pushConferenceHistory(
          doc.history,
          conferenceHistoryEntry(
            currentTurn,
            "platformProposed",
            "Conference committee tabled the standing platform (AI-run party)"
          )
        ),
        updatedAt: now,
      },
    },
    { returnDocument: "after" }
  );
  return updated != null;
}

/**
 * Receipt/void crash-concurrency contract (ticket #862 follow-up). A motion
 * marked void while its leadership receipt exists is a mislabel: the winning
 * applier created the receipt after this pass's last confirmation read and
 * crashed before marking. Completed receipts dominate voids
 * deterministically:
 *
 * - the mark-time recheck in computeReconcileDecisions flips any void whose
 *   receipt landed during the pass, so the mark write never stamps void over
 *   a receipt it could have seen;
 * - a race-path void (CONFERENCE_RACE_VOID_REASON) stays heal-owed through
 *   conferenceResolutionNeedsHeal, so the turn driver self-revisits the row
 *   on the next tick without an explicit resolve call;
 * - the revisit confirms the void terminal (CONFERENCE_RACE_VOID_CONFIRMED)
 *   when the receipt is still absent, so retries are bounded: at most one
 *   follow-up pass per race void, then the row is quiet.
 *
 * Cooldown and validation voids are terminal at mark time. A cooldown void
 * implies the receipt was absent at the final check and no concurrent
 * same-motion apply could have succeeded under the active cooldown; a
 * validation void's patch could never have landed a receipt.
 */
export const CONFERENCE_RACE_VOID_REASON =
  "void: concurrent leadership-rules amendment won the cooldown race";
export const CONFERENCE_RACE_VOID_CONFIRMED = `${CONFERENCE_RACE_VOID_REASON} (confirmed: no effect applied)`;

async function applyPassedMotion(
  db: Db,
  countryId: CountryId,
  party: PoliticalParty,
  leadershipId: string,
  motion: ConferenceRulesMotion,
  currentTurn: number,
  now: Date
): Promise<{ applied: boolean; voidReason: string | null }> {
  const collection = getUKPartyLeadershipCollection(db);
  // Durable serialization contract for distinct motions (ticket #862
  // follow-up). Two reconcilers must not both pass a stale cooldown check and
  // land mutually invalid patches, while retries of the same motion stay
  // exactly-once:
  //
  // - Same motion: the motion receipt (`appliedConferenceMotionIds`, guarded
  //   by `$ne` in the write filter) makes replays and concurrent appliers of
  //   the SAME motion converge on applied without a second write.
  // - Distinct motions: the cooldown travels WITH the write as a
  //   compare-and-swap on the observed `lastAmendedTurn`. The first writer
  //   moves it to the current turn, so every later distinct writer misses its
  //   filter and voids on re-read instead of landing a second patch inside
  //   the window. `{ lastAmendedTurn: null }` matches null AND missing, so a
  //   legacy row without the field satisfies the first amendment.
  // - A void is returned only after confirming the receipt is still absent: a
  //   concurrent winner may have applied THIS motion between our read and our
  //   decision, and that must report applied, never void.
  for (let attempt = 0; attempt < 2; attempt++) {
    const leadership = await getOrSeedPartyLeadership(db, countryId, party, now, currentTurn);
    if ((leadership.appliedConferenceMotionIds ?? []).includes(motion.motionId)) {
      // Replay guard: the effect is already durable, so there is nothing to
      // re-apply. The write below is conditional on the same receipt, so even
      // a concurrent caller that passed this check cannot double-apply.
      return { applied: true, voidReason: null };
    }
    if (!Array.isArray(leadership.appliedConferenceMotionIds)) {
      // Pre-receipt leadership row: create the receipt array before the
      // conditional write below needs it. Idempotent; real Mongo would also
      // create it via $push, but the test stand-in requires the array.
      await collection.updateOne(
        { _id: leadershipId },
        { $set: { appliedConferenceMotionIds: [], updatedAt: now } }
      );
    }
    const observedAmendTurn = leadership.lastAmendedTurn ?? null;
    const sinceAmend = observedAmendTurn == null ? undefined : currentTurn - observedAmendTurn;
    if (sinceAmend !== undefined && sinceAmend < LEADERSHIP_AMENDMENT_COOLDOWN_TURNS) {
      const current = await collection.findOne({ _id: leadershipId });
      if ((current?.appliedConferenceMotionIds ?? []).includes(motion.motionId)) {
        return { applied: true, voidReason: null };
      }
      const sinceCurrent =
        current?.lastAmendedTurn == null ? undefined : currentTurn - current.lastAmendedTurn;
      if (sinceCurrent !== undefined && sinceCurrent < LEADERSHIP_AMENDMENT_COOLDOWN_TURNS) {
        return {
          applied: false,
          voidReason: `void: rules amended ${sinceCurrent} turn(s) ago, cooldown is ${LEADERSHIP_AMENDMENT_COOLDOWN_TURNS}`,
        };
      }
      // The cooldown lifted under us (a cross-turn stale read): retry once
      // from the fresh state instead of voiding or applying blind.
      continue;
    }
    const validation = validateRulesetAmendment(motion.patch);
    if (!validation.ok) {
      return { applied: false, voidReason: `void: ${validation.errors.join("; ")}` };
    }
    const ruleset = { ...leadership.ruleset, ...motion.patch };
    // Effect + receipt in ONE conditional write: the ruleset patch, the audit
    // entry, and the motion receipt land together or not at all; the $ne
    // guard makes a same-motion replay match zero documents, and the
    // lastAmendedTurn predicate makes a distinct-motion loser miss.
    const write = await collection.updateOne(
      {
        _id: leadershipId,
        appliedConferenceMotionIds: { $ne: motion.motionId },
        lastAmendedTurn: observedAmendTurn,
      },
      {
        $set: {
          ruleset,
          lastAmendedTurn: currentTurn,
          lastAmendedByCharacterId: motion.proposedByCharacterId,
          history: pushHistoryEntry(
            leadership.history,
            historyEntry(
              currentTurn,
              "rulesAmended",
              `Conference motion carried: committee amended removal rules (${motion.motionId})`,
              { characterId: motion.proposedByCharacterId, actorName: motion.proposedByName }
            )
          ),
          updatedAt: now,
        },
        $push: { appliedConferenceMotionIds: motion.motionId },
      }
    );
    if (write.matchedCount === 1) {
      recordAudit({
        source: "turn",
        category: "party",
        action: "uk.conference.motionApplied",
        outcome: "ok",
        subject: { type: "party", id: partySeqIdOf(party), name: party.name },
        meta: { motionId: motion.motionId, patch: motion.patch },
      });
      return { applied: true, voidReason: null };
    }
    // Miss: a concurrent writer moved the receipt or the cooldown first. The
    // loop re-reads fresh: a same-motion receipt reports applied, an active
    // cooldown voids, a lifted cooldown retries the write once.
  }
  // Two misses with no stable classification: writers are racing every
  // attempt. Confirm the receipt one last time so a completed apply is never
  // mislabeled, then void deterministically instead of spinning.
  const current = await collection.findOne({ _id: leadershipId });
  if ((current?.appliedConferenceMotionIds ?? []).includes(motion.motionId)) {
    return { applied: true, voidReason: null };
  }
  return {
    applied: false,
    voidReason: CONFERENCE_RACE_VOID_REASON,
  };
}

export interface ConferenceResolution {
  completed: boolean;
  ratified: boolean;
  motionsPassed: number;
  motionsVoided: number;
}

/**
 * Pure in-memory gate: does a completed row still owe resolution side
 * effects (standing-platform write or motion applications)? Lets the turn
 * driver heal crashed rows without extra reads.
 */
export function conferenceResolutionNeedsHeal(doc: UKPartyConference): boolean {
  if (doc.status !== "completed" || doc.outcome == null) return false;
  if (doc.ratified && doc.platformAppliedTurn == null) return true;
  const applied = new Set(doc.appliedMotionIds ?? []);
  if (
    (doc.motions ?? []).some(
      (motion) =>
        motion.status === "voting" || (motion.status === "passed" && !applied.has(motion.motionId))
    )
  ) {
    return true;
  }
  // A pending race-path void still owes one receipt-confirming revisit: the
  // winning applier may have created the receipt after this row's last
  // confirmation read and crashed before marking. The revisit adopts the
  // receipt (passed) or confirms the void terminal, so it runs at most once.
  return (doc.motions ?? []).some(
    (motion) =>
      motion.status === "void" &&
      motion.voidReason === CONFERENCE_RACE_VOID_REASON &&
      !applied.has(motion.motionId)
  );
}

/** Committee-vote decision for one motion, shared by fill and reconcile. */
function decideMotionVote(
  motion: ConferenceRulesMotion,
  committeeSize: number,
  isNpp: boolean
): { votesFor: number; votesAgainst: number; passed: boolean; reason: string } {
  let votesFor = motion.votesFor;
  const votesAgainst = motion.votesAgainst;
  if (isNpp && votesFor + votesAgainst === 0) {
    // Deterministic NPP committee: a valid tabled motion carries.
    votesFor = Math.max(1, committeeSize);
  }
  const result = resolveConferenceMotion({ votesFor, votesAgainst, eligibleCount: committeeSize });
  return { votesFor, votesAgainst, passed: result.passed, reason: result.reason };
}

/**
 * Fill a claimed-but-unresolved row: decide the platform vote and every
 * motion vote from the frozen snapshot, then persist the whole decision in
 * ONE guarded write. The outcome-null guard elects exactly one filler, so
 * concurrent callers and crash resumes converge instead of double-filling.
 * No cross-collection side effects happen here; those reconcile afterwards.
 */
async function fillConferenceResolution(
  db: Db,
  party: PoliticalParty,
  doc: UKPartyConference,
  currentTurn: number,
  now: Date
): Promise<{ won: boolean; doc: UKPartyConference }> {
  const isNpp = !party.chairId;
  // Quorum decides from the frozen roll, never from live membership: joins
  // after the freeze cannot inflate the bar and removals cannot shrink it.
  // A legacy row that never froze freezes here, during the fill; only a
  // freeze that cannot persist falls back to live counts for this decision.
  const roll = await ensureEligibleRoll(db, party, doc, now);
  const memberCount = roll.persisted ? roll.memberIds.length : await countPartyMembers(db, party);
  const committeeSize = roll.persisted ? roll.committeeIds.length : getEligibleVoterSet(party).size;
  let ratified = false;
  let proposal = doc.proposal;
  const history = [...(doc.history ?? [])];
  if (proposal && proposal.status === "voting") {
    if (isNpp && proposal.votesFor + proposal.votesAgainst === 0) {
      // AI-run parties acclaim a valid tabled platform: deterministic, no rng.
      proposal = { ...proposal, status: "ratified", resolvedAtTurn: currentTurn };
      ratified = true;
      history.push(
        conferenceHistoryEntry(
          currentTurn,
          "platformRatified",
          "Conference acclaimed the standing platform (AI-run party)"
        )
      );
    } else {
      const result = resolvePlatformRatification({
        votesFor: proposal.votesFor,
        votesAgainst: proposal.votesAgainst,
        eligibleCount: memberCount,
      });
      proposal = {
        ...proposal,
        status: result.passed ? "ratified" : "rejected",
        resolvedAtTurn: currentTurn,
      };
      ratified = result.passed;
      history.push(
        conferenceHistoryEntry(
          currentTurn,
          result.passed ? "platformRatified" : "platformRejected",
          result.passed
            ? `Conference ratified the standing platform (${proposal.votesFor} ratify, ${proposal.votesAgainst} reject)`
            : `Conference rejected the standing platform: ${result.reason}`
        )
      );
    }
  }

  const motions = (doc.motions ?? []).map((motion) => {
    if (motion.status !== "voting") return motion;
    const decided = decideMotionVote(motion, committeeSize, isNpp);
    if (!decided.passed) {
      history.push(
        conferenceHistoryEntry(
          currentTurn,
          "motionFailed",
          `Conference motion ${motion.motionId} failed: ${decided.reason}`
        )
      );
      return {
        ...motion,
        votesFor: decided.votesFor,
        votesAgainst: decided.votesAgainst,
        status: "failed" as const,
        resolvedAtTurn: currentTurn,
      };
    }
    // Tentatively passed: the vote carried, the leadership-ruleset write
    // reconciles afterwards against the motion receipt.
    return {
      ...motion,
      votesFor: decided.votesFor,
      votesAgainst: decided.votesAgainst,
      status: "passed" as const,
      resolvedAtTurn: currentTurn,
    };
  });

  const outcome = ratified ? "ratified" : "closedWithoutRatification";
  const filled = await getUKPartyConferencesCollection(db).findOneAndUpdate(
    { _id: doc._id, status: "completed", outcome: null },
    {
      $set: {
        proposal,
        motions,
        ratified,
        outcome,
        payoffDue: ratified,
        history: pushConferenceHistory(
          history,
          conferenceHistoryEntry(
            currentTurn,
            "completed",
            ratified
              ? "Conference completed: platform ratified, motions reconciling"
              : "Conference completed without ratifying a platform: no payoff"
          )
        ),
        updatedAt: now,
      },
    },
    { returnDocument: "after" }
  );
  return filled ? { won: true, doc: filled } : { won: false, doc };
}

/**
 * A void mark must never durably cover a completed effect. A motion marked
 * void while its leadership receipt exists means the receipt landed after
 * this caller confirmed it absent (a concurrent applier won, or won then
 * crashed before marking): adopt the receipt and mark the motion passed so
 * the next mark write converges instead of cementing the mislabel. Voids
 * with no receipt pass through untouched, so terminal voids stay terminal.
 * Skips the read entirely when the row holds no void motions.
 */
async function adoptReceiptedVoids(
  db: Db,
  countryId: CountryId,
  partySeqId: string,
  working: UKPartyConference
): Promise<UKPartyConference> {
  const voids = (working.motions ?? []).filter((motion) => motion.status === "void");
  if (voids.length === 0) return working;
  const leadership = await getUKPartyLeadershipCollection(db).findOne({
    _id: `${countryId}:${partySeqId}`,
  });
  const receipts = new Set(leadership?.appliedConferenceMotionIds ?? []);
  if (!voids.some((motion) => receipts.has(motion.motionId))) return working;
  return {
    ...working,
    motions: (working.motions ?? []).map((motion) =>
      motion.status === "void" && receipts.has(motion.motionId)
        ? { ...motion, status: "passed" as const, voidReason: null }
        : motion
    ),
  };
}

interface ReconcileDecisions {
  platformAppliedTurn: number | null;
  motions: ConferenceRulesMotion[];
  applied: Set<string>;
  newEntries: ConferenceHistoryEntry[];
  motionsPassed: number;
  motionsVoided: number;
}

/**
 * Compute one reconcile pass over a decided row: the standing-platform
 * upsert (idempotent by key, confirmed via the platform receipt) and each
 * passed motion's leadership write (exactly-once via the motion receipt in
 * the conditional apply). Motion votes are decided first; counts and history
 * are built after the mark-time receipt recheck below, so a receipt that
 * landed mid-pass dominates the void it raced. The caller persists the marks.
 */
async function computeReconcileDecisions(
  db: Db,
  countryId: CountryId,
  party: PoliticalParty,
  partySeqId: string,
  isNpp: boolean,
  working: UKPartyConference,
  currentTurn: number,
  now: Date
): Promise<ReconcileDecisions> {
  // Leftover voting motions on healed rows decide from the same frozen roll
  // the fill used; legacy rows without one fall back to live counts.
  const frozen = frozenRollOf(working);
  const committeeSize =
    frozen != null ? frozen.committeeIds.length : getEligibleVoterSet(party).size;

  let platformAppliedTurn = working.platformAppliedTurn ?? null;
  if (working.ratified && platformAppliedTurn == null) {
    if (!working.proposal) {
      // Decided ratified with no proposal to write: nothing exists to
      // persist, so mark it rather than retrying forever.
      platformAppliedTurn = currentTurn;
    } else {
      const key = `${countryId}:${partySeqId}`;
      const existing = await getUKPartyPlatformsCollection(db).findOne({ _id: key });
      if (existing?.ratifiedConferenceId === working._id) {
        platformAppliedTurn = currentTurn;
      } else {
        await getUKPartyPlatformsCollection(db).updateOne(
          { _id: key },
          {
            $set: {
              countryId,
              partyId: partySeqId,
              pledgeIds: [...working.proposal.pledgeIds],
              ratifiedConferenceId: working._id,
              ratifiedYear: working.conferenceYear,
              ratifiedAtTurn: currentTurn,
              updatedAt: now,
            },
            $setOnInsert: { createdAt: now },
          },
          { upsert: true }
        );
        platformAppliedTurn = currentTurn;
      }
    }
  }

  const applied = new Set(working.appliedMotionIds ?? []);
  type MotionOutcome =
    | { kind: "carried"; motion: ConferenceRulesMotion }
    | { kind: "replayed"; motion: ConferenceRulesMotion }
    | { kind: "failed"; motion: ConferenceRulesMotion; reason: string }
    | { kind: "applied"; motion: ConferenceRulesMotion }
    | { kind: "voided"; motion: ConferenceRulesMotion; voidReason: string };
  const outcomes: MotionOutcome[] = await Promise.all(
    (working.motions ?? []).map(async (motion): Promise<MotionOutcome> => {
      let current = motion;
      if (current.status === "voting") {
        // Leftover from a row decided before vote outcomes were persisted:
        // decide it now from the frozen votes instead of stranding it.
        const decided = decideMotionVote(current, committeeSize, isNpp);
        if (!decided.passed) {
          return {
            kind: "failed",
            motion: {
              ...current,
              votesFor: decided.votesFor,
              votesAgainst: decided.votesAgainst,
              status: "failed" as const,
              resolvedAtTurn: currentTurn,
            },
            reason: decided.reason,
          };
        }
        current = {
          ...current,
          votesFor: decided.votesFor,
          votesAgainst: decided.votesAgainst,
          status: "passed" as const,
          resolvedAtTurn: currentTurn,
        };
      }
      if (current.status !== "passed") return { kind: "carried", motion: current };
      if (applied.has(current.motionId)) return { kind: "replayed", motion: current };
      const result = await applyPassedMotion(
        db,
        countryId,
        party,
        `${countryId}:${partySeqId}`,
        current,
        currentTurn,
        now
      );
      if (result.applied) return { kind: "applied", motion: current };
      return {
        kind: "voided",
        motion: {
          ...current,
          status: "void" as const,
          voidReason: result.voidReason,
          resolvedAtTurn: currentTurn,
        },
        voidReason: result.voidReason ?? "void: unknown reason",
      };
    })
  );

  // Mark-time receipt recheck: a winning applier may have created a receipt
  // after this pass's last confirmation read (and crashed before marking).
  // Re-read the receipts once, before the caller stamps the marks, so a
  // completed receipt dominates the void it raced instead of being cemented
  // under it. Voids already pending from a previous pass get their one
  // bounded revisit here: receipted ones flip to passed, still-absent ones
  // confirm terminal. Skipped entirely when no void is in play.
  const pendingBefore = new Set(
    (working.motions ?? [])
      .filter(
        (motion) => motion.status === "void" && motion.voidReason === CONFERENCE_RACE_VOID_REASON
      )
      .map((motion) => motion.motionId)
  );
  const needsRecheck =
    pendingBefore.size > 0 ||
    outcomes.some(
      (outcome) =>
        outcome.kind === "voided" ||
        (outcome.kind === "carried" &&
          outcome.motion.status === "void" &&
          outcome.motion.voidReason === CONFERENCE_RACE_VOID_REASON)
    );
  let receipts = new Set<string>();
  if (needsRecheck) {
    const leadership = await getUKPartyLeadershipCollection(db).findOne({
      _id: `${countryId}:${partySeqId}`,
    });
    receipts = new Set(leadership?.appliedConferenceMotionIds ?? []);
  }

  let motionsPassed = 0;
  let motionsVoided = 0;
  const newEntries: ConferenceHistoryEntry[] = [];
  const passedEntry = (motion: ConferenceRulesMotion): ConferenceHistoryEntry =>
    conferenceHistoryEntry(
      currentTurn,
      "motionPassed",
      `Conference motion ${motion.motionId} passed and amended leadership rules ` +
        `(${motion.votesFor} for, ${motion.votesAgainst} against)`,
      { characterId: motion.proposedByCharacterId, actorName: motion.proposedByName },
      now
    );
  const motions: ConferenceRulesMotion[] = [];
  // A void dominated by a completed receipt: adopt the receipt and mark the
  // motion passed so the mark write converges instead of mislabeling.
  const adoptVoid = (motion: ConferenceRulesMotion): ConferenceRulesMotion => ({
    ...motion,
    status: "passed" as const,
    voidReason: null,
  });
  for (const outcome of outcomes) {
    if (outcome.kind === "carried") {
      const motion = outcome.motion;
      if (motion.status === "void" && motion.voidReason === CONFERENCE_RACE_VOID_REASON) {
        if (receipts.has(motion.motionId)) {
          motionsPassed += 1;
          applied.add(motion.motionId);
          newEntries.push(passedEntry(adoptVoid(motion)));
          motions.push(adoptVoid(motion));
        } else {
          // A carried pending void is always in pendingBefore (it came from
          // the durable row), so this is its one bounded revisit: still no
          // receipt, confirm it terminal. The row goes quiet afterwards.
          motionsVoided += 1;
          newEntries.push(
            conferenceHistoryEntry(
              currentTurn,
              "motionVoided",
              `Conference motion ${motion.motionId} confirmed ${CONFERENCE_RACE_VOID_CONFIRMED}`,
              undefined,
              now
            )
          );
          motions.push({ ...motion, voidReason: CONFERENCE_RACE_VOID_CONFIRMED });
        }
      } else {
        motions.push(motion);
      }
      continue;
    }
    if (outcome.kind === "replayed") {
      motionsPassed += 1;
      motions.push(outcome.motion);
      continue;
    }
    if (outcome.kind === "failed") {
      newEntries.push(
        conferenceHistoryEntry(
          currentTurn,
          "motionFailed",
          `Conference motion ${outcome.motion.motionId} failed: ${outcome.reason}`,
          undefined,
          now
        )
      );
      motions.push(outcome.motion);
      continue;
    }
    if (outcome.kind === "applied") {
      motionsPassed += 1;
      applied.add(outcome.motion.motionId);
      newEntries.push(passedEntry(outcome.motion));
      motions.push(outcome.motion);
      continue;
    }
    if (receipts.has(outcome.motion.motionId)) {
      motionsPassed += 1;
      applied.add(outcome.motion.motionId);
      newEntries.push(passedEntry(adoptVoid(outcome.motion)));
      motions.push(adoptVoid(outcome.motion));
      continue;
    }
    motionsVoided += 1;
    newEntries.push(
      conferenceHistoryEntry(
        currentTurn,
        "motionVoided",
        `Conference motion ${outcome.motion.motionId} passed its vote but ${outcome.voidReason}`,
        undefined,
        now
      )
    );
    motions.push(outcome.motion);
  }

  return { platformAppliedTurn, motions, applied, newEntries, motionsPassed, motionsVoided };
}

/**
 * Reconcile resolution side effects for a decided row (see
 * computeReconcileDecisions). Marks land in ONE batched row write guarded by
 * a compare-and-swap on the row's updatedAt: concurrent reconcilers of the
 * same row converge instead of clobbering each other's marks. The CAS loser
 * re-reads fresh and recomputes (receipts make the re-apply a no-op and
 * receipted voids adopt passed). The mark-time receipt recheck plus the
 * pending-race-void heal invariant mean a void label can never durably cover
 * a completed effect, even when the winning applier's receipt lands after
 * another pass's final confirmation read and the winner crashes before
 * marking: the next driver tick revisits the row from persisted evidence and
 * adopts the receipt (or confirms the void terminal). Attempts are bounded;
 * if contention outlasts them this call stands down and a heal resumes the
 * marks. A crash anywhere before the mark simply reconciles again.
 */
async function reconcileConferenceEffects(
  db: Db,
  countryId: CountryId,
  party: PoliticalParty,
  doc: UKPartyConference,
  currentTurn: number,
  now: Date
): Promise<{ motionsPassed: number; motionsVoided: number }> {
  const partySeqId = partySeqIdOf(party);
  const isNpp = !party.chairId;
  const collection = getUKPartyConferencesCollection(db);
  let stoodDown = { motionsPassed: 0, motionsVoided: 0 };
  for (let attempt = 0; attempt < 3; attempt++) {
    const reread = attempt === 0 ? doc : ((await collection.findOne({ _id: doc._id })) ?? doc);
    const working = await adoptReceiptedVoids(db, countryId, partySeqId, reread);
    const computed = await computeReconcileDecisions(
      db,
      countryId,
      party,
      partySeqId,
      isNpp,
      working,
      currentTurn,
      now
    );
    stoodDown = { motionsPassed: computed.motionsPassed, motionsVoided: computed.motionsVoided };
    const motionsChanged =
      computed.motions.some((motion, index) => motion !== (working.motions ?? [])[index]) ||
      computed.motions.length !== (working.motions ?? []).length;
    if (
      computed.platformAppliedTurn !== (working.platformAppliedTurn ?? null) ||
      motionsChanged ||
      computed.applied.size !== (working.appliedMotionIds ?? []).length ||
      computed.newEntries.length > 0
    ) {
      let history = working.history ?? [];
      for (const entry of computed.newEntries) history = pushConferenceHistory(history, entry);
      const marked = await collection.updateOne(
        {
          _id: working._id,
          ...(working.updatedAt != null ? { updatedAt: working.updatedAt } : {}),
        },
        {
          $set: {
            motions: computed.motions,
            appliedMotionIds: [...computed.applied],
            platformAppliedTurn: computed.platformAppliedTurn,
            history,
            updatedAt: now,
          },
        }
      );
      if (marked.matchedCount === 1) return stoodDown;
      // A concurrent marker won the row under us: re-read fresh and
      // recompute instead of clobbering its marks.
      continue;
    }
    return stoodDown;
  }
  return stoodDown;
}

/**
 * Close a conference whose voting window passed, crash-resumable and
 * replay-safe. Protocol, in order:
 *
 * 1. Claim: open->completed freezes the row (agenda writes require status
 *    open, so votes cannot move under the decision) and elects one
 *    resolver. A crash here leaves the durable recovery state
 *    (completed + outcome null), which any later call resumes.
 * 2. Fill: decide the platform + motion votes from the frozen snapshot in
 *    one outcome-null-guarded write (exactly one filler wins).
 * 3. Reconcile: platform upsert + motion applications against persisted
 *    receipts, so replays skip completed effects instead of double-applying.
 *
 * Returns completed:true only to the caller that won the fill; heal-only
 * and duplicate calls return completed:false after converging the row.
 */
export async function resolveConference(
  db: Db,
  countryId: CountryId,
  party: PoliticalParty,
  doc: UKPartyConference,
  currentTurn: number,
  now: Date
): Promise<ConferenceResolution> {
  const none: ConferenceResolution = {
    completed: false,
    ratified: false,
    motionsPassed: 0,
    motionsVoided: 0,
  };
  const collection = getUKPartyConferencesCollection(db);
  const fresh = (await collection.findOne({ _id: doc._id })) ?? doc;
  if (fresh.status !== "open" && fresh.status !== "completed") return none;

  let working = fresh;
  if (working.status === "open") {
    const claimed = await collection.findOneAndUpdate(
      { _id: doc._id, status: "open" },
      { $set: { status: "completed", updatedAt: now } },
      { returnDocument: "after" }
    );
    working = claimed ?? (await collection.findOne({ _id: doc._id })) ?? fresh;
  }
  if (working.status !== "completed") return none;

  let completedThisCall = false;
  if (working.outcome == null) {
    const filled = await fillConferenceResolution(db, party, working, currentTurn, now);
    if (filled.won) {
      completedThisCall = true;
      working = filled.doc;
    } else {
      working = (await collection.findOne({ _id: doc._id })) ?? working;
      // A concurrent filler is mid-flight or just landed: without a decided
      // row there is nothing safe to reconcile yet; the next tick resumes.
      if (working.outcome == null) return none;
    }
  }

  const effects = await reconcileConferenceEffects(db, countryId, party, working, currentTurn, now);
  if (completedThisCall) {
    const resolution: ConferenceResolution = {
      completed: true,
      ratified: working.ratified,
      motionsPassed: effects.motionsPassed,
      motionsVoided: effects.motionsVoided,
    };
    recordAudit({
      source: "turn",
      category: "party",
      action: "uk.conference.completed",
      outcome: "ok",
      subject: { type: "party", id: partySeqIdOf(party), name: party.name },
      meta: {
        conferenceId: doc._id,
        ratified: resolution.ratified,
        motionsPassed: resolution.motionsPassed,
        motionsVoided: resolution.motionsVoided,
      },
    });
    return resolution;
  }
  return none;
}

export interface ConferencePayoff {
  applied: boolean;
  approvalGroups: number;
  cohesionPs: number;
}

/**
 * Pure gate: payoff work still owed? The turn driver uses this shape
 * (payoffDue with no settle marker) so crashed payoffs resume on the next
 * tick instead of stranding a claimed-but-unapplied row.
 */
export function conferencePayoffNeedsSettle(doc: UKPartyConference): boolean {
  return doc.payoffDue === true && doc.payoffSettledTurn == null;
}

function cohesionGrantFor(party: PoliticalParty): number {
  const tier = resolvePartyTier(party);
  const cap = resolvePartyPsCap(tier, party.psCapEarnedRegions?.length ?? 0, NATIONAL_PS_CAP);
  return Math.max(0, Math.min(CONFERENCE_COHESION_PS, cap - (party.politicalStrength ?? 0)));
}

/** Payoff intent from live state, fixed once at claim and replayed thereafter. */
async function computePayoffIntent(
  db: Db,
  countryId: CountryId,
  party: PoliticalParty,
  proposal: UKPartyConference["proposal"]
): Promise<{ grant: number; groups: string[] }> {
  const partyNow =
    (await db.collection<PoliticalParty>("politicalParties").findOne({ _id: party._id })) ?? party;
  let groups: string[] = [];
  if (proposal && isConferencePayoffEnabled(process.env.UK_CONFERENCE_PAYOFF)) {
    const catalog = pledgeCatalogFor(countryId);
    const salience = new Map(catalog.map((e) => [e.id, Object.keys(e.salienceByGroup ?? {})]));
    groups = payoffGroupsForPledges(proposal.pledgeIds, salience).slice(
      0,
      CONFERENCE_MAX_PAYOFF_GROUPS
    );
  }
  return { grant: cohesionGrantFor(partyNow), groups };
}

/**
 * Apply the completion payoff exactly once per conference: favorability rows
 * for the ratified platform's salient groups (gated by UK_CONFERENCE_PAYOFF
 * until worldsim calibration) plus a PS credit clamped at the party's tier
 * cap. Claim + reconcile protocol:
 *
 * 1. Claim: one guarded write fixes the payoff INTENT (cohesion grant from
 *    the claim-time party, approval groups from the ratified proposal) and
 *    marks the row claimed. Resumes replay the same intent, never a
 *    recomputation from drifted state.
 * 2. Approval rows reconcile via upserts keyed by
 *    (sourceConferenceId, groupId): replays converge, concurrent writers
 *    cannot duplicate.
 * 3. The cohesion credit lands in ONE conditional party write that sets the
 *    `lastConferencePayoffId` receipt atomically with the `$inc`: replays
 *    and concurrent callers match zero documents and cannot double-credit.
 * 4. Settle: a guarded write flips `payoffSettledTurn` only after every
 *    effect verifies durable. Returns applied:true solely to the settler,
 *    so turn telemetry counts each payoff once.
 */
export async function applyConferencePayoff(
  db: Db,
  countryId: CountryId,
  party: PoliticalParty,
  doc: UKPartyConference,
  currentTurn: number,
  now: Date
): Promise<ConferencePayoff> {
  const none: ConferencePayoff = { applied: false, approvalGroups: 0, cohesionPs: 0 };
  const collection = getUKPartyConferencesCollection(db);
  const fresh = (await collection.findOne({ _id: doc._id })) ?? doc;
  if (!conferencePayoffNeedsSettle(fresh)) return none;

  let working = fresh;
  if (working.payoffAppliedTurn == null) {
    const intent = await computePayoffIntent(db, countryId, party, working.proposal);
    const claimed = await collection.findOneAndUpdate(
      { _id: doc._id, payoffDue: true, payoffAppliedTurn: null },
      {
        $set: {
          payoffAppliedTurn: currentTurn,
          payoffCohesionPs: intent.grant,
          payoffApprovalGroups: intent.groups,
          updatedAt: now,
        },
      },
      { returnDocument: "after" }
    );
    // A miss means a concurrent caller owns the claim now; it (or a later
    // tick) settles, so this call stands down instead of duplicating work.
    if (!claimed) return none;
    working = claimed;
  }

  if (working.payoffCohesionPs == null || working.payoffApprovalGroups == null) {
    // Pre-intent legacy row: the old claim stamped no intent, so fix it once
    // from current state. Every effect downstream is idempotent or
    // single-winner, so concurrent fixers converge on the re-read intent.
    const intent = await computePayoffIntent(db, countryId, party, working.proposal);
    await collection.updateOne(
      { _id: working._id },
      {
        $set: {
          payoffCohesionPs: working.payoffCohesionPs ?? intent.grant,
          payoffApprovalGroups: working.payoffApprovalGroups ?? intent.groups,
          updatedAt: now,
        },
      }
    );
    working = (await collection.findOne({ _id: working._id })) ?? working;
  }

  const expectedGroups = working.payoffApprovalGroups ?? [];
  const intentGrant = working.payoffCohesionPs ?? 0;

  for (const groupId of expectedGroups) {
    const row: PartyGroupFavorability = {
      countryId,
      partyId: partySeqIdOf(party),
      groupId,
      favorabilityDelta: CONFERENCE_APPROVAL_DELTA,
      sourceConferenceId: working._id,
      expiresAtTurn: currentTurn + CONFERENCE_PAYOFF_DURATION_TURNS,
      createdAt: now,
    };
    await db
      .collection<PartyGroupFavorability>("partyGroupFavorability")
      .updateOne(
        { sourceConferenceId: working._id, groupId },
        { $setOnInsert: row },
        { upsert: true }
      );
  }

  if (working.payoffCohesionAppliedTurn == null && intentGrant > 0) {
    const partyNow =
      (await db.collection<PoliticalParty>("politicalParties").findOne({ _id: party._id })) ??
      party;
    if ((partyNow.lastConferencePayoffId ?? null) !== working._id) {
      // Reclamp at apply time: the party may have earned PS after the claim
      // fixed the intent, and the tier cap stays binding. A zero effective
      // grant settles as skipped-at-cap below.
      const effective = Math.min(intentGrant, cohesionCapRoom(partyNow));
      if (effective > 0) {
        await db.collection<PoliticalParty>("politicalParties").updateOne(
          { _id: partyNow._id, lastConferencePayoffId: { $ne: working._id } },
          {
            $inc: { politicalStrength: effective },
            $set: { lastConferencePayoffId: working._id, updatedAt: now },
          }
        );
      }
    }
  }

  // Verify every effect before settling; anything still missing stays owed
  // for the next tick instead of being marked done.
  const presentGroups = new Set(
    (
      await db
        .collection<PartyGroupFavorability>("partyGroupFavorability")
        .find({ sourceConferenceId: working._id })
        .toArray()
    ).map((row) => row.groupId)
  );
  const partyCheck =
    (await db.collection<PoliticalParty>("politicalParties").findOne({ _id: party._id })) ?? party;
  const cohesionDone =
    working.payoffCohesionAppliedTurn != null ||
    intentGrant <= 0 ||
    (partyCheck.lastConferencePayoffId ?? null) === working._id ||
    cohesionCapRoom(partyCheck) <= 0;
  if (!expectedGroups.every((groupId) => presentGroups.has(groupId)) || !cohesionDone) {
    return none;
  }

  const settled = await collection.findOneAndUpdate(
    { _id: working._id, payoffSettledTurn: null },
    {
      $set: {
        payoffCohesionAppliedTurn: working.payoffCohesionAppliedTurn ?? currentTurn,
        payoffSettledTurn: currentTurn,
        history: pushConferenceHistory(
          working.history ?? [],
          conferenceHistoryEntry(
            currentTurn,
            "payoffApplied",
            `Well-run conference payoff: +${CONFERENCE_APPROVAL_DELTA} favorability in ${expectedGroups.length} group(s), +${intentGrant} party strength`,
            undefined,
            now
          )
        ),
        updatedAt: now,
      },
    },
    { returnDocument: "after" }
  );
  if (!settled) return none;

  // Everything above is persisted; the chair notice is decorative and must
  // never fail the turn or double-pay on retry.
  try {
    const chair = party.chairId
      ? await db
          .collection<Character>("characters")
          .findOne({ _id: party.chairId }, { projection: { userId: 1, name: 1 } })
      : null;
    if (chair?.userId) {
      await createNotification({
        userId: chair.userId,
        type: "system",
        title: "Conference Concluded",
        message: `Your party conference ratified the standing platform. The party gains +${intentGrant} political strength${expectedGroups.length > 0 ? ` and favorability in ${expectedGroups.length} voter groups` : ""}. The leader will finalise the election manifesto from this platform at dissolution.`,
      });
    }
  } catch {
    // Notification is best-effort; the settle guard already prevents duplicates.
  }
  recordAudit({
    source: "turn",
    category: "party",
    action: "uk.conference.payoffApplied",
    outcome: "ok",
    subject: { type: "party", id: partySeqIdOf(party), name: party.name },
    meta: { conferenceId: doc._id, approvalGroups: expectedGroups.length, cohesionPs: intentGrant },
  });
  return { applied: true, approvalGroups: expectedGroups.length, cohesionPs: intentGrant };
}

/** PS room below the party's tier cap (the binding constraint on the grant). */
function cohesionCapRoom(party: PoliticalParty): number {
  const tier = resolvePartyTier(party);
  const cap = resolvePartyPsCap(tier, party.psCapEarnedRegions?.length ?? 0, NATIONAL_PS_CAP);
  return Math.max(0, cap - (party.politicalStrength ?? 0));
}

/** Standing platforms for every UK party with one (election-handoff read). */
export async function getStandingPlatformsForCountry(
  db: Db,
  countryId: CountryId
): Promise<Map<string, string[]>> {
  const rows = await getUKPartyPlatformsCollection(db).find({ countryId }).toArray();
  return new Map(rows.map((r) => [r.partyId, r.pledgeIds]));
}

/** Conference news hook: system post, fire-and-forget at the call site. */
export async function postConferenceNews(
  partyName: string,
  year: number,
  ratified: boolean
): Promise<void> {
  await createSystemNewsPost(
    ratified
      ? `${partyName} closed its annual conference after ratifying a new standing platform. The leader will finalise the election manifesto from it when an election is called.`
      : `${partyName} closed its annual conference without agreeing a standing platform.`,
    "general",
    {
      title: `${partyName} conference ${year}: ${ratified ? "platform ratified" : "no platform agreed"}`,
    }
  );
}

export { conferenceDocId, conferenceYearForTurn, conferenceYearStartTurn };
