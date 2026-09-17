import { ObjectId, type Db } from "mongodb";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { createNotification } from "@/lib/notifications";
import { createSystemNewsPost } from "@/lib/news";
import { recordAudit } from "@/lib/audit/recordAudit";
import { buildEmbeddedVoteTallyUpdate } from "@/lib/votes/embeddedVoteTally";
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
  getOrSeedConference,
  pushConferenceHistory,
} from "./conferenceStore";
import type { ConferenceRulesMotion, UKPartyConference } from "./types";
import type {
  Character,
  PoliticalParty,
} from "@/lib/db/types";
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
  proposal: UKPartyConference["proposal"] & {
    quorumNeeded: number;
    eligibleVoters: number;
  } | null;
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
    turnsUntilClose:
      doc.status === "open" ? Math.max(0, doc.votingClosesTurn - currentTurn) : 0,
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
      blurb: e.blurb,
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
  const doc = await getOrSeedConference(
    db,
    countryId,
    party,
    year,
    opensAt,
    conferenceVotingClosesTurn(opensAt),
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
  // Whole-array write: committee votes are low-frequency, and this keeps the
  // update to plain $set (no arrayFilters) for the portable store pattern.
  const prev = motion.votes[voter._id.toString()];
  if (prev === vote) {
    return { success: true, votesFor: motion.votesFor, votesAgainst: motion.votesAgainst };
  }
  const votesFor =
    motion.votesFor + (vote === "aye" ? 1 : 0) - (prev === "aye" ? 1 : 0);
  const votesAgainst =
    motion.votesAgainst + (vote === "nay" ? 1 : 0) - (prev === "nay" ? 1 : 0);
  const motions = doc.motions.map((m) =>
    m.motionId === motionId
      ? { ...m, votes: { ...m.votes, [voter._id.toString()]: vote }, votesFor, votesAgainst }
      : m
  );
  const updated = await getUKPartyConferencesCollection(db).findOneAndUpdate(
    { _id: doc._id, status: "open" },
    { $set: { motions, updatedAt: now } },
    { returnDocument: "after" }
  );
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
  const pledgeIds = selectNppPledges(catalog, party.economicPosition ?? 0, party.socialPosition ?? 0);
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
  const leadership = await getOrSeedPartyLeadership(db, countryId, party, now, currentTurn);
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
  await getUKPartyLeadershipCollection(db).updateOne(
    { _id: leadershipId },
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
    }
  );
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
 * Close a conference whose voting window passed: resolve the platform vote
 * (ratify → write the standing-platform row), resolve each voting motion
 * (passed → apply under #861 bounds/cooldown, else fail/void), then mark
 * completed with payoff due when ratified. Atomic open→completed claim, so
 * turn retries cannot double-apply; the platform upsert is naturally
 * idempotent and the payoff has its own claim below.
 */
export async function resolveConference(
  db: Db,
  countryId: CountryId,
  party: PoliticalParty,
  doc: UKPartyConference,
  currentTurn: number,
  now: Date
): Promise<ConferenceResolution> {
  const partySeqId = partySeqIdOf(party);
  const claimed = await getUKPartyConferencesCollection(db).findOneAndUpdate(
    { _id: doc._id, status: "open" },
    { $set: { status: "completed", updatedAt: now } },
    { returnDocument: "after" }
  );
  if (!claimed) return { completed: false, ratified: false, motionsPassed: 0, motionsVoided: 0 };
  const isNpp = !party.chairId;

  let ratified = false;
  let proposal = claimed.proposal;
  const history = [...claimed.history];
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
    if (ratified) {
      await getUKPartyPlatformsCollection(db).updateOne(
        { _id: `${countryId}:${partySeqId}` },
        {
          $set: {
            countryId,
            partyId: partySeqId,
            pledgeIds: [...proposal.pledgeIds],
            ratifiedConferenceId: doc._id,
            ratifiedYear: doc.conferenceYear,
            ratifiedAtTurn: currentTurn,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true }
      );
    }
  }

  let motionsPassed = 0;
  let motionsVoided = 0;
  const committeeSize = getEligibleVoterSet(party).size;
  const motions = await Promise.all(
    claimed.motions.map(async (motion) => {
      if (motion.status !== "voting") return motion;
      let votesFor = motion.votesFor;
      let votesAgainst = motion.votesAgainst;
      if (isNpp && votesFor + votesAgainst === 0) {
        // Deterministic NPP committee: a valid tabled motion carries.
        votesFor = Math.max(1, committeeSize);
      }
      const result = resolveConferenceMotion({
        votesFor,
        votesAgainst,
        eligibleCount: committeeSize,
      });
      if (!result.passed) {
        history.push(
          conferenceHistoryEntry(
            currentTurn,
            "motionFailed",
            `Conference motion ${motion.motionId} failed: ${result.reason}`
          )
        );
        return { ...motion, votesFor, votesAgainst, status: "failed" as const, resolvedAtTurn: currentTurn };
      }
      const applied = await applyPassedMotion(
        db,
        countryId,
        party,
        `${countryId}:${partySeqId}`,
        { ...motion, votesFor, votesAgainst },
        currentTurn,
        now
      );
      if (applied.applied) {
        motionsPassed += 1;
        history.push(
          conferenceHistoryEntry(
            currentTurn,
            "motionPassed",
            `Conference motion ${motion.motionId} passed and amended leadership rules (${votesFor} for, ${votesAgainst} against)`,
            { characterId: motion.proposedByCharacterId, actorName: motion.proposedByName }
          )
        );
        return { ...motion, votesFor, votesAgainst, status: "passed" as const, resolvedAtTurn: currentTurn };
      }
      motionsVoided += 1;
      history.push(
        conferenceHistoryEntry(
          currentTurn,
          "motionVoided",
          `Conference motion ${motion.motionId} passed its vote but ${applied.voidReason}`
        )
      );
      return {
        ...motion,
        votesFor,
        votesAgainst,
        status: "void" as const,
        voidReason: applied.voidReason,
        resolvedAtTurn: currentTurn,
      };
    })
  );

  const outcome = ratified ? "ratified" : "closedWithoutRatification";
  await getUKPartyConferencesCollection(db).updateOne(
    { _id: doc._id },
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
              ? `Conference completed: platform ratified, ${motionsPassed} motion(s) applied`
              : "Conference completed without ratifying a platform: no payoff"
          )
        ),
        updatedAt: now,
      },
    }
  );

  recordAudit({
    source: "turn",
    category: "party",
    action: "uk.conference.completed",
    outcome: "ok",
    subject: { type: "party", id: partySeqId, name: party.name },
    meta: { conferenceId: doc._id, ratified, motionsPassed, motionsVoided },
  });
  return { completed: true, ratified, motionsPassed, motionsVoided };
}

export interface ConferencePayoff {
  applied: boolean;
  approvalGroups: number;
  cohesionPs: number;
}

/**
 * Apply the completion payoff once: favorability rows for the ratified
 * platform's salient groups (gated by UK_CONFERENCE_PAYOFF until worldsim
 * calibration) plus a PS credit clamped at the party's tier cap. Atomic
 * payoff claim first, so retries never double-write; conference rows that
 * never ratified never become due.
 */
export async function applyConferencePayoff(
  db: Db,
  countryId: CountryId,
  party: PoliticalParty,
  doc: UKPartyConference,
  currentTurn: number,
  now: Date
): Promise<ConferencePayoff> {
  if (!doc.payoffDue || doc.payoffAppliedTurn != null) {
    return { applied: false, approvalGroups: 0, cohesionPs: 0 };
  }
  const claimed = await getUKPartyConferencesCollection(db).findOneAndUpdate(
    { _id: doc._id, payoffDue: true, payoffAppliedTurn: null },
    { $set: { payoffAppliedTurn: currentTurn, updatedAt: now } },
    { returnDocument: "after" }
  );
  if (!claimed?.proposal) return { applied: false, approvalGroups: 0, cohesionPs: 0 };

  let approvalGroups = 0;
  if (isConferencePayoffEnabled()) {
    const catalog = pledgeCatalogFor(countryId);
    const salience = new Map(
      catalog.map((e) => [e.id, Object.keys(e.salienceByGroup ?? {})])
    );
    const groups = payoffGroupsForPledges(claimed.proposal.pledgeIds, salience).slice(
      0,
      CONFERENCE_MAX_PAYOFF_GROUPS
    );
    for (const groupId of groups) {
      const row: PartyGroupFavorability = {
        countryId,
        partyId: partySeqIdOf(party),
        groupId,
        favorabilityDelta: CONFERENCE_APPROVAL_DELTA,
        sourceConferenceId: doc._id,
        expiresAtTurn: currentTurn + CONFERENCE_PAYOFF_DURATION_TURNS,
        createdAt: now,
      };
      await db.collection<PartyGroupFavorability>("partyGroupFavorability").insertOne(row);
      approvalGroups += 1;
    }
  }

  const tier = resolvePartyTier(party);
  const cap = resolvePartyPsCap(
    tier,
    party.psCapEarnedRegions?.length ?? 0,
    NATIONAL_PS_CAP
  );
  const grant = Math.max(
    0,
    Math.min(CONFERENCE_COHESION_PS, cap - (party.politicalStrength ?? 0))
  );
  if (grant > 0) {
    await db
      .collection<PoliticalParty>("politicalParties")
      .updateOne(
        { _id: party._id },
        { $set: { politicalStrength: (party.politicalStrength ?? 0) + grant, updatedAt: now } }
      );
  }

  await getUKPartyConferencesCollection(db).updateOne(
    { _id: doc._id },
    {
      $set: {
        history: pushConferenceHistory(
          (await getUKPartyConferencesCollection(db).findOne({ _id: doc._id }))?.history ?? [],
          conferenceHistoryEntry(
            currentTurn,
            "payoffApplied",
            `Well-run conference payoff: +${CONFERENCE_APPROVAL_DELTA} favorability in ${approvalGroups} group(s), +${grant} party strength`
          )
        ),
        updatedAt: now,
      },
    }
  );

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
      message: `Your party conference ratified the standing platform. The party gains +${grant} political strength${approvalGroups > 0 ? ` and favorability in ${approvalGroups} voter groups` : ""}. The leader will finalise the election manifesto from this platform at dissolution.`,
    });
  }
  recordAudit({
    source: "turn",
    category: "party",
    action: "uk.conference.payoffApplied",
    outcome: "ok",
    subject: { type: "party", id: partySeqIdOf(party), name: party.name },
    meta: { conferenceId: doc._id, approvalGroups, cohesionPs: grant },
  });
  return { applied: true, approvalGroups, cohesionPs: grant };
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
    { title: `${partyName} conference ${year}: ${ratified ? "platform ratified" : "no platform agreed"}` }
  );
}

export { conferenceDocId, conferenceYearForTurn, conferenceYearStartTurn };
