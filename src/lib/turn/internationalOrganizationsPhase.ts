import { ObjectId, type Db } from "mongodb";
import {
  getOrganizationLeadershipCollection,
  getOrganizationLeadershipElectionsCollection,
  getOrganizationLegislationCollection,
  getOrganizationMembershipsCollection,
  getOrganizationProposalsCollection,
} from "@/lib/db/collections";
import {
  getMembers,
  loadOrganizationDef,
  recordOrgHistoryEvent,
} from "@/lib/internationalOrganizations/service";
import { votingMembers } from "@/lib/internationalOrganizations/orgMembership";
import { chargeOrganizationTribute } from "@/lib/internationalOrganizations/tribute";
import { getAllCountryAccess } from "@/lib/countryAccess";
import type { OrgMemberId } from "@/lib/db/types/internationalOrganization";
import { dedupeOrganizationVotes } from "@/lib/internationalOrganizations/voteWrite";
import { resolutionPasses } from "@/lib/internationalOrganizations/resolutionRules";
import {
  applyOrganizationSanctions,
  liftOrganizationSanctions,
} from "@/lib/internationalOrganizations/sanctions";
import { payOrganizationAid } from "@/lib/internationalOrganizations/aid";
import { queueAidAlignmentPull } from "@/lib/alignment/commands/queueAidAlignment";
import {
  chargeOrganizationDues,
  setOrganizationDuesRate,
  disburseFromOrganizationFund,
  localToUsd,
  resolveOrgFundCurrencyCountry,
} from "@/lib/internationalOrganizations/organizationFund";
import { AGENCY_FUNDING_DURATION_TURNS, getAgencyDef } from "@/lib/constants/orgAgencies";
import { loadUsdGdpByCountry } from "@/lib/internationalOrganizations/queries/worldOrganizations";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getGdpAnchorRate, loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import {
  GDP_MILLIONS_TO_USD,
  INTERNATIONAL_ORGANIZATIONS,
  INTERNATIONAL_ORGANIZATION_ORDER,
  SANCTIONS_DURATION_TURNS,
} from "@/lib/constants/internationalOrganizations";
import { loadOrgFoundingContext } from "@/lib/internationalOrganizations/founding";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import { DIRECTIVE_DURATION_TURNS, getDirectiveDef } from "@/lib/constants/orgDirectives";
import { JOINT_STATEMENT_DURATION_TURNS } from "@/lib/internationalOrganizations/jointStatement";
import { setOrganizationPosture } from "@/lib/internationalOrganizations/posture";
import { POSTURE_META } from "@/lib/constants/orgPosture";
import { getConflict } from "@/lib/db/collections/conflicts";
import { hasBillLifecycle } from "@/lib/legislature/hasBillLifecycle";
import { getHeadOfGovernmentCharacter } from "@/lib/api/headOfGovernment";
import { buildJoinConflictBill } from "@/lib/internationalOrganizations/commands/buildJoinConflictBill";
import {
  admitMember,
  resolveJoinApplication,
} from "@/lib/internationalOrganizations/joinApplication";
import { castAutonomousOrgVotes } from "@/lib/nppAutonomy/autonomousOrgVoting";
import type {
  OrganizationLegislation,
  ProposalVoteRecord,
} from "@/lib/db/types/internationalOrganization";

/**
 * International-organizations turn phase.
 *
 * Three independent sub-resolvers run sequentially against the same DB so each
 * later step sees the membership changes the earlier step committed (e.g. an
 * EU admission in step 1 enlarges the voter pool that step 2 measures FTA
 * unanimity against). Inter-org effects are not concurrent within the phase.
 *
 *   1. Resolve expired membership proposals (unanimous current members).
 *   2. Resolve expired org legislation: FTAs activate when every named party
 *      voted "yes". Non-party members of the host org are not bound and have
 *      no vote. Active FTAs are the data the tariff override layer reads each
 *      turn.
 *   3. Resolve expired leadership elections: simple majority of current
 *      members elects; ties leave the seat unchanged.
 */
export async function processInternationalOrganizationsTurn(
  db: Db,
  currentTurn: number
): Promise<{
  organizationsFounded: number;
  proposalsResolved: number;
  legislationResolved: number;
  electionsResolved: number;
  sanctionsExpired: number;
  directivesExpired: number;
  jointStatementsExpired: number;
  agencyFundingExpired: number;
  duesCharged: number;
  tributeCharged: number;
  autonomousVotesCast: number;
}> {
  // Auto-found orgs whose founding year has arrived BEFORE any vote/proposal
  // handling, so a newly founded org exists for this turn's steps.
  const organizationsFounded = await foundDueOrganizations(db, currentTurn);
  // SP4: cast cooperative votes for autonomy-active member countries BEFORE
  // resolution, so disabled/econ-only members participate in unanimity/majority
  // instead of silently vetoing every membership proposal and FTA. No-op when
  // the autonomy flag is off or no member is autonomy-active.
  const autonomousVotesCast = await castAutonomousOrgVotes(db, currentTurn);
  const proposalsResolved = await resolveExpiredMembershipProposals(db, currentTurn);
  const legislationResolved = await resolveExpiredOrganizationLegislation(db, currentTurn);
  const electionsResolved = await resolveExpiredLeadershipElections(db, currentTurn);
  const sanctionsExpired = await expireActiveSanctions(db, currentTurn);
  const directivesExpired = await expireActiveDirectives(db, currentTurn);
  const jointStatementsExpired = await expireActiveJointStatements(db, currentTurn);
  const agencyFundingExpired = await expireActiveAgencyFunding(db, currentTurn);
  const { duesCharged, tributeCharged } = await chargeAllOrganizationContributions(db);
  return {
    organizationsFounded,
    proposalsResolved,
    legislationResolved,
    electionsResolved,
    sanctionsExpired,
    directivesExpired,
    jointStatementsExpired,
    agencyFundingExpired,
    duesCharged,
    tributeCharged,
    autonomousVotesCast,
  };
}

/**
 * Auto-found built-in orgs whose foundedYear has been reached in a game that
 * started BEFORE that year (orgs with foundedYear <= preset start were seeded
 * at reset). The vacant leadership row is the "already founded" marker, so
 * this is idempotent. Orgs found EMPTY — membership is never automatic; the
 * first applicants use the empty-org accession waiver (orgVoteExempt).
 * Broadcasts a founding news event to every player-enabled country.
 */
export async function foundDueOrganizations(db: Db, currentTurn: number): Promise<number> {
  const { liveYear, preset } = await loadOrgFoundingContext(db);
  if (liveYear == null) return 0; // era-awareness unavailable (legacy rows)
  const startingYear = getStartingYearForPreset(preset);
  const leadershipCol = await getOrganizationLeadershipCollection(db);

  let founded = 0;
  for (const id of INTERNATIONAL_ORGANIZATION_ORDER) {
    const def = INTERNATIONAL_ORGANIZATIONS[id];
    if (def.foundedYear == null || def.foundedYear <= startingYear) continue; // seeded at reset
    if (def.dissolvedYear != null && liveYear >= def.dissolvedYear) continue; // window closed — never auto-found
    if (liveYear < def.foundedYear) continue; // not yet due
    const existing = await leadershipCol.findOne({ organizationId: id });
    if (existing) continue; // already founded

    await leadershipCol.insertOne({
      _id: new ObjectId(),
      organizationId: id,
      holderCharacterId: null,
      holderCharacterName: null,
      holderCountryId: null,
      electedAt: null,
      electedOnTurn: null,
      termEndsOnTurn: null,
      updatedAt: new Date(),
    });

    // "World news": countryHistory is per-country, so broadcast the founding
    // to every player-enabled country's history.
    const countries = await db
      .collection<{ _id: CountryId }>("countryGameStates")
      .find({ enabledForPlayers: true })
      .project<{ _id: CountryId }>({ _id: 1 })
      .toArray();
    for (const c of countries) {
      await recordOrgHistoryEvent(
        db,
        c._id,
        currentTurn,
        `${def.name} has been founded. Countries may now apply for membership.`,
        { organizationId: id, foundedYear: def.foundedYear }
      );
    }
    founded++;
  }
  return founded;
}

/**
 * Charge every organisation's per-turn contributions into its fund.
 *
 * The roll splits in two. Voting members pay the dues rate they themselves
 * voted; everyone else pays fixed tribute. The two sets are complements of one
 * predicate, so no member is billed twice and none escapes both.
 *
 * The access table is loaded once and passed down: both predicates read it, and
 * resolving it per organisation would fan out to two round-trips per org every
 * turn.
 */
async function chargeAllOrganizationContributions(
  db: Db
): Promise<{ duesCharged: number; tributeCharged: number }> {
  const membershipsCol = await getOrganizationMembershipsCollection(db);
  const memberships = await membershipsCol.find({}).toArray();
  if (memberships.length === 0) return { duesCharged: 0, tributeCharged: 0 };

  const access = await getAllCountryAccess(db);
  const orgIds = new Set<string>();
  const votersByOrg = new Map<string, CountryId[]>();
  const allVoters = new Set<CountryId>();
  for (const m of memberships) {
    orgIds.add(m.organizationId);
    if (access[m.countryId as CountryId]?.enabledForPlayers !== true) continue;
    const list = votersByOrg.get(m.organizationId) ?? [];
    list.push(m.countryId as CountryId);
    votersByOrg.set(m.organizationId, list);
    allVoters.add(m.countryId as CountryId);
  }

  const gdpByCountry = await loadUsdGdpByCountry(db, [...allVoters]);
  let duesCharged = 0;
  let tributeCharged = 0;
  for (const orgId of orgIds) {
    // gdpByCountry is USD *millions*; treasuries/fund hold absolute USD, so scale up.
    const memberGdpUsd = (votersByOrg.get(orgId) ?? []).map((c) => ({
      countryId: c,
      gdpUsd: (gdpByCountry.get(c) ?? 0) * GDP_MILLIONS_TO_USD,
    }));
    const dues =
      memberGdpUsd.length > 0 ? await chargeOrganizationDues(db, orgId, memberGdpUsd) : 0;
    if (dues > 0) duesCharged++;
    const tribute = await chargeOrganizationTribute(db, orgId, access);
    if (tribute.collectedLocal > 0) tributeCharged++;
  }
  return { duesCharged, tributeCharged };
}

/**
 * Auto-lift sanctions resolutions whose term has elapsed: delete their
 * org-origin embargoes and mark the resolution terminated.
 */
async function expireActiveSanctions(db: Db, currentTurn: number): Promise<number> {
  const col = await getOrganizationLegislationCollection(db);
  const expired = await col
    .find({ type: "sanctions", status: "active", sanctionsExpiresOnTurn: { $lte: currentTurn } })
    .toArray();
  if (expired.length === 0) return 0;
  const now = new Date();
  for (const r of expired) {
    await liftOrganizationSanctions(db, r._id);
    await col.updateOne({ _id: r._id }, { $set: { status: "terminated", terminatedAt: now } });
  }
  return expired.length;
}

/**
 * Auto-terminate directives whose term has elapsed. No effect cleanup is needed:
 * the metric turn driver reads only `status:"active"` directives, so flipping the
 * status to "terminated" stops the nudge and the metric engine smooths the
 * affected metric back to its un-nudged target over subsequent turns.
 */
async function expireActiveDirectives(db: Db, currentTurn: number): Promise<number> {
  const col = await getOrganizationLegislationCollection(db);
  const expired = await col
    .find({ type: "directive", status: "active", directiveExpiresOnTurn: { $lte: currentTurn } })
    .toArray();
  if (expired.length === 0) return 0;
  await col.updateMany(
    { _id: { $in: expired.map((r) => r._id) } },
    { $set: { status: "terminated", terminatedAt: new Date() } }
  );
  return expired.length;
}

/**
 * Auto-terminate joint statements whose approval-effect term has elapsed. The
 * approval snapshot already filters by `jointStatementExpiresOnTurn`, so this is
 * a status-only cleanup (keeps the "in force" UI list accurate); no approval
 * write is needed — the effect simply stops being read.
 */
async function expireActiveJointStatements(db: Db, currentTurn: number): Promise<number> {
  const col = await getOrganizationLegislationCollection(db);
  const expired = await col
    .find({
      type: "joint_statement",
      status: "active",
      jointStatementExpiresOnTurn: { $lte: currentTurn },
    })
    .toArray();
  if (expired.length === 0) return 0;
  await col.updateMany(
    { _id: { $in: expired.map((r) => r._id) } },
    { $set: { status: "terminated", terminatedAt: new Date() } }
  );
  return expired.length;
}

/**
 * Auto-terminate funded agency programmes whose term has elapsed. Status-only
 * cleanup (the metric driver filters by `agencyExpiresOnTurn`); the member-wide
 * effect simply stops being read and the engine smooths the metrics back.
 */
async function expireActiveAgencyFunding(db: Db, currentTurn: number): Promise<number> {
  const col = await getOrganizationLegislationCollection(db);
  const expired = await col
    .find({ type: "fund_agency", status: "active", agencyExpiresOnTurn: { $lte: currentTurn } })
    .toArray();
  if (expired.length === 0) return 0;
  await col.updateMany(
    { _id: { $in: expired.map((r) => r._id) } },
    { $set: { status: "terminated", terminatedAt: new Date() } }
  );
  return expired.length;
}

async function resolveExpiredMembershipProposals(db: Db, currentTurn: number): Promise<number> {
  const col = await getOrganizationProposalsCollection(db);
  const expired = await col
    .find({ status: "pending", closesOnTurn: { $lte: currentTurn } })
    .toArray();

  let resolved = 0;
  const now = new Date();

  for (const proposal of expired) {
    const proposingCountryId = proposal.proposingCountryId as CountryId;

    // Founding applications: the org-vote gate was waived at application time
    // (org had 0 members; orgApproved is pre-set true). Recomputing it from
    // votes here would overwrite the waiver with a failed 0-voter tally, so
    // just poll the domestic bill via the arbiter until it resolves.
    if (proposal.orgVoteExempt) {
      await resolveJoinApplication(db, proposal._id, currentTurn);
      resolved++;
      continue;
    }

    const members = await getMembers(db, proposal.organizationId);
    // Only player-enabled members have a vote: a client state cannot withhold a
    // unanimous "yes" it was never entitled to cast, which is what keeps
    // unanimity workable once an alliance takes on clients.
    const voters = (await votingMembers(db, proposal.organizationId)).filter(
      (m: string) => m !== proposingCountryId
    );
    const uniqueVotes = dedupeOrganizationVotes(proposal.votes as ProposalVoteRecord[]);

    // Unanimous current members must vote "yes". Abstain or no-vote counts as
    // non-approval. Empty voter set (e.g., applying to a 0-member org) cannot
    // succeed under unanimity — block instead of silently admitting.
    let approved = false;
    if (voters.length === 0) {
      approved = members.includes(proposingCountryId);
    } else {
      const yesVoters = new Set<string>(
        uniqueVotes
          .filter((v: ProposalVoteRecord) => v.vote === "yes")
          .map((v: ProposalVoteRecord) => v.countryId)
      );
      approved = voters.every((c: string) => yesVoters.has(c));
    }

    // Parallel join (has a linked domestic Join bill): record the member-vote
    // result and let the arbiter admit (both gates passed) or cancel the
    // counterpart. The legacy single-gate path below is kept for proposals with
    // no linked bill.
    if (proposal.domesticBillId) {
      await col.updateOne({ _id: proposal._id }, { $set: { orgApproved: approved } });
      await resolveJoinApplication(db, proposal._id, currentTurn);
      resolved++;
      continue;
    }

    if (approved) {
      // admitMember idempotently upserts the membership AND clears any prior
      // withdrawal tombstone, so a re-admitted founder is no longer suppressed
      // by the self-heal and a future withdrawal can re-tombstone it.
      await admitMember(db, proposal.organizationId, proposingCountryId, currentTurn);
      await col.updateOne(
        { _id: proposal._id },
        {
          $set: {
            status: "approved",
            resolvedAt: now,
            resolvedOnTurn: currentTurn,
          },
        }
      );
      await recordOrgHistoryEvent(
        db,
        proposingCountryId,
        currentTurn,
        `${COUNTRY_CONFIGS[proposingCountryId].name} admitted to ${proposal.organizationId}.`,
        { organizationId: proposal.organizationId }
      );
    } else {
      await col.updateOne(
        { _id: proposal._id },
        {
          $set: {
            status: voters.length === 0 ? "expired" : "rejected",
            resolvedAt: now,
            resolvedOnTurn: currentTurn,
          },
        }
      );
      await recordOrgHistoryEvent(
        db,
        proposingCountryId,
        currentTurn,
        `${COUNTRY_CONFIGS[proposingCountryId].name}'s application to ${proposal.organizationId} was rejected.`,
        { organizationId: proposal.organizationId }
      );
    }
    resolved++;
  }

  // Poll still-pending parallel joins so a linked Join-bill pass/fail (which can
  // land any turn, before or after the member-vote deadline) is acted on. The
  // arbiter is idempotent; the `domesticBillId` guard skips legacy proposals.
  const pendingJoins = await col
    .find({ status: "pending", domesticBillId: { $exists: true } })
    .toArray();
  for (const p of pendingJoins) {
    if (!p.domesticBillId) continue;
    await resolveJoinApplication(db, p._id, currentTurn);
  }

  return resolved;
}

async function resolveExpiredOrganizationLegislation(db: Db, currentTurn: number): Promise<number> {
  const col = await getOrganizationLegislationCollection(db);
  const expired = await col
    .find({ status: "pending", closesOnTurn: { $lte: currentTurn } })
    .toArray();
  if (expired.length === 0) return 0;

  let resolved = 0;
  const now = new Date();

  for (const item of expired) {
    const parties = (item.parties as OrgMemberId[] | undefined) ?? [];
    // Votes — and vetoes — belong to player-enabled members only. An FTA party
    // that cannot vote would deadlock the agreement exactly as a silent member
    // would deadlock an admission. The agreement still *binds* every party once
    // ratified, so only the ballot is narrowed here, not the effect below.
    const members = await votingMembers(db, item.organizationId);
    const voterSet = new Set<string>(members);
    const votingParties = parties.filter((p): p is CountryId => voterSet.has(p));
    const uniqueVotes = dedupeOrganizationVotes(item.votes as ProposalVoteRecord[]);
    // The UN's founding members hold a permanent-member veto; no other org does.
    const permanentMembers =
      item.organizationId === "UN" ? INTERNATIONAL_ORGANIZATIONS.UN.foundingMembers : [];
    const approved = resolutionPasses({
      type: item.type,
      members,
      parties: votingParties,
      votes: uniqueVotes,
      permanentMembers,
    });

    if (approved) {
      const sanctionsExpiresOnTurn =
        item.type === "sanctions" ? currentTurn + SANCTIONS_DURATION_TURNS : undefined;
      const directiveExpiresOnTurn =
        item.type === "directive" ? currentTurn + DIRECTIVE_DURATION_TURNS : undefined;
      const jointStatementExpiresOnTurn =
        item.type === "joint_statement" ? currentTurn + JOINT_STATEMENT_DURATION_TURNS : undefined;
      const agencyExpiresOnTurn =
        item.type === "fund_agency" ? currentTurn + AGENCY_FUNDING_DURATION_TURNS : undefined;
      await col.updateOne(
        { _id: item._id },
        {
          $set: {
            status: "active",
            enactedAt: now,
            enactedOnTurn: currentTurn,
            ...(sanctionsExpiresOnTurn !== undefined ? { sanctionsExpiresOnTurn } : {}),
            ...(directiveExpiresOnTurn !== undefined ? { directiveExpiresOnTurn } : {}),
            ...(jointStatementExpiresOnTurn !== undefined ? { jointStatementExpiresOnTurn } : {}),
            ...(agencyExpiresOnTurn !== undefined ? { agencyExpiresOnTurn } : {}),
          },
        }
      );
      // Resolution effects land on countries the game models; a macro-tier
      // member has no economy or metrics for a sanction or an aid package to
      // touch.
      // Effects land on every member the game models, voting or not — a client
      // state is still bound by its bloc's sanctions.
      const effectMembers = (await getMembers(db, item.organizationId)).filter(
        (m): m is CountryId => m in COUNTRY_CONFIGS
      );
      // `members` (the voting roster, computed above) travels ALONGSIDE
      // effectMembers rather than replacing it. Sanctions and aid bind every
      // modelled member, voting or not — a client state is still bound by its
      // bloc's embargo — but only a member with a legislature can be ASKED to
      // legislate, which is what join_conflict does.
      await applyResolutionEffect(
        db,
        item,
        effectMembers,
        currentTurn,
        sanctionsExpiresOnTurn,
        members
      );
      if (item.type === "free_trade_agreement") {
        const partyNames = parties
          .map((p: string) => COUNTRY_CONFIGS[p as CountryId]?.name ?? p)
          .join(", ");
        // Country history is a player-facing timeline, so it only takes ids the
        // game renders a country page for; a macro party is still bound, it
        // simply has no page to log the ratification on.
        for (const partyCountry of parties.filter((p): p is CountryId => p in COUNTRY_CONFIGS)) {
          await recordOrgHistoryEvent(
            db,
            partyCountry,
            currentTurn,
            `${item.organizationId} ratified a free-trade agreement: ${partyNames}.`,
            { organizationId: item.organizationId, legislationId: item._id.toString() }
          );
        }
      }
    } else {
      await col.updateOne(
        { _id: item._id },
        {
          $set: {
            status: "rejected",
            enactedAt: undefined,
            enactedOnTurn: undefined,
          },
        }
      );
    }
    resolved++;
  }
  return resolved;
}

async function resolveExpiredLeadershipElections(db: Db, currentTurn: number): Promise<number> {
  const electionsCol = await getOrganizationLeadershipElectionsCollection(db);
  const leadershipCol = await getOrganizationLeadershipCollection(db);
  const expired = await electionsCol
    .find({ status: "pending", closesOnTurn: { $lte: currentTurn } })
    .toArray();
  if (expired.length === 0) return 0;

  let resolved = 0;
  const now = new Date();

  for (const election of expired) {
    // Electing a chair is a vote like any other, so the roll is the voting one.
    // This also keeps the quorum honest: a silent client state would otherwise
    // count toward turnout it can never supply.
    const members = await votingMembers(db, election.organizationId);
    const uniqueVotes = dedupeOrganizationVotes(election.votes as ProposalVoteRecord[]);
    // Tally yes/no/abstain. Members who didn't vote are treated as abstain.
    let yes = 0;
    let no = 0;
    for (const v of uniqueVotes) {
      if (!members.includes(v.countryId)) continue;
      if (v.vote === "yes") yes++;
      else if (v.vote === "no") no++;
    }
    // Simple majority of votes cast (excluding abstain). Tie or zero turnout
    // leaves the seat unchanged — the org continues operating with the prior
    // holder (or vacant) until a future election decides.
    const elected = yes > no && yes > 0;

    if (elected) {
      const orgDef = await loadOrganizationDef(db, election.organizationId);
      const termTurns = orgDef?.leadership.termTurns ?? 96;
      await leadershipCol.updateOne(
        { organizationId: election.organizationId },
        {
          $set: {
            holderCharacterId: election.candidateCharacterId,
            holderCharacterName: election.candidateCharacterName,
            holderCountryId: election.candidateCountryId,
            electedAt: now,
            electedOnTurn: currentTurn,
            termEndsOnTurn: currentTurn + termTurns,
            updatedAt: now,
          },
        },
        { upsert: true }
      );
      await electionsCol.updateOne(
        { _id: election._id },
        {
          $set: {
            status: "elected",
            resolvedAt: now,
            resolvedOnTurn: currentTurn,
          },
        }
      );
      await recordOrgHistoryEvent(
        db,
        election.candidateCountryId as CountryId,
        currentTurn,
        `${election.candidateCharacterName} elected ${orgDef?.leadership.title ?? "leader"} of ${election.organizationId}.`,
        { organizationId: election.organizationId, electionId: election._id.toString() }
      );
    } else {
      await electionsCol.updateOne(
        { _id: election._id },
        {
          $set: {
            status: "rejected",
            resolvedAt: now,
            resolvedOnTurn: currentTurn,
          },
        }
      );
    }
    resolved++;
  }
  return resolved;
}

/**
 * Apply a resolution's on-passage effect. FTAs need no extra write — the tariff
 * override layer reads active `free_trade_agreement` rows directly. Sanctions
 * enact org-origin embargoes. Directive / aid_package / joint_statement effects
 * land in Phase 2-ii (metrics-engine + treasury integration).
 */
async function applyResolutionEffect(
  db: Db,
  resolution: OrganizationLegislation,
  members: CountryId[],
  currentTurn: number,
  expiresTurn?: number,
  /**
   * The VOTING roster — player-enabled members only.
   *
   * Separate from `members`, which is every modelled member: an effect that binds
   * a country (sanctions, aid) is not the same set as one that asks a country to
   * legislate. Only `join_conflict` needs this.
   */
  votingMemberIds: CountryId[] = []
): Promise<void> {
  switch (resolution.type) {
    case "free_trade_agreement":
      return; // read by the tariff override layer; no extra state.
    case "sanctions": {
      const target = resolution.sanctionsTargetCountryId;
      const commodity = resolution.sanctionsCommodity;
      if (!target || !commodity) return;
      await applyOrganizationSanctions(db, {
        resolutionId: resolution._id,
        targetCountryId: target,
        commodity,
        members,
        createdBy: resolution.proposedByCharacterId,
        currentTurn,
        expiresTurn,
      });
      return;
    }
    case "aid_package": {
      const recipient = resolution.aidRecipientCountryId;
      const amount = resolution.aidAmount;
      if (!recipient || !amount) return;
      const paid = await payOrganizationAid(db, resolution.organizationId, recipient, amount);
      if (paid) {
        // The political half of the bargain: a bloc that pays its clients keeps
        // them. Queued as a pull so it lands through the same cap, resistance
        // and locked gate as everything else that moves the meter.
        await queueAidAlignmentPull({
          db,
          organizationId: resolution.organizationId,
          recipient,
          amountUsd: localToUsd(
            await resolveOrgFundCurrencyCountry(db, resolution.organizationId),
            amount
          ),
          amountLocal: amount,
          turn: currentTurn,
        });
      }
      if (!paid) {
        await recordOrgHistoryEvent(
          db,
          recipient,
          currentTurn,
          `${resolution.organizationId} aid to ${COUNTRY_CONFIGS[recipient].name} could not be disbursed — the fund was short.`,
          { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
        );
      }
      return;
    }
    case "set_dues": {
      if (resolution.duesRateAnnual !== undefined) {
        await setOrganizationDuesRate(db, resolution.organizationId, resolution.duesRateAnnual);
      }
      return;
    }
    case "join_conflict": {
      const theaterId = resolution.joinConflictTheaterId;
      const side = resolution.joinConflictSide;
      if (!theaterId || !side) return;

      // A resolution sits for 24 turns; the war it was about can end inside that
      // window. Mirrors declareWar, which re-runs findWarBetween at enactment.
      const conflict = await getConflict(db, theaterId);
      if (!conflict || conflict.status === "resolved") {
        await recordOrgHistoryEvent(
          db,
          resolution.proposingCountryId,
          currentTurn,
          `${resolution.organizationId}'s entry resolution lapsed: that conflict is over.`,
          { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
        );
        return;
      }

      const preset = await loadWorldPreset(db);
      const chosen = (
        side === "A" ? conflict.sideA.countries : conflict.sideB.countries
      ) as string[];
      const other = (
        side === "A" ? conflict.sideB.countries : conflict.sideA.countries
      ) as string[];

      for (const countryId of votingMemberIds) {
        // A bill minted for a country no engine walks never closes — it sits at
        // active_both forever, with nothing to resolve it and nothing reporting it.
        if (!hasBillLifecycle(countryId)) {
          await recordOrgHistoryEvent(
            db,
            countryId,
            currentTurn,
            `${COUNTRY_CONFIGS[countryId].name} could not act on ${resolution.organizationId}'s entry resolution: no legislature.`,
            { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
          );
          continue;
        }
        // Already in, on the side the bloc chose: nothing to ask.
        if (chosen.includes(countryId)) continue;
        if (other.includes(countryId)) {
          // A bloc resolution never switches a country's side mid-war.
          await recordOrgHistoryEvent(
            db,
            countryId,
            currentTurn,
            `${COUNTRY_CONFIGS[countryId].name} is already fighting on the other side of ${conflict.name}.`,
            { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
          );
          continue;
        }

        // The head of government sponsors it — the bill arrives at a foreign
        // power's call, so it is filed in the government's name, not a member's.
        const sponsor = await getHeadOfGovernmentCharacter(db, countryId);
        if (!sponsor) {
          await recordOrgHistoryEvent(
            db,
            countryId,
            currentTurn,
            `${COUNTRY_CONFIGS[countryId].name} could not act on ${resolution.organizationId}'s entry resolution: no head of government.`,
            { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
          );
          continue;
        }

        await buildJoinConflictBill({
          db,
          countryId,
          preset,
          sponsor: { characterId: sponsor._id, characterName: sponsor.name },
          conflictName: conflict.name,
          organizationId: resolution.organizationId,
          provision: {
            type: "join_conflict",
            theaterId,
            side,
            organizationId: resolution.organizationId,
            resolutionId: resolution._id.toString(),
          },
        });
      }
      return;
    }
    case "set_posture": {
      // The posture doc is the SSOT, read live each turn by the metric driver
      // (`loadActivePostureNudgesByCountry`); passage updates it + a history note.
      if (resolution.postureValue === undefined) return;
      await setOrganizationPosture(db, resolution.organizationId, resolution.postureValue);
      await recordOrgHistoryEvent(
        db,
        resolution.proposingCountryId,
        currentTurn,
        `${resolution.organizationId} moved to ${POSTURE_META[resolution.postureValue].label} alert posture.`,
        { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
      );
      return;
    }
    case "directive": {
      // The metric effect is read live each turn by the metric turn driver
      // (`loadActiveDirectiveNudgesByCountry`) for as long as the directive is
      // active, so passage needs no metric write — just a history note.
      const def = getDirectiveDef(resolution.directiveKey);
      if (!def) return;
      await recordOrgHistoryEvent(
        db,
        resolution.proposingCountryId,
        currentTurn,
        `${resolution.organizationId} adopted the ${def.label} directive across ${members.length} member${members.length === 1 ? "" : "s"}.`,
        { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
      );
      return;
    }
    case "fund_agency": {
      // Draw the programme's cost from the pooled fund. Funded → the member-wide
      // metric effect is read live each turn (`loadActiveAgencyNudgesByCountry`)
      // until expiry. Underfunded → terminate now so the effect is never read.
      const def = getAgencyDef(resolution.agencyKey);
      if (!def) return;
      // Catalog costs are in USD; convert to the fund's (founding) currency to draw.
      const fundCountry = await resolveOrgFundCurrencyCountry(db, resolution.organizationId);
      const fundRate = getGdpAnchorRate(fundCountry, await loadWorldPreset(db));
      const costFund = Math.round(def.costUsd / fundRate);
      const funded = await disburseFromOrganizationFund(db, resolution.organizationId, costFund);
      if (!funded) {
        const col = await getOrganizationLegislationCollection(db);
        await col.updateOne(
          { _id: resolution._id },
          { $set: { status: "terminated", terminatedAt: new Date() } }
        );
        await recordOrgHistoryEvent(
          db,
          resolution.proposingCountryId,
          currentTurn,
          `${resolution.organizationId} could not fund the ${def.label} — the pooled fund was short.`,
          { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
        );
        return;
      }
      await recordOrgHistoryEvent(
        db,
        resolution.proposingCountryId,
        currentTurn,
        `${resolution.organizationId} funded the ${def.label} across ${members.length} member${members.length === 1 ? "" : "s"}.`,
        { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
      );
      return;
    }
    case "joint_statement": {
      // The bounded approval effect is read live each turn by the government-
      // approval snapshot (`getActiveOrgStatementModifiersByCountry`) while the
      // statement is active, so passage only needs a history note.
      const subject = resolution.jointStatementSubjectCountryId;
      if (!subject) return;
      const verb = resolution.jointStatementStance === "condemn" ? "condemned" : "endorsed";
      await recordOrgHistoryEvent(
        db,
        subject,
        currentTurn,
        `${resolution.organizationId} ${verb} ${COUNTRY_CONFIGS[subject].name}.`,
        { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
      );
      return;
    }
  }
}
