import { ObjectId, type Db } from "mongodb";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { recordAudit } from "@/lib/audit/recordAudit";
import {
  buildEmbeddedVoteTallyUpdate,
  buildMotionVoteTallyUpdate,
} from "@/lib/votes/embeddedVoteTally";
import { getEligibleVoterSet } from "@/lib/parties/proposals";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { validateManifestoPledges } from "@/lib/db/collections/manifestos";
import { MANIFESTO_PLEDGE_COUNT } from "@/lib/db/types/manifesto";
import {
  getUKPartyConferencesCollection,
  getUKPartyPlatformsCollection,
} from "@/lib/db/collections/ukPartyConferences";
import { pledgeCatalogFor } from "@/lib/uk/manifesto/pledgeCatalog";
import { selectNppPledges } from "@/lib/uk/manifesto/nppManifesto";
import { validateRulesetAmendment, type RulesetAmendmentPatch } from "@/lib/uk/leadership/rules";
import {
  CONFERENCE_MOTION_QUORUM_FLOOR,
  CONFERENCE_PLATFORM_QUORUM_FLOOR,
  conferenceOpensAtTurn,
  conferenceVotingClosesTurn,
  conferenceYearForTurn,
  conferenceYearStartTurn,
  quorumFor,
} from "@/lib/uk/conference/rules";
import {
  conferenceHistoryEntry,
  getConference,
  getOrSeedConference,
  pushConferenceHistory,
} from "@/lib/uk/conference/conferenceStore";
import type { ConferenceRulesMotion, UKPartyConference } from "@/lib/uk/conference/types";
import type { Character, PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import {
  partySeqIdOf,
  frozenRollOf,
  countPartyMembers,
  ensureEligibleRoll,
} from "./conferenceShared";
import {
  fillConferenceResolution,
  reconcileConferenceEffects,
  type ConferenceResolution,
} from "./conferenceResolution";

export * from "./conferenceResolution";

export * from "./conferencePayoff";

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
