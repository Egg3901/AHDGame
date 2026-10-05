import { captureServerGameEvent } from "@/lib/analytics/serverPosthog";
import {
  loadOrganizationCashContext,
  type OrganizationCashContext,
} from "@/lib/internationalOrganizations/cashLedger";
import {
  ensureEuropeanIntegrationState,
  reconcileEuropeanTreatyLive,
} from "@/lib/internationalOrganizations/europeanIntegration/service";
import { withEuropeanInstitution } from "@/lib/internationalOrganizations/europeanIntegration/definition";
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
import { fillSilentBallots } from "@/lib/internationalOrganizations/closeTimeBallots";
import { chargeOrganizationTribute } from "@/lib/internationalOrganizations/tribute";
import {
  ORG_TRIBUTE_RATES_ANNUAL,
  orgTributeRateAnnual,
  GDP_MILLIONS_TO_USD,
  INTERNATIONAL_ORGANIZATIONS,
  INTERNATIONAL_ORGANIZATION_ORDER,
  SANCTIONS_DURATION_TURNS,
} from "@/lib/constants/internationalOrganizations";
import { getAllCountryAccess } from "@/lib/countryAccess";
import type { OrgMemberId, ProposalVoteRecord } from "@/lib/db/types/internationalOrganization";
import {
  dedupeOrganizationVotes,
  upsertPendingOrganizationVote,
} from "@/lib/internationalOrganizations/voteWrite";
import {
  ballotIsPlayerOnly,
  ballotPasses,
  resolutionPasses,
  type OrgBallotKind,
} from "@/lib/internationalOrganizations/resolutionRules";
import { liftOrganizationSanctions } from "@/lib/internationalOrganizations/sanctions";
import { chargeOrganizationDues } from "@/lib/internationalOrganizations/organizationFund";
import { AGENCY_FUNDING_DURATION_TURNS } from "@/lib/constants/orgAgencies";
import { loadUsdGdpByCountry } from "@/lib/internationalOrganizations/queries/worldOrganizations";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import { loadOrgFoundingContext } from "@/lib/internationalOrganizations/founding";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import { DIRECTIVE_DURATION_TURNS } from "@/lib/constants/orgDirectives";
import { JOINT_STATEMENT_DURATION_TURNS } from "@/lib/internationalOrganizations/jointStatement";
import {
  admitMember,
  resolveJoinApplication,
} from "@/lib/internationalOrganizations/joinApplication";
import { nppGovernedMembers } from "@/lib/internationalOrganizations/ballotRoll";
import { castAutonomousOrgVotes } from "@/lib/nppAutonomy/autonomousOrgVoting";
import { reconcileAutonomousWarEntryBills } from "@/lib/internationalOrganizations/reconcileAutonomousWarEntry";
import {
  loadOrganizationWarPlanningContext,
  type OrganizationWarPlanningContext,
} from "@/lib/internationalOrganizations/warDeclarationPlanning";
import {
  countryName,
  applyResolutionEffect,
  captureDiplomaticExpiry,
} from "./internationalOrganizationsEffects";

/**
 * Voting roster for one ballot. Shadow/off preserve the player-only baseline.
 * Active mode adds modelled members that have a formed NPP government and a
 * legislature capable of resolving the consequences of their vote — except on
 * the player-only ballots `ballotIsPlayerOnly` names.
 *
 * ADMISSION, WAR DECLARATION, AND WAR ENTRY KEEP THE PLAYER-ONLY ROLL, whatever
 * the rollout mode.
 * That is the rule `orgMembership.ts` already states for client states, and it
 * is here for the same reason: on those ballots a member is asked to consent to
 * someone else's business, and its silence is indistinguishable from a veto. An
 * NPP government plans once every six turns and executes a single ranked action,
 * so across a 24-turn ballot it has four contested chances to vote. Seating it
 * there made every Warsaw Pact admission unwinnable: China closed 5-of-7 and
 * North Korea 2-of-7 with no "no" votes cast at all, purely because Poland and
 * Czechoslovakia never got round to it (ticket #1257).
 *
 * Everything else keeps the wider roll and the modelled bloc keeps its say. On a
 * majority ballot a silence costs a yes and nothing worse; on an FTA the voters
 * ARE the parties, each deciding its own agreement, and narrowing that would
 * leave a deal between two modelled neighbours with no voters at all.
 */
async function ballotVotingMembers(
  db: Db,
  organizationId: string,
  kind: OrgBallotKind
): Promise<CountryId[]> {
  const players = await votingMembers(db, organizationId);
  if (ballotIsPlayerOnly(kind)) return players;
  return legislatingMembers(db, organizationId, players);
}

/**
 * Members that can be ASKED TO LEGISLATE: player-enabled members, plus — in
 * active mode — modelled members whose formed NPP government can sponsor a bill
 * through a real legislature.
 *
 * This is deliberately NOT the same list as the player-only ballot roll. Being
 * unable to reliably *vote within a deadline* is what disqualifies an NPP member
 * from an admission, declaration, or entry resolution; it says nothing about
 * whether that country can be handed a war-entry bill once the bloc has already
 * decided. `join_conflict` needs exactly this wider set (bloc war entry, #1067):
 * France's NPP premier sponsors her own ratification bill even though France
 * holds no ballot on the resolution that produced it.
 */
async function legislatingMembers(
  db: Db,
  organizationId: string,
  players?: CountryId[]
): Promise<CountryId[]> {
  const enabled = players ?? (await votingMembers(db, organizationId));
  const governed = await nppGovernedMembers(db, () => getMembers(db, organizationId));
  return Array.from(new Set([...enabled, ...governed]));
}

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
  closeTimeBallotsCast?: number;
}> {
  await reconcileEuropeanTreatyLive(db, currentTurn);
  // Auto-found orgs whose founding year has arrived BEFORE any vote/proposal
  // handling, so a newly founded org exists for this turn's steps.
  const organizationsFounded = await foundDueOrganizations(db, currentTurn);
  const cashContext = await loadOrganizationCashContext(db, currentTurn);
  // SP4: cast cooperative votes for autonomy-active member countries BEFORE
  // resolution, so disabled/econ-only members participate in unanimity/majority
  // instead of silently vetoing every membership proposal and FTA. No-op when
  // the autonomy flag is off or no member is autonomy-active.
  const autonomousVotesCast = await castAutonomousOrgVotes(db, currentTurn);
  const proposalsResolved = await resolveExpiredMembershipProposals(db, currentTurn);
  const legislationResolved = await resolveExpiredOrganizationLegislation(
    db,
    currentTurn,
    cashContext
  );
  await reconcileAutonomousWarEntryBills(db);
  const electionsResolved = await resolveExpiredLeadershipElections(db, currentTurn);
  const sanctionsExpired = await expireActiveSanctions(db, currentTurn);
  const directivesExpired = await expireActiveDirectives(db, currentTurn);
  const jointStatementsExpired = await expireActiveJointStatements(db, currentTurn);
  const agencyFundingExpired = await expireActiveAgencyFunding(db, currentTurn);
  const { duesCharged, tributeCharged } = await chargeAllOrganizationContributions(db, cashContext);
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
  const { liveYear, preset, europeanIntegration } = await loadOrgFoundingContext(db);
  if (liveYear == null) return 0; // era-awareness unavailable (legacy rows)
  const startingYear = getStartingYearForPreset(preset);
  const leadershipCol = await getOrganizationLeadershipCollection(db);
  const european =
    europeanIntegration ??
    (await ensureEuropeanIntegrationState(
      db,
      preset,
      (await db.collection("organizationMemberships").countDocuments({ organizationId: "EU" })) > 0
    ));

  let founded = 0;
  for (const id of INTERNATIONAL_ORGANIZATION_ORDER) {
    const def = withEuropeanInstitution(INTERNATIONAL_ORGANIZATIONS[id], european);
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
  db: Db,
  cashContext: OrganizationCashContext | null
): Promise<{ duesCharged: number; tributeCharged: number }> {
  const membershipsCol = await getOrganizationMembershipsCollection(db);
  const memberships = await membershipsCol.find({}).toArray();
  if (memberships.length === 0) return { duesCharged: 0, tributeCharged: 0 };

  const access = await getAllCountryAccess(db);
  const orgIds = new Set<string>();
  const votersByOrg = new Map<string, CountryId[]>();
  const nonVotersByOrg = new Map<string, CountryId[]>();
  const allPayers = new Set<CountryId>();
  for (const m of memberships) {
    orgIds.add(m.organizationId);
    const bucket =
      access[m.countryId as CountryId]?.enabledForPlayers === true ? votersByOrg : nonVotersByOrg;
    const list = bucket.get(m.organizationId) ?? [];
    list.push(m.countryId as CountryId);
    bucket.set(m.organizationId, list);
    allPayers.add(m.countryId as CountryId);
  }

  const gdpByCountry = await loadUsdGdpByCountry(db, [...allPayers]);
  // Cheapest gate first, exactly as `chargeOrganizationTribute` does it: only
  // organisations named in the tribute table can levy it at all, so a world
  // with none never pays for the preset round-trip.
  let presetPromise: Promise<string> | null = null;
  const leviesTributeFor = async (orgId: string): Promise<boolean> => {
    if (!(orgId in ORG_TRIBUTE_RATES_ANNUAL)) return false;
    presetPromise ??= loadWorldPreset(db);
    return orgTributeRateAnnual(orgId, await presetPromise) > 0;
  };

  let duesCharged = 0;
  let tributeCharged = 0;
  for (const orgId of orgIds) {
    // ─── Every member contributes exactly once (#1156) ──────────────────────
    //
    // `orgMembership` partitions the roll into voters (dues) and everyone else
    // (tribute), and its docblock promises "nobody is billed twice and nobody
    // is billed not at all". The second half was not true: tribute exists only
    // for the two armed blocs, so in EVERY other organisation the non-voting
    // members were assessed nothing at all and sat on the roll for free. That
    // is what players saw as members who never pay dues.
    //
    // Where the organisation levies tribute the partition stands untouched.
    // Where it does not, non-voting members are assessed ordinary dues like
    // anyone else — they are still members, they still have an economy, and
    // there is no second instrument to catch them.
    const duesPayers = (await leviesTributeFor(orgId))
      ? (votersByOrg.get(orgId) ?? [])
      : [...(votersByOrg.get(orgId) ?? []), ...(nonVotersByOrg.get(orgId) ?? [])];
    // gdpByCountry is USD *millions*; treasuries/fund hold absolute USD, so scale up.
    // A member absent from the map has no economic data, which is not a GDP of
    // zero — `memberDueUsd` skips it rather than billing nothing silently.
    const memberGdpUsd = duesPayers.map((c) => ({
      countryId: c,
      gdpUsd: (gdpByCountry.get(c) ?? 0) * GDP_MILLIONS_TO_USD,
    }));
    const dues =
      memberGdpUsd.length > 0
        ? await chargeOrganizationDues(db, orgId, memberGdpUsd, { context: cashContext })
        : 0;
    if (dues > 0) duesCharged++;
    const tribute = await chargeOrganizationTribute(db, orgId, access, { context: cashContext });
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
    await captureDiplomaticExpiry(db, currentTurn, r);
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
  for (const item of expired) await captureDiplomaticExpiry(db, currentTurn, item);
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
  for (const item of expired) await captureDiplomaticExpiry(db, currentTurn, item);
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
  for (const item of expired) await captureDiplomaticExpiry(db, currentTurn, item);
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
    // unanimity workable once an alliance takes on clients. An NPP-governed
    // member is silent for the same practical reason and is excluded on the same
    // grounds — see `ballotVotingMembers`.
    const voters = (
      await ballotVotingMembers(db, proposal.organizationId, "membership_proposal")
    ).filter((m: string) => m !== proposingCountryId);

    // Close-time ballots (active mode): a silent autonomy-active voter is the
    // planner having never reached this item, not a deliberate nay. Cast its
    // ballot before the tally, or one busy six-hour cycle vetoes the bloc.
    await fillSilentBallots(
      db,
      [proposal],
      () => voters,
      () => proposingCountryId,
      async (item, vote) => upsertPendingOrganizationVote(col, item._id, vote),
      currentTurn
    );
    const uniqueVotes = dedupeOrganizationVotes(proposal.votes as ProposalVoteRecord[]);

    // Unanimous current members must vote "yes". Abstain or no-vote counts as
    // non-approval. Empty voter set (e.g., applying to a 0-member org) cannot
    // succeed under unanimity — `ballotPasses` blocks a zero-size ballot rather
    // than silently admitting, so only the founding waiver reads through.
    let approved = false;
    if (voters.length === 0) {
      approved = members.includes(proposingCountryId);
    } else {
      const yesVoters = new Set<string>(
        uniqueVotes
          .filter((v: ProposalVoteRecord) => v.vote === "yes")
          .map((v: ProposalVoteRecord) => v.countryId)
      );
      const yes = voters.filter((c: string) => yesVoters.has(c)).length;
      approved = ballotPasses("membership_proposal", voters.length, yes);
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
        `${countryName(proposingCountryId)} admitted to ${proposal.organizationId}.`,
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
        `${countryName(proposingCountryId)}'s application to ${proposal.organizationId} was rejected.`,
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

async function resolveExpiredOrganizationLegislation(
  db: Db,
  currentTurn: number,
  cashContext: OrganizationCashContext | null
): Promise<number> {
  const col = await getOrganizationLegislationCollection(db);
  const expired = await col
    .find({ status: "pending", closesOnTurn: { $lte: currentTurn } })
    .toArray();
  if (expired.length === 0) return 0;
  const foundingContext = expired.some((row) => row.organizationId === "EU")
    ? await loadOrgFoundingContext(db)
    : {};

  let resolved = 0;
  const now = new Date();
  let organizationWarPlanningContext: Promise<OrganizationWarPlanningContext> | undefined;

  for (const item of expired) {
    const parties = (item.parties as OrgMemberId[] | undefined) ?? [];
    // The roll is kind-aware. A declaration or join-conflict resolution is
    // player-enabled members only: it asks a member to consent to a war it is
    // not otherwise in, and silence under unanimity would veto it. Everything else here seats the
    // modelled NPP bloc too — majority resolutions, where a silence costs a yes
    // rather than vetoing, and FTAs, which are unanimous but voted only by their
    // own named parties, each ratifying an agreement it is itself signing.
    // Either way the agreement still *binds* every party once ratified, so only
    // the ballot is narrowed here, not the effect below.
    const members = await ballotVotingMembers(db, item.organizationId, item.type);
    const voterSet = new Set<string>(members);
    const votingParties = parties.filter((p): p is CountryId => voterSet.has(p));
    // Close-time ballots (active mode): fill a silent autonomy-active voter
    // before the tally. An FTA is voted by its parties, any other resolution by
    // the whole voting roll — the same split resolutionPasses applies.
    await fillSilentBallots(
      db,
      [item],
      () => (item.type === "free_trade_agreement" ? votingParties : members),
      () => null,
      async (doc, vote) => upsertPendingOrganizationVote(col, doc._id, vote),
      currentTurn
    );
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
      const activation = {
        status: "active" as const,
        enactedAt: now,
        enactedOnTurn: currentTurn,
        ...(sanctionsExpiresOnTurn !== undefined ? { sanctionsExpiresOnTurn } : {}),
        ...(directiveExpiresOnTurn !== undefined ? { directiveExpiresOnTurn } : {}),
        ...(jointStatementExpiresOnTurn !== undefined ? { jointStatementExpiresOnTurn } : {}),
        ...(agencyExpiresOnTurn !== undefined ? { agencyExpiresOnTurn } : {}),
      };
      // Declaration enactment can create a conflict and fan national bills out
      // across several countries. Keep it pending until all idempotent effects
      // finish so a transient DB failure is retried next turn instead of leaving
      // a permanently partial coalition. Existing resolution effects retain their
      // historical activate-then-apply ordering.
      if (item.type !== "declare_war") {
        await col.updateOne({ _id: item._id }, { $set: activation });
      }
      // Resolution effects land on countries the game models; a macro-tier
      // member has no economy or metrics for a sanction or an aid package to
      // touch.
      // Effects land on every member the game models, voting or not — a client
      // state is still bound by its bloc's sanctions.
      const effectMembers = (await getMembers(db, item.organizationId)).filter(
        (m): m is CountryId => m in COUNTRY_CONFIGS
      );
      // THREE different rolls, and they are three because they answer three
      // different questions. `effectMembers` is bound by the result (sanctions
      // and aid reach a client state too). `members`, computed above, is who
      // VOTED. `legislating` is who can be asked to pass a bill about it — the
      // one join_conflict needs, and the reason it is not `members`: an NPP
      // government is off the unanimity ballot because it cannot be relied on to
      // vote before the deadline, which is no reason to spare it the war it is
      // now in.
      const legislating =
        item.type === "join_conflict" ? await legislatingMembers(db, item.organizationId) : members;
      const warPlanningContext =
        item.type === "declare_war"
          ? await (organizationWarPlanningContext ??= loadOrganizationWarPlanningContext(
              db,
              currentTurn
            ))
          : undefined;
      const effectApplied = await applyResolutionEffect(
        db,
        item,
        effectMembers,
        currentTurn,
        sanctionsExpiresOnTurn,
        legislating,
        foundingContext,
        cashContext,
        warPlanningContext
      );
      if (item.type === "declare_war") {
        await col.updateOne(
          { _id: item._id, status: "pending" },
          effectApplied === false
            ? { $set: { status: "expired" } }
            : {
                $set: {
                  ...activation,
                  status: "terminated",
                  terminatedAt: now,
                },
              }
        );
      }
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
      await captureServerGameEvent({
        db,
        turn: currentTurn,
        event: "diplomacy_resolved",
        distinctId: "system:turn-processor",
        insertId: `diplomacy_resolved:${item._id}:${currentTurn}`,
        nationId: item.proposingCountryId,
        properties: {
          proposal_id: item._id.toString(),
          organization_id: item.organizationId,
          action_type: item.type,
          outcome: "rejected",
        },
      });
      // A resolution that fails leaves the pending list without explanation
      // otherwise, and under a roll-based threshold failing is ordinary. The
      // proposer is the one country guaranteed to have a page to log it on.
      if (item.proposingCountryId in COUNTRY_CONFIGS) {
        await recordOrgHistoryEvent(
          db,
          item.proposingCountryId,
          currentTurn,
          `${item.organizationId} rejected ${item.title}.`,
          { organizationId: item.organizationId, legislationId: item._id.toString() }
        );
      }
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
  const foundingContext = expired.some((row) => row.organizationId === "EU")
    ? await loadOrgFoundingContext(db)
    : {};

  let resolved = 0;
  const now = new Date();

  for (const election of expired) {
    // Electing a chair is a vote like any other, so the roll is the voting one.
    // This also keeps the quorum honest: a silent client state would otherwise
    // count toward turnout it can never supply.
    const members = await ballotVotingMembers(db, election.organizationId, "leadership_election");
    // Close-time ballots (active mode): fill a silent autonomy-active voter
    // before the tally; a candidate does not vote on its own election.
    await fillSilentBallots(
      db,
      [election],
      () => members,
      (doc) => doc.candidateCountryId,
      async (doc, vote) => upsertPendingOrganizationVote(electionsCol, doc._id, vote),
      currentTurn
    );
    const uniqueVotes = dedupeOrganizationVotes(election.votes as ProposalVoteRecord[]);
    // Only an active "yes" counts. A member who abstains or never votes withholds
    // consent exactly as a "no" does, so the denominator is the roll rather than
    // the turnout.
    let yes = 0;
    for (const v of uniqueVotes) {
      if (!members.includes(v.countryId)) continue;
      if (v.vote === "yes") yes++;
    }
    // A majority of the voting roll seats the chair. Falling short leaves the
    // seat unchanged — the org continues operating with the prior holder (or
    // vacant) until a future election decides.
    const elected = ballotPasses("leadership_election", members.length, yes);

    if (elected) {
      const orgDef = await loadOrganizationDef(db, election.organizationId, foundingContext);
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
      const orgDef = await loadOrganizationDef(db, election.organizationId, foundingContext);
      if (election.candidateCountryId in COUNTRY_CONFIGS) {
        await recordOrgHistoryEvent(
          db,
          election.candidateCountryId as CountryId,
          currentTurn,
          `${election.candidateCharacterName} was not elected ${orgDef?.leadership.title ?? "leader"} of ${election.organizationId}.`,
          { organizationId: election.organizationId, electionId: election._id.toString() }
        );
      }
    }
    resolved++;
  }
  return resolved;
}
