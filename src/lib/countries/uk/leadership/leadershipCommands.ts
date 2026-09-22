import { ObjectId, type Db } from "mongodb";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { createNotification } from "@/lib/notifications";
import { recordAudit } from "@/lib/audit/recordAudit";
import { buildEmbeddedVoteTallyUpdate } from "@/lib/votes/embeddedVoteTally";
import { getEligibleVoterSet } from "@/lib/parties/proposals";
import { getLowerChamberOfficeType } from "@/lib/legislature/chamberOfficeType";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import {
  getUKPartyLeadershipCollection,
  getUKLeadershipChallengesCollection,
} from "@/lib/db/collections/ukPartyLeadership";
import {
  canTriggerChallenge,
  resolveLeadershipBallot,
  type LeadershipElectorate,
} from "@/lib/uk/leadership/leadershipRemoval";
import {
  LEADERSHIP_AMENDMENT_COOLDOWN_TURNS,
  LEADERSHIP_BALLOT_DURATION_TURNS,
  LEADERSHIP_GATHERING_WINDOW_TURNS,
  resolveCommitteeControl,
  validateRulesetAmendment,
  type CommitteeControl,
  type RulesetAmendmentPatch,
} from "@/lib/uk/leadership/rules";
import {
  getOrSeedPartyLeadership,
  historyEntry,
  pushHistoryEntry,
} from "@/lib/uk/leadership/leadershipStore";
import type { LeadershipChallenge, UKPartyLeadership } from "@/lib/uk/leadership/leadershipTypes";
import type { Character, ElectedOfficial, PoliticalParty } from "@/lib/db/types";
import type { Caucus, CaucusMembership } from "@/lib/db/types/caucus";
import type { CountryId } from "@/lib/constants/countries";

/**
 * UK party leadership removal — shell commands (epic #856, ticket #861).
 *
 * Wires the pure `leadershipRemoval` evaluator + `rules` helpers to storage:
 * per-party rulesets with CON/LAB defaults, the internal governing committee
 * (1922 / NEC analogue) with faction control, committee amendments within safe
 * bounds, and the full challenge lifecycle (letters/nominations → ballot →
 * resolution → immunity / leader replacement).
 *
 * Party-leader confidence here is DISTINCT from government confidence: a
 * successful challenge vacates the party chair (the sitting leader) and the
 * existing national chair-election machinery seats the successor. The
 * government formation (PM, cabinet, VONC gauge) is never touched.
 *
 * The sitting party leader IS the party chair. Removal clears chairId with no
 * auto-promotion (same semantics as the committee removeOfficeHolder flow);
 * the vice-chair inherits chair authority via the acting-chair helper until
 * the fresh chair election resolves.
 */

export interface LeadershipActor {
  _id: ObjectId;
  name: string;
  party?: string;
  userId?: ObjectId;
}

export interface CommitteeMemberView {
  characterId: string;
  name: string;
  role: "chair" | "viceChair" | "treasurer" | "member";
  /** Caucus slug of the holder's active faction, null when unaligned. */
  faction: string | null;
}

export interface LeadershipStateView {
  partyId: string;
  partyName: string;
  family: UKPartyLeadership["family"];
  committeeName: string;
  ruleset: UKPartyLeadership["ruleset"];
  leader: { characterId: string; name: string } | null;
  committee: { members: CommitteeMemberView[]; control: CommitteeControl };
  immunity: { protected: boolean; turnsRemaining: number };
  amendment: { canAmendNow: boolean; turnsUntilAmendable: number };
  activeChallenge: {
    challengeId: string;
    status: LeadershipChallenge["status"];
    targetName: string;
    backers: { characterId: string; characterName: string }[];
    backersNeeded: number;
    totalMps: number;
    ballot: null | {
      electorate: LeadershipElectorate;
      votesFor: number;
      votesAgainst: number;
      closesOnTurn: number;
      turnsRemaining: number;
    };
  } | null;
  capabilities: {
    isPartyMember: boolean;
    isCommitteeMember: boolean;
    isPartyMp: boolean;
    canInitiate: boolean;
  };
  history: UKPartyLeadership["history"];
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

function isPartyMember(actor: LeadershipActor, party: PoliticalParty): boolean {
  return actor.party != null && actor.party === partySeqIdOf(party);
}

function isCommitteeMember(actor: LeadershipActor, party: PoliticalParty): boolean {
  return getEligibleVoterSet(party).has(actor._id.toString());
}

/** Commons MPs of this party (the parliamentary party — denominator for triggers). */
async function countPartyMps(db: Db, countryId: CountryId, party: PoliticalParty): Promise<number> {
  return db.collection<ElectedOfficial>("electedOfficials").countDocuments({
    countryId,
    officeType: getLowerChamberOfficeType(countryId),
    party: partySeqIdOf(party),
  });
}

async function requirePartyMp(
  db: Db,
  countryId: CountryId,
  party: PoliticalParty,
  actor: LeadershipActor
): Promise<ElectedOfficial> {
  const official = await db.collection<ElectedOfficial>("electedOfficials").findOne({
    characterId: actor._id,
    countryId,
    officeType: getLowerChamberOfficeType(countryId),
  });
  if (!official || official.party !== partySeqIdOf(party)) {
    throw forbidden("Only a sitting MP of this party can back a leadership challenge");
  }
  return official;
}

function turnsSince(currentTurn: number, sinceTurn: number | null | undefined): number | undefined {
  return sinceTurn == null ? undefined : currentTurn - sinceTurn;
}

/** Committee snapshot with each seat tagged by its holder's faction. */
export async function getCommitteeSnapshot(
  db: Db,
  countryId: CountryId,
  party: PoliticalParty
): Promise<{ members: CommitteeMemberView[]; control: CommitteeControl }> {
  const roleById = new Map<string, CommitteeMemberView["role"]>();
  for (const id of party.committeeIds ?? []) roleById.set(id.toString(), "member");
  if (party.chairId) roleById.set(party.chairId.toString(), "chair");
  if (party.viceChairId) roleById.set(party.viceChairId.toString(), "viceChair");
  if (party.treasurerId) roleById.set(party.treasurerId.toString(), "treasurer");

  const memberIds = [...roleById.keys()].map((id) => new ObjectId(id));
  const [characters, memberships, caucuses] = await Promise.all([
    memberIds.length === 0
      ? []
      : db
          .collection<Character>("characters")
          .find({ _id: { $in: memberIds } })
          .project({ name: 1 })
          .toArray(),
    memberIds.length === 0
      ? []
      : db
          .collection<CaucusMembership>("caucusMemberships")
          .find({
            memberType: "character",
            memberId: { $in: memberIds },
            countryId,
            partyId: partySeqIdOf(party),
            status: "active",
          })
          .project({ memberId: 1, caucusId: 1 })
          .toArray(),
    db
      .collection<Caucus>("caucuses")
      .find({ countryId, partyId: partySeqIdOf(party), disbandedAt: null })
      .project({ slug: 1 })
      .toArray(),
  ]);
  const nameById = new Map(characters.map((c) => [c._id.toString(), c.name]));
  const slugByCaucusId = new Map(caucuses.map((c) => [c._id.toString(), c.slug]));
  const factionByMemberId = new Map(
    memberships.map((m) => [
      m.memberId.toString(),
      slugByCaucusId.get(m.caucusId.toString()) ?? null,
    ])
  );
  const members: CommitteeMemberView[] = [...roleById.entries()].map(([id, role]) => ({
    characterId: id,
    name: nameById.get(id) ?? "Unknown",
    role,
    faction: factionByMemberId.get(id) ?? null,
  }));
  const control = resolveCommitteeControl(
    members.map((m) => ({ memberId: m.characterId, faction: m.faction }))
  );
  return { members, control };
}

async function loadActiveChallenge(
  db: Db,
  leadership: UKPartyLeadership
): Promise<LeadershipChallenge | null> {
  if (!leadership.activeChallengeId) return null;
  const challenge = await getUKLeadershipChallengesCollection(db).findOne({
    _id: leadership.activeChallengeId,
  });
  if (!challenge) {
    // Stale pointer (challenge row removed out-of-band): heal it.
    await getUKPartyLeadershipCollection(db).updateOne(
      { _id: leadership._id, activeChallengeId: leadership.activeChallengeId },
      { $set: { activeChallengeId: null, updatedAt: new Date() } }
    );
    return null;
  }
  if (challenge.status !== "gathering" && challenge.status !== "ballot") {
    await getUKPartyLeadershipCollection(db).updateOne(
      { _id: leadership._id, activeChallengeId: leadership.activeChallengeId },
      { $set: { activeChallengeId: null, updatedAt: new Date() } }
    );
    return null;
  }
  return challenge;
}

/** Read model for the party hub panel + capability gating. */
export async function getLeadershipState(
  db: Db,
  countryId: CountryId,
  partySeqId: string,
  viewer: LeadershipActor | null,
  currentTurn: number,
  now: Date
): Promise<LeadershipStateView> {
  const party = await requireParty(db, countryId, partySeqId);
  const leadership = await getOrSeedPartyLeadership(db, countryId, party, now, currentTurn);
  const [committee, totalMps, activeChallenge] = await Promise.all([
    getCommitteeSnapshot(db, countryId, party),
    countPartyMps(db, countryId, party),
    loadActiveChallenge(db, leadership),
  ]);

  let leader: LeadershipStateView["leader"] = null;
  if (party.chairId) {
    const chair = await db
      .collection<Character>("characters")
      .findOne({ _id: party.chairId }, { projection: { name: 1 } });
    leader = { characterId: party.chairId.toString(), name: chair?.name ?? "Unknown" };
  }

  const since = turnsSince(currentTurn, leadership.lastSurvivalTurn);
  const immune =
    leadership.ruleset.survivalImmunityTurns > 0 &&
    since !== undefined &&
    since < leadership.ruleset.survivalImmunityTurns;

  const sinceAmend = turnsSince(currentTurn, leadership.lastAmendedTurn);
  const turnsUntilAmendable =
    sinceAmend === undefined ? 0 : Math.max(0, LEADERSHIP_AMENDMENT_COOLDOWN_TURNS - sinceAmend);

  const backersNeeded = activeChallenge
    ? Math.max(
        0,
        Math.ceil(totalMps * leadership.ruleset.triggerThresholdPct) -
          activeChallenge.backers.length
      )
    : Math.ceil(totalMps * leadership.ruleset.triggerThresholdPct);

  const isMember = viewer != null && isPartyMember(viewer, party);
  const isCommittee = viewer != null && isCommitteeMember(viewer, party);
  let isMp = false;
  if (viewer != null && isMember) {
    const official = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      characterId: viewer._id,
      countryId,
      officeType: getLowerChamberOfficeType(countryId),
      party: partySeqIdOf(party),
    });
    isMp = official != null;
  }

  return {
    partyId: partySeqIdOf(party),
    partyName: party.name,
    family: leadership.family,
    committeeName: leadership.committeeName,
    ruleset: leadership.ruleset,
    leader,
    committee,
    immunity: {
      protected: immune,
      turnsRemaining: immune ? leadership.ruleset.survivalImmunityTurns - (since ?? 0) : 0,
    },
    amendment: { canAmendNow: turnsUntilAmendable === 0, turnsUntilAmendable },
    activeChallenge: activeChallenge
      ? {
          challengeId: activeChallenge._id.toString(),
          status: activeChallenge.status,
          targetName: activeChallenge.targetName,
          backers: activeChallenge.backers.map((b) => ({
            characterId: b.characterId.toString(),
            characterName: b.characterName,
          })),
          backersNeeded,
          totalMps,
          ballot:
            activeChallenge.status === "ballot" && activeChallenge.ballotRuleset
              ? {
                  electorate: activeChallenge.ballotRuleset.electorate,
                  votesFor: activeChallenge.votesFor,
                  votesAgainst: activeChallenge.votesAgainst,
                  closesOnTurn: activeChallenge.closesOnTurn ?? currentTurn,
                  turnsRemaining: Math.max(
                    0,
                    (activeChallenge.closesOnTurn ?? currentTurn) - currentTurn
                  ),
                }
              : null,
        }
      : null,
    capabilities: {
      isPartyMember: isMember,
      isCommitteeMember: isCommittee,
      isPartyMp: isMp,
      canInitiate: isMp && leader != null && activeChallenge == null && !immune,
    },
    history: leadership.history,
  };
}

/**
 * Committee business: amend the party's removal ruleset within safe bounds.
 * Authorized to committee members (committee + chair/VC/treasurer) only, and
 * rate-limited by the amendment cooldown so rules cannot be rewritten
 * mid-challenge to protect or expose the leader.
 */
export async function amendLeadershipRules(
  db: Db,
  countryId: CountryId,
  partySeqId: string,
  actor: LeadershipActor,
  patch: RulesetAmendmentPatch,
  currentTurn: number,
  now: Date
): Promise<{ success: true; ruleset: UKPartyLeadership["ruleset"] }> {
  const party = await requireParty(db, countryId, partySeqId);
  if (!isPartyMember(actor, party)) throw forbidden("Only party members can amend party rules");
  if (!isCommitteeMember(actor, party)) {
    throw forbidden("Only the party committee can amend leadership rules");
  }
  const validation = validateRulesetAmendment(patch);
  if (!validation.ok) throw badRequest(validation.errors.join("; "));

  // Durable serialization with conference motion applies (ticket #862): the
  // cooldown travels with the write as a compare-and-swap on the observed
  // lastAmendedTurn, so a concurrent winner (motion or amendment) that moved
  // it first makes this write miss instead of landing a second patch inside
  // the window. `{ lastAmendedTurn: null }` matches null AND missing, so a
  // legacy row without the field amends cleanly the first time.
  for (let attempt = 0; attempt < 2; attempt++) {
    const leadership = await getOrSeedPartyLeadership(db, countryId, party, now, currentTurn);
    const sinceAmend = turnsSince(currentTurn, leadership.lastAmendedTurn);
    if (sinceAmend !== undefined && sinceAmend < LEADERSHIP_AMENDMENT_COOLDOWN_TURNS) {
      throw conflict(
        `Leadership rules were amended recently and cannot be changed for ${LEADERSHIP_AMENDMENT_COOLDOWN_TURNS - sinceAmend} more turn(s)`
      );
    }

    const before = leadership.ruleset;
    const ruleset = { ...before, ...patch };
    const changes = (Object.keys(patch) as (keyof RulesetAmendmentPatch)[])
      .map((k) => `${k}: ${String(before[k])} -> ${String(patch[k])}`)
      .join("; ");
    const history = pushHistoryEntry(
      leadership.history,
      historyEntry(currentTurn, "rulesAmended", `Committee amended removal rules (${changes})`, {
        characterId: actor._id,
        actorName: actor.name,
      })
    );
    const written = await getUKPartyLeadershipCollection(db).updateOne(
      { _id: leadership._id, lastAmendedTurn: leadership.lastAmendedTurn ?? null },
      {
        $set: {
          ruleset,
          lastAmendedTurn: currentTurn,
          lastAmendedByCharacterId: actor._id,
          history,
          updatedAt: now,
        },
      }
    );
    if (written.matchedCount === 1) {
      recordAudit({
        source: "api",
        category: "party",
        action: "uk.leadership.rulesAmended",
        outcome: "ok",
        actor: { kind: "player", characterId: actor._id, name: actor.name },
        subject: { type: "party", id: partySeqId, name: party.name },
        meta: { patch },
      });
      return { success: true, ruleset };
    }
    // Miss: a concurrent writer moved lastAmendedTurn first. The loop
    // re-reads fresh: an active cooldown now reports its conflict, so the
    // loser can never land a second patch in the winner's window.
  }
  throw conflict("Leadership rules changed concurrently; retry the amendment");
}

/**
 * Open a challenge: the first letter/nomination against the sitting leader.
 * Backer must be a sitting MP of the party in both traditions (CON letters,
 * LAB nominations); the LAB/CON difference surfaces at the ballot (members
 * vs MPs vote). A challenge that already meets threshold on the first backer
 * (tiny parliamentary parties) opens its ballot immediately.
 */
export async function initiateLeadershipChallenge(
  db: Db,
  countryId: CountryId,
  partySeqId: string,
  backer: LeadershipActor,
  currentTurn: number,
  now: Date
): Promise<{ success: true; challengeId: string; status: LeadershipChallenge["status"] }> {
  const party = await requireParty(db, countryId, partySeqId);
  if (!isPartyMember(backer, party)) throw forbidden("Only party members can challenge the leader");
  await requirePartyMp(db, countryId, party, backer);
  if (!party.chairId) throw badRequest("This party has no sitting leader to challenge");
  if (party.chairId.equals(backer._id)) {
    throw badRequest("The leader cannot file a challenge against themselves");
  }

  const leadership = await getOrSeedPartyLeadership(db, countryId, party, now, currentTurn);
  const existing = await loadActiveChallenge(db, leadership);
  if (existing) throw conflict("A leadership challenge is already in progress for this party");

  const totalMps = await countPartyMps(db, countryId, party);
  const since = turnsSince(currentTurn, leadership.lastSurvivalTurn);
  const gate = canTriggerChallenge(1, totalMps, leadership.ruleset, {
    ...(since === undefined ? {} : { turnsSinceLastSurvival: since }),
  });
  if (!gate.canTrigger && gate.reason === "leader within survival-immunity window") {
    throw conflict("The leader is within their survival-immunity window");
  }
  if (!gate.canTrigger && gate.reason === "no parliamentary party") {
    throw badRequest("This party holds no Commons seats, so no challenge can trigger");
  }

  const targetChar = await db
    .collection<Character>("characters")
    .findOne({ _id: party.chairId }, { projection: { name: 1 } });

  const challengeId = new ObjectId();
  const opensImmediately = canTriggerChallenge(1, totalMps, leadership.ruleset, {
    ...(since === undefined ? {} : { turnsSinceLastSurvival: since }),
  }).canTrigger;
  const challenge: LeadershipChallenge = {
    _id: challengeId,
    countryId,
    partyId: partySeqIdOf(party),
    targetCharacterId: party.chairId,
    targetName: targetChar?.name ?? "Unknown",
    status: opensImmediately ? "ballot" : "gathering",
    backers: [{ characterId: backer._id, characterName: backer.name, backedAtTurn: currentTurn }],
    ballotRuleset: opensImmediately ? { ...leadership.ruleset } : null,
    openedBallotAtTurn: opensImmediately ? currentTurn : null,
    closesOnTurn: opensImmediately ? currentTurn + LEADERSHIP_BALLOT_DURATION_TURNS : null,
    votesFor: 0,
    votesAgainst: 0,
    votes: {},
    createdAtTurn: currentTurn,
    createdByCharacterId: backer._id,
    resolvedAtTurn: null,
    createdAt: now,
    updatedAt: now,
  };
  await getUKLeadershipChallengesCollection(db).insertOne(challenge);
  // Single-flight claim: concurrent initiates race here; the loser rolls back.
  const claimed = await getUKPartyLeadershipCollection(db).findOneAndUpdate(
    { _id: leadership._id, activeChallengeId: null },
    { $set: { activeChallengeId: challengeId, updatedAt: now } }
  );
  if (!claimed) {
    await getUKLeadershipChallengesCollection(db).deleteOne({ _id: challengeId });
    throw conflict("A leadership challenge is already in progress for this party");
  }

  const history = pushHistoryEntry(
    (await getUKPartyLeadershipCollection(db).findOne({ _id: leadership._id }))?.history ??
      leadership.history,
    historyEntry(
      currentTurn,
      "challengeInitiated",
      `${backer.name} filed a leadership challenge against ${challenge.targetName}`,
      { characterId: backer._id, actorName: backer.name }
    )
  );
  const finalHistory = opensImmediately
    ? pushHistoryEntry(
        history,
        historyEntry(
          currentTurn,
          "ballotOpened",
          `Threshold met on the first letter: ballot opened (${totalMps} MPs, closes turn ${challenge.closesOnTurn})`
        )
      )
    : history;
  await getUKPartyLeadershipCollection(db).updateOne(
    { _id: leadership._id },
    { $set: { history: finalHistory, updatedAt: now } }
  );
  recordAudit({
    source: "api",
    category: "party",
    action: "uk.leadership.challengeInitiated",
    outcome: "ok",
    actor: { kind: "player", characterId: backer._id, name: backer.name },
    subject: { type: "party", id: partySeqIdOf(party), name: party.name },
    meta: { challengeId: challengeId.toString(), openedBallot: opensImmediately },
  });
  return { success: true, challengeId: challengeId.toString(), status: challenge.status };
}

/** Flip a gathering challenge to ballot once the trigger threshold is met. */
async function maybeOpenBallot(
  db: Db,
  leadership: UKPartyLeadership,
  challenge: LeadershipChallenge,
  totalMps: number,
  currentTurn: number,
  now: Date
): Promise<LeadershipChallenge> {
  if (challenge.status !== "gathering") return challenge;
  const since =
    leadership.lastSurvivalTurn == null ? undefined : currentTurn - leadership.lastSurvivalTurn;
  const gate = canTriggerChallenge(challenge.backers.length, totalMps, leadership.ruleset, {
    ...(since === undefined ? {} : { turnsSinceLastSurvival: since }),
  });
  if (!gate.canTrigger) return challenge;
  const opened = await getUKLeadershipChallengesCollection(db).findOneAndUpdate(
    { _id: challenge._id, status: "gathering" },
    {
      $set: {
        status: "ballot",
        ballotRuleset: { ...leadership.ruleset },
        openedBallotAtTurn: currentTurn,
        closesOnTurn: currentTurn + LEADERSHIP_BALLOT_DURATION_TURNS,
        updatedAt: now,
      },
    },
    { returnDocument: "after" }
  );
  if (!opened) {
    return (await getUKLeadershipChallengesCollection(db).findOne({ _id: challenge._id }))!;
  }
  const doc = await getUKPartyLeadershipCollection(db).findOne({ _id: leadership._id });
  await getUKPartyLeadershipCollection(db).updateOne(
    { _id: leadership._id },
    {
      $set: {
        history: pushHistoryEntry(
          doc?.history ?? leadership.history,
          historyEntry(
            currentTurn,
            "ballotOpened",
            `Trigger threshold met (${opened.backers.length}/${totalMps} MPs): ballot opened, closes turn ${opened.closesOnTurn}`
          )
        ),
        updatedAt: now,
      },
    }
  );
  return opened;
}

/**
 * Add (back=true, a letter/nomination) or withdraw (back=false) backing on a
 * gathering challenge. Idempotent both ways; withdrawing the last letter
 * cancels the challenge. Threshold crossings open the ballot automatically.
 */
export async function backLeadershipChallenge(
  db: Db,
  countryId: CountryId,
  partySeqId: string,
  backer: LeadershipActor,
  back: boolean,
  currentTurn: number,
  now: Date
): Promise<{ success: true; challengeId: string; status: LeadershipChallenge["status"] }> {
  const party = await requireParty(db, countryId, partySeqId);
  if (!isPartyMember(backer, party)) throw forbidden("Only party members can back a challenge");
  await requirePartyMp(db, countryId, party, backer);

  const leadership = await getOrSeedPartyLeadership(db, countryId, party, now, currentTurn);
  const challenge = await loadActiveChallenge(db, leadership);
  if (!challenge) throw notFound("No active leadership challenge for this party");
  if (challenge.status !== "gathering") {
    throw badRequest("Letters are closed: this challenge is already at ballot");
  }
  if (challenge.targetCharacterId.equals(backer._id)) {
    throw badRequest("The leader cannot back a challenge against themselves");
  }

  const already = challenge.backers.some((b) => b.characterId.equals(backer._id));
  if (back && already) {
    return { success: true, challengeId: challenge._id.toString(), status: challenge.status };
  }
  if (!back && !already) {
    return { success: true, challengeId: challenge._id.toString(), status: challenge.status };
  }

  const coll = getUKLeadershipChallengesCollection(db);
  if (back) {
    await coll.updateOne(
      { _id: challenge._id, status: "gathering" },
      {
        $push: {
          backers: {
            characterId: backer._id,
            characterName: backer.name,
            backedAtTurn: currentTurn,
          },
        },
        $set: { updatedAt: now },
      }
    );
  } else {
    await coll.updateOne(
      { _id: challenge._id, status: "gathering" },
      { $pull: { backers: { characterId: backer._id } }, $set: { updatedAt: now } }
    );
  }
  let updated = (await coll.findOne({ _id: challenge._id }))!;
  const doc = await getUKPartyLeadershipCollection(db).findOne({ _id: leadership._id });
  await getUKPartyLeadershipCollection(db).updateOne(
    { _id: leadership._id },
    {
      $set: {
        history: pushHistoryEntry(
          doc?.history ?? leadership.history,
          historyEntry(
            currentTurn,
            back ? "challengeBacked" : "backingWithdrawn",
            back
              ? `${backer.name} backed the challenge against ${updated.targetName}`
              : `${backer.name} withdrew backing from the challenge against ${updated.targetName}`,
            { characterId: backer._id, actorName: backer.name }
          )
        ),
        updatedAt: now,
      },
    }
  );

  if (!back && updated.backers.length === 0) {
    await coll.updateOne(
      { _id: challenge._id, status: "gathering" },
      { $set: { status: "cancelled", resolvedAtTurn: currentTurn, updatedAt: now } }
    );
    await getUKPartyLeadershipCollection(db).updateOne(
      { _id: leadership._id, activeChallengeId: challenge._id },
      {
        $set: {
          activeChallengeId: null,
          history: pushHistoryEntry(
            (await getUKPartyLeadershipCollection(db).findOne({ _id: leadership._id }))?.history ??
              leadership.history,
            historyEntry(
              currentTurn,
              "challengeCancelled",
              "Challenge cancelled: the last letter was withdrawn"
            )
          ),
          updatedAt: now,
        },
      }
    );
    return { success: true, challengeId: challenge._id.toString(), status: "cancelled" };
  }

  if (back) {
    const totalMps = await countPartyMps(db, countryId, party);
    updated = await maybeOpenBallot(db, leadership, updated, totalMps, currentTurn, now);
  }
  return { success: true, challengeId: challenge._id.toString(), status: updated.status };
}

/**
 * Cast (or change) a ballot vote. Aye removes the leader, nay retains them.
 * CON-style electorates restrict voting to the party's MPs; LAB-style opens
 * it to every party member. The snapshot ruleset on the challenge governs,
 * so a mid-ballot committee amendment cannot move the goalposts.
 */
export async function castLeadershipBallotVote(
  db: Db,
  countryId: CountryId,
  challengeIdParam: string,
  voter: LeadershipActor,
  vote: "aye" | "nay",
  currentTurn: number,
  now: Date
): Promise<{ success: true; votesFor: number; votesAgainst: number }> {
  if (!ObjectId.isValid(challengeIdParam)) throw badRequest("Invalid challenge ID format");
  const challengeId = new ObjectId(challengeIdParam);
  const coll = getUKLeadershipChallengesCollection(db);
  const challenge = await coll.findOne({ _id: challengeId, countryId });
  if (!challenge) throw notFound("Leadership challenge not found");
  if (challenge.status !== "ballot" || !challenge.ballotRuleset) {
    throw badRequest("This challenge is not at ballot");
  }
  if (challenge.closesOnTurn != null && currentTurn >= challenge.closesOnTurn) {
    throw badRequest("The ballot window has closed");
  }

  let weight = 1;
  if (challenge.ballotRuleset.electorate === "mps") {
    const official = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      characterId: voter._id,
      countryId,
      officeType: getLowerChamberOfficeType(countryId),
      party: challenge.partyId,
    });
    if (!official) {
      throw forbidden("Only this party's MPs vote in this ballot");
    }
    weight = official.seatsHeld ?? 1;
  } else {
    const member = await db
      .collection<Character>("characters")
      .findOne({ _id: voter._id, userId: { $exists: true } }, { projection: { party: 1 } });
    if (!member || member.party !== challenge.partyId) {
      throw forbidden("Only party members vote in this ballot");
    }
  }

  const updateResult = await coll.updateOne(
    { _id: challengeId, countryId, status: "ballot" },
    buildEmbeddedVoteTallyUpdate({
      voteField: "votes",
      voteKey: voter._id.toString(),
      vote,
      tallyFieldByVote: { aye: "votesFor", nay: "votesAgainst" },
      updatedAt: now,
      weight,
    })
  );
  if (updateResult.matchedCount === 0) {
    throw badRequest("This ballot has already closed");
  }
  const updated = await coll.findOne({ _id: challengeId, countryId });
  return {
    success: true,
    votesFor: updated?.votesFor ?? 0,
    votesAgainst: updated?.votesAgainst ?? 0,
  };
}

async function releaseActiveChallenge(
  db: Db,
  leadership: UKPartyLeadership,
  challenge: LeadershipChallenge,
  now: Date
): Promise<void> {
  await getUKPartyLeadershipCollection(db).updateOne(
    { _id: leadership._id, activeChallengeId: challenge._id },
    { $set: { activeChallengeId: null, updatedAt: now } }
  );
}

async function appendChallengeHistory(
  db: Db,
  leadership: UKPartyLeadership,
  turn: number,
  entry: ReturnType<typeof historyEntry>,
  now: Date
): Promise<void> {
  const doc = await getUKPartyLeadershipCollection(db).findOne({ _id: leadership._id });
  await getUKPartyLeadershipCollection(db).updateOne(
    { _id: leadership._id },
    {
      $set: {
        history: pushHistoryEntry(doc?.history ?? leadership.history, entry),
        updatedAt: now,
      },
    }
  );
}

/**
 * Resolve a ballot that reached its closing turn. Removal vacates the party
 * chair (successor via the existing national chair elections); survival
 * starts the ruleset immunity window. Government formation is untouched
 * either way. Atomic claim so the turn processor and any inline resolve path
 * cannot double-apply side effects.
 */
export async function resolveLeadershipChallenge(
  db: Db,
  countryId: CountryId,
  challengeId: ObjectId,
  currentTurn: number,
  now: Date
): Promise<{ resolved: boolean; removed?: boolean }> {
  const coll = getUKLeadershipChallengesCollection(db);
  const challenge = await coll.findOne({ _id: challengeId, countryId });
  if (!challenge) return { resolved: false };
  const leadership = await getUKPartyLeadershipCollection(db).findOne({
    _id: `${countryId}:${challenge.partyId}`,
  });
  if (!leadership) return { resolved: false };

  if (challenge.status === "gathering") {
    if (currentTurn < challenge.createdAtTurn + LEADERSHIP_GATHERING_WINDOW_TURNS) {
      return { resolved: false };
    }
    const claimed = await coll.findOneAndUpdate(
      { _id: challenge._id, status: "gathering" },
      { $set: { status: "expired", resolvedAtTurn: currentTurn, updatedAt: now } }
    );
    if (!claimed) return { resolved: false };
    await releaseActiveChallenge(db, leadership, challenge, now);
    await appendChallengeHistory(
      db,
      leadership,
      currentTurn,
      historyEntry(
        currentTurn,
        "challengeExpired",
        `Challenge against ${challenge.targetName} expired without reaching the trigger threshold`
      ),
      now
    );
    return { resolved: true, removed: false };
  }

  if (challenge.status !== "ballot" || !challenge.ballotRuleset) return { resolved: false };
  if (challenge.closesOnTurn != null && currentTurn < challenge.closesOnTurn) {
    return { resolved: false };
  }

  const { removed, removeShare } = resolveLeadershipBallot(
    challenge.votesFor,
    challenge.votesFor + challenge.votesAgainst,
    challenge.ballotRuleset
  );
  const claimed = await coll.findOneAndUpdate(
    { _id: challenge._id, status: "ballot" },
    {
      $set: {
        status: removed ? "removed" : "survived",
        resolvedAtTurn: currentTurn,
        updatedAt: now,
      },
    }
  );
  if (!claimed) return { resolved: false };
  await releaseActiveChallenge(db, leadership, challenge, now);

  if (removed) {
    const party = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ countryId, sequentialId: parseInt(challenge.partyId, 10) });
    if (!party || !party.chairId || !party.chairId.equals(challenge.targetCharacterId)) {
      // Leadership already changed hands mid-ballot: the challenge is moot.
      await appendChallengeHistory(
        db,
        leadership,
        currentTurn,
        historyEntry(
          currentTurn,
          "challengeCancelled",
          `Ballot carried against ${challenge.targetName}, but the leadership had already changed hands: no further action`
        ),
        now
      );
      return { resolved: true, removed: false };
    }
    await db
      .collection<PoliticalParty>("politicalParties")
      .updateOne({ _id: party._id }, { $set: { chairId: null, updatedAt: now } });
    await appendChallengeHistory(
      db,
      leadership,
      currentTurn,
      historyEntry(
        currentTurn,
        "ballotResolved",
        `${challenge.targetName} removed as party leader (${challenge.votesFor} remove, ${challenge.votesAgainst} retain, ${(removeShare * 100).toFixed(1)}% > ${(challenge.ballotRuleset.removalMajorityPct * 100).toFixed(1)}% required). A fresh chair election seats the successor; the government is unaffected.`
      ),
      now
    );
    const target = await db
      .collection<Character>("characters")
      .findOne({ _id: challenge.targetCharacterId }, { projection: { userId: 1, name: 1 } });
    if (target?.userId) {
      await createNotification({
        userId: target.userId,
        type: "system",
        title: "Removed as Party Leader",
        message: `Your party has removed you as leader (${challenge.votesFor} to remove, ${challenge.votesAgainst} to retain). A leadership election will choose your successor. Your government offices are unaffected by this vote.`,
      });
    }
    recordAudit({
      source: "turn",
      category: "party",
      action: "uk.leadership.leaderRemoved",
      outcome: "ok",
      subject: { type: "party", id: challenge.partyId, name: party.name },
      meta: {
        challengeId: challenge._id.toString(),
        votesFor: challenge.votesFor,
        votesAgainst: challenge.votesAgainst,
      },
    });
    return { resolved: true, removed: true };
  }

  await getUKPartyLeadershipCollection(db).updateOne(
    { _id: leadership._id },
    { $set: { lastSurvivalTurn: currentTurn, updatedAt: now } }
  );
  await appendChallengeHistory(
    db,
    leadership,
    currentTurn,
    historyEntry(
      currentTurn,
      "ballotResolved",
      `${challenge.targetName} survived the ballot (${challenge.votesFor} remove, ${challenge.votesAgainst} retain). Immunity for ${challenge.ballotRuleset.survivalImmunityTurns} turn(s).`
    ),
    now
  );
  return { resolved: true, removed: false };
}

/**
 * Turn-driver: expire stale gatherings and resolve closed ballots for live
 * UK leadership challenges. Called from the parliamentary vote processor
 * (UK-gated). Returns counts for telemetry.
 */
export async function processExpiredLeadershipChallenges(
  db: Db,
  countryId: CountryId,
  now: Date,
  currentTurn: number
): Promise<{ expired: number; resolved: number; removed: number }> {
  const live = await getUKLeadershipChallengesCollection(db)
    .find({ countryId, status: { $in: ["gathering", "ballot"] } })
    .toArray();
  let expired = 0;
  let resolved = 0;
  let removed = 0;
  for (const challenge of live) {
    const due =
      challenge.status === "gathering"
        ? currentTurn >= challenge.createdAtTurn + LEADERSHIP_GATHERING_WINDOW_TURNS
        : challenge.closesOnTurn != null && currentTurn >= challenge.closesOnTurn;
    if (!due) continue;
    const result = await resolveLeadershipChallenge(db, countryId, challenge._id, currentTurn, now);
    if (!result.resolved) continue;
    if (challenge.status === "gathering") expired += 1;
    else {
      resolved += 1;
      if (result.removed) removed += 1;
    }
  }
  return { expired, resolved, removed };
}
