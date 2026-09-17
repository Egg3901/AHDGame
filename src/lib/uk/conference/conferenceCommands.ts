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
import { pledgeCatalogFor } from "../manifesto/pledgeCatalog";
import { selectNppPledges } from "../manifesto/nppManifesto";
import {
  getOrSeedPartyLeadership,
  historyEntry,
  pushHistoryEntry,
} from "../leadership/leadershipStore";
import { getUKPartyLeadershipCollection } from "@/lib/db/collections/ukPartyLeadership";
import {
  LEADERSHIP_AMENDMENT_COOLDOWN_TURNS,
  validateRulesetAmendment,
  type RulesetAmendmentPatch,
} from "../leadership/rules";
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
} from "./rules";
import {
  conferenceDocId,
  conferenceHistoryEntry,
  getConference,
  getOrSeedConference,
  pushConferenceHistory,
} from "./conferenceStore";
import type { ConferenceRulesMotion, UKPartyConference } from "./types";
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
  const [memberCount, platform] = await Promise.all([
    countPartyMembers(db, party),
    getUKPartyPlatformsCollection(db).findOne({
      _id: `${countryId}:${partySeqIdOf(party)}`,
    }),
  ]);
  const committeeSize = getEligibleVoterSet(party).size;
  const isMember = viewer != null && isPartyMember(viewer, party);
  const isCommittee = viewer != null && isCommitteeMember(viewer, party);
  const leader = viewer != null && isLeader(viewer, party);

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
      canVote: isMember && doc.status === "open",
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
  if (currentTurn >= doc.votingClosesTurn) throw badRequest("Conference voting has closed");
  const updateResult = await getUKPartyConferencesCollection(db).updateOne(
    { _id: doc._id, status: "open" },
    buildEmbeddedVoteTallyUpdate({
      voteField: "proposal.votes",
      voteKey: voter._id.toString(),
      vote,
      tallyFieldByVote: { aye: "proposal.votesFor", nay: "proposal.votesAgainst" },
      updatedAt: now,
    })
  );
  if (updateResult.matchedCount === 0) throw badRequest("Conference voting has closed");
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
  if (currentTurn >= doc.votingClosesTurn) throw badRequest("Conference voting has closed");
  // Atomic per-motion tally: the $map pipeline reads the stored vote at write
  // time, so concurrent votes on the same motion converge (new vote applies,
  // repeat vote is a tally no-op, changed vote moves the tally) instead of
  // clobbering each other like the old whole-array read/modify/write. The
  // status + votingClosesTurn guard in the filter makes the write conditional:
  // a vote racing the window close or the resolution claim matches zero
  // documents and reports closed instead of writing into a decided row.
  //
  // Residual hazards, deliberately out of scope for this write (documented,
  // not broadened): committee eligibility is enforced from the party row read
  // above, so a member-roll change landing between that read and this write
  // is honored only on the next vote; and the leadership-cooldown check in
  // reconcileConferenceEffects reads lastAmendedTurn before its conditional
  // receipt write, so two different passed motions reconciling at once can
  // both observe a satisfied cooldown (each motion still applies exactly once
  // via its own appliedConferenceMotionIds receipt).
  const updateResult = await getUKPartyConferencesCollection(db).updateOne(
    { _id: doc._id, status: "open", votingClosesTurn: { $gte: currentTurn + 1 } },
    buildMotionVoteTallyUpdate({
      motionId,
      voteKey: voter._id.toString(),
      vote,
      tallyFieldByVote: { aye: "votesFor", nay: "votesAgainst" },
      updatedAt: now,
    })
  );
  if (updateResult.matchedCount === 0) throw badRequest("Conference voting has closed");
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
  const sinceAmend =
    leadership.lastAmendedTurn == null ? undefined : currentTurn - leadership.lastAmendedTurn;
  if (sinceAmend !== undefined && sinceAmend < LEADERSHIP_AMENDMENT_COOLDOWN_TURNS) {
    return {
      applied: false,
      voidReason: `void: rules amended ${sinceAmend} turn(s) ago, cooldown is ${LEADERSHIP_AMENDMENT_COOLDOWN_TURNS}`,
    };
  }
  const validation = validateRulesetAmendment(motion.patch);
  if (!validation.ok) {
    return { applied: false, voidReason: `void: ${validation.errors.join("; ")}` };
  }
  const ruleset = { ...leadership.ruleset, ...motion.patch };
  // Effect + receipt in ONE conditional write: the ruleset patch, the audit
  // entry, and the motion receipt land together or not at all, and the
  // $ne guard makes a replay match zero documents.
  const write = await collection.updateOne(
    { _id: leadershipId, appliedConferenceMotionIds: { $ne: motion.motionId } },
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
  if (write.matchedCount === 0) {
    // The _id always matches, so a miss means the $ne guard failed: a
    // concurrent resolver applied this motion first. Treat as applied.
    return { applied: true, voidReason: null };
  }
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
  return (doc.motions ?? []).some(
    (motion) =>
      motion.status === "voting" || (motion.status === "passed" && !applied.has(motion.motionId))
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
      const memberCount = await countPartyMembers(db, party);
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

  const committeeSize = getEligibleVoterSet(party).size;
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
 * Reconcile resolution side effects for a decided row: the
 * standing-platform upsert (idempotent by key, confirmed via the platform
 * receipt) and each passed motion's leadership write (exactly-once via the
 * motion receipt in the conditional apply). Marks land in ONE batched row
 * write; a crash anywhere before it simply reconciles again, and the
 * leadership receipt makes the re-apply a no-op.
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
  const committeeSize = getEligibleVoterSet(party).size;
  let motionsPassed = 0;
  let motionsVoided = 0;
  const newEntries: ConferenceHistoryEntry[] = [];

  let platformAppliedTurn = doc.platformAppliedTurn ?? null;
  if (doc.ratified && platformAppliedTurn == null) {
    if (!doc.proposal) {
      // Decided ratified with no proposal to write: nothing exists to
      // persist, so mark it rather than retrying forever.
      platformAppliedTurn = currentTurn;
    } else {
      const key = `${countryId}:${partySeqId}`;
      const existing = await getUKPartyPlatformsCollection(db).findOne({ _id: key });
      if (existing?.ratifiedConferenceId === doc._id) {
        platformAppliedTurn = currentTurn;
      } else {
        await getUKPartyPlatformsCollection(db).updateOne(
          { _id: key },
          {
            $set: {
              countryId,
              partyId: partySeqId,
              pledgeIds: [...doc.proposal.pledgeIds],
              ratifiedConferenceId: doc._id,
              ratifiedYear: doc.conferenceYear,
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

  const applied = new Set(doc.appliedMotionIds ?? []);
  const motions = await Promise.all(
    (doc.motions ?? []).map(async (motion) => {
      let working = motion;
      if (working.status === "voting") {
        // Leftover from a row decided before vote outcomes were persisted:
        // decide it now from the frozen votes instead of stranding it.
        const decided = decideMotionVote(working, committeeSize, isNpp);
        if (!decided.passed) {
          newEntries.push(
            conferenceHistoryEntry(
              currentTurn,
              "motionFailed",
              `Conference motion ${working.motionId} failed: ${decided.reason}`,
              undefined,
              now
            )
          );
          return {
            ...working,
            votesFor: decided.votesFor,
            votesAgainst: decided.votesAgainst,
            status: "failed" as const,
            resolvedAtTurn: currentTurn,
          };
        }
        working = {
          ...working,
          votesFor: decided.votesFor,
          votesAgainst: decided.votesAgainst,
          status: "passed" as const,
          resolvedAtTurn: currentTurn,
        };
      }
      if (working.status !== "passed") return working;
      if (applied.has(working.motionId)) {
        motionsPassed += 1;
        return working;
      }
      const result = await applyPassedMotion(
        db,
        countryId,
        party,
        `${countryId}:${partySeqId}`,
        working,
        currentTurn,
        now
      );
      if (result.applied) {
        motionsPassed += 1;
        applied.add(working.motionId);
        newEntries.push(
          conferenceHistoryEntry(
            currentTurn,
            "motionPassed",
            `Conference motion ${working.motionId} passed and amended leadership rules ` +
              `(${working.votesFor} for, ${working.votesAgainst} against)`,
            { characterId: working.proposedByCharacterId, actorName: working.proposedByName },
            now
          )
        );
        return working;
      }
      motionsVoided += 1;
      newEntries.push(
        conferenceHistoryEntry(
          currentTurn,
          "motionVoided",
          `Conference motion ${working.motionId} passed its vote but ${result.voidReason}`,
          undefined,
          now
        )
      );
      return {
        ...working,
        status: "void" as const,
        voidReason: result.voidReason,
        resolvedAtTurn: currentTurn,
      };
    })
  );

  const motionsChanged = motions.some((motion, index) => motion !== (doc.motions ?? [])[index]);
  if (
    platformAppliedTurn !== (doc.platformAppliedTurn ?? null) ||
    motionsChanged ||
    applied.size !== (doc.appliedMotionIds ?? []).length ||
    newEntries.length > 0
  ) {
    let history = doc.history ?? [];
    for (const entry of newEntries) history = pushConferenceHistory(history, entry);
    await getUKPartyConferencesCollection(db).updateOne(
      { _id: doc._id },
      {
        $set: {
          motions,
          appliedMotionIds: [...applied],
          platformAppliedTurn,
          history,
          updatedAt: now,
        },
      }
    );
  }
  return { motionsPassed, motionsVoided };
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
