/**
 * Autonomous international-organization voting (SP4).
 *
 * Org membership proposals and free-trade agreements resolve by UNANIMOUS "yes"
 * from the eligible member/party set; leadership elections by simple majority.
 * A vote is cast by a country's trade minister (a player). In a disabled/
 * econ-only country there is no player to cast it, so the country never votes —
 * and because no-vote counts as non-approval, a single autonomous member
 * silently vetoes EVERY membership proposal and FTA it is eligible to vote on,
 * forever. This is the intl-org analogue of the SP1–SP3 `userId`-filter stalls.
 *
 * This casts a cooperative "yes" on behalf of each autonomy-active country that
 * is an eligible voter and has not already voted, so autonomous members
 * participate instead of obstructing. Runs before the resolvers each turn.
 *
 * Safety rail: only autonomy-active countries (autonomy enabled AND NOT
 * player-enabled) ever get an auto-cast vote. Player-enabled members are never
 * voted for — their trade minister still decides.
 *
 * Out of scope (deferred): autonomously *initiating* membership applications,
 * FTAs, or leadership candidacies. Voting closes the stall; proposing is a
 * separate, lower-value behavior with open design questions (what would a
 * disabled country choose to join?).
 */

import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { NPP, NppForeignPolicyMode } from "@/lib/db/types";
import type { ProposalVoteRecord } from "@/lib/db/types/internationalOrganization";
import {
  getOrganizationLeadershipElectionsCollection,
  getOrganizationLegislationCollection,
  getOrganizationProposalsCollection,
} from "@/lib/db/collections";
import { getMembers } from "@/lib/internationalOrganizations/service";
import { upsertPendingOrganizationVote } from "@/lib/internationalOrganizations/voteWrite";
import { isNppAutonomyActive } from "./featureFlag";

/** Per-turn caches so we don't re-query autonomy state, members, or voter
 *  identity for the same country/org across multiple pending items. */
interface VotingCaches {
  autonomyByCountry: Map<string, boolean>;
  membersByOrg: Map<string, CountryId[]>;
  voterByCountry: Map<string, { characterId: ObjectId; characterName: string }>;
}

async function isAutonomyActiveCached(
  db: Db,
  caches: VotingCaches,
  countryId: CountryId
): Promise<boolean> {
  const key = String(countryId);
  const cached = caches.autonomyByCountry.get(key);
  if (cached !== undefined) return cached;
  const active = await isNppAutonomyActive(db, countryId);
  caches.autonomyByCountry.set(key, active);
  return active;
}

async function getMembersCached(
  db: Db,
  caches: VotingCaches,
  organizationId: string
): Promise<CountryId[]> {
  const cached = caches.membersByOrg.get(organizationId);
  if (cached !== undefined) return cached;
  // Autonomous voting speaks for countries the game models; a macro-tier member
  // has no government to cast a ballot on behalf of.
  const members = (await getMembers(db, organizationId as Parameters<typeof getMembers>[1])).filter(
    (id): id is CountryId => id in COUNTRY_CONFIGS
  );
  caches.membersByOrg.set(organizationId, members);
  return members;
}

/**
 * Resolve the "who voted" identity for an autonomous country: a representative
 * non-technocrat NPP. Falls back to a synthetic government identity if the
 * country has no NPP (keeps the vote landing rather than re-stalling the org).
 */
async function getVoterIdentityCached(
  db: Db,
  caches: VotingCaches,
  countryId: CountryId
): Promise<{ characterId: ObjectId; characterName: string }> {
  const key = String(countryId);
  const cached = caches.voterByCountry.get(key);
  if (cached) return cached;

  const npp = await db
    .collection<NPP>("npps")
    .findOne(
      { countryId, retiredAt: null, isTechnocrat: { $ne: true } },
      { projection: { _id: 1, name: 1 } }
    );
  const identity = npp
    ? { characterId: npp._id, characterName: npp.name }
    : {
        characterId: new ObjectId(),
        characterName: `${COUNTRY_CONFIGS[countryId]?.name ?? countryId} Government`,
      };
  caches.voterByCountry.set(key, identity);
  return identity;
}

function alreadyVoted(votes: ProposalVoteRecord[] | undefined, countryId: CountryId): boolean {
  return (votes ?? []).some((v) => v.countryId === countryId);
}

/**
 * Cast cooperative autonomous "yes" votes on all pending org items for
 * autonomy-active eligible voters. Returns the number of votes cast.
 */
export async function castAutonomousOrgVotes(db: Db, currentTurn: number): Promise<number> {
  const rollout = await db
    .collection<{ _id: string; nppForeignPolicyMode?: NppForeignPolicyMode }>("gameState")
    .findOne({ _id: "current" }, { projection: { nppForeignPolicyMode: 1 } });
  if (rollout?.nppForeignPolicyMode === "active") {
    // The opinion-driven planner owns autonomous ballots in active mode. Keep
    // the legacy cooperative voter only as the shadow-mode comparison baseline.
    return 0;
  }

  const caches: VotingCaches = {
    autonomyByCountry: new Map(),
    membersByOrg: new Map(),
    voterByCountry: new Map(),
  };
  const now = new Date();
  let votesCast = 0;

  const buildVote = async (countryId: CountryId): Promise<ProposalVoteRecord> => {
    const identity = await getVoterIdentityCached(db, caches, countryId);
    return {
      countryId,
      characterId: identity.characterId,
      characterName: identity.characterName,
      vote: "yes",
      castAt: now,
      castOnTurn: currentTurn,
    };
  };

  // ── 1. Membership proposals — eligible voters = members minus applicant ─────
  const proposalsCol = await getOrganizationProposalsCollection(db);
  const pendingProposals = await proposalsCol.find({ status: "pending" }).toArray();
  for (const proposal of pendingProposals) {
    const members = await getMembersCached(db, caches, proposal.organizationId);
    for (const member of members) {
      if (member === proposal.proposingCountryId) continue;
      if (alreadyVoted(proposal.votes as ProposalVoteRecord[], member)) continue;
      if (!(await isAutonomyActiveCached(db, caches, member))) continue;
      const res = await upsertPendingOrganizationVote(
        proposalsCol,
        proposal._id,
        await buildVote(member)
      );
      if (res.matchedCount > 0) votesCast++;
    }
  }

  // ── 2. FTA legislation — eligible voters = named parties ────────────────────
  const legislationCol = await getOrganizationLegislationCollection(db);
  const pendingLegislation = await legislationCol.find({ status: "pending" }).toArray();
  for (const item of pendingLegislation) {
    for (const party of item.parties as CountryId[]) {
      if (alreadyVoted(item.votes as ProposalVoteRecord[], party)) continue;
      if (!(await isAutonomyActiveCached(db, caches, party))) continue;
      const res = await upsertPendingOrganizationVote(
        legislationCol,
        item._id,
        await buildVote(party)
      );
      if (res.matchedCount > 0) votesCast++;
    }
  }

  // ── 3. Leadership elections — eligible voters = current members ─────────────
  const electionsCol = await getOrganizationLeadershipElectionsCollection(db);
  const pendingElections = await electionsCol.find({ status: "pending" }).toArray();
  for (const election of pendingElections) {
    const members = await getMembersCached(db, caches, election.organizationId);
    for (const member of members) {
      if (alreadyVoted(election.votes as ProposalVoteRecord[], member)) continue;
      if (!(await isAutonomyActiveCached(db, caches, member))) continue;
      const res = await upsertPendingOrganizationVote(
        electionsCol,
        election._id,
        await buildVote(member)
      );
      if (res.matchedCount > 0) votesCast++;
    }
  }

  if (votesCast > 0) {
    console.log(
      `[nppAutonomy] cast ${votesCast} autonomous intl-org vote(s) on turn ${currentTurn}`
    );
  }
  return votesCast;
}
