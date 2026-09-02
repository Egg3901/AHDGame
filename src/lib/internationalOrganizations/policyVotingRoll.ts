/**
 * The policy voting roll, shared by every org ballot, and the close-time
 * ballot for autonomy-active members.
 *
 * Shadow/off preserve the player-only baseline (orgMembership.votingMembers).
 * Active mode adds modelled members that have a formed NPP government and a
 * legislature capable of resolving the consequences of their vote — those
 * governments ARE the country's executive, so their ballot counts. The UI read
 * model (service.ts hasVote) must be widened the same way, or a player watches
 * a tally that reads 2/2 while the resolver is still waiting on five more.
 *
 * The close-time ballot exists because the active-mode planner takes ONE
 * foreign-policy action per six-hour Tier-1 slot per country. A pending vote
 * competes against routine diplomacy for that slot, and a 24-turn window gives
 * each member only a handful of chances — a single busy cycle starves the vote
 * and the member "withholds consent" forever. Membership, FTAs and war entry
 * are unanimous ballots, so one silent member vetoes the bloc. Before any
 * unanimous tally closes, every autonomy-active member on the roll casts the
 * cooperative ballot the shadow-mode voter has always cast (see
 * castAutonomousOrgVotes): active mode is the same executive speaking with the
 * planner's voice instead of a fixed yes.
 */

import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { NppForeignPolicyMode } from "@/lib/db/types";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { hasBillLifecycle } from "@/lib/legislature/hasBillLifecycle";
import { getMembers } from "@/lib/internationalOrganizations/service";
import { votingMembers } from "@/lib/internationalOrganizations/orgMembership";
import { foreignPolicyModeFrom } from "@/lib/nppAutonomy/foreignPolicyRollout";

/** The foreign-policy rollout mode, read once per phase pass. */
export async function readForeignPolicyMode(db: Db): Promise<NppForeignPolicyMode> {
  const rollout = await db
    .collection<{ _id: string; nppForeignPolicyMode?: NppForeignPolicyMode }>("gameState")
    .findOne({ _id: "current" }, { projection: { nppForeignPolicyMode: 1 } });
  return foreignPolicyModeFrom(rollout?.nppForeignPolicyMode);
}

/**
 * Voting roster for policy decisions. Shadow/off preserve the player-only
 * baseline. Active mode adds modelled members that have a formed NPP government
 * and a legislature capable of resolving the consequences of their vote.
 */
export async function policyVotingMembers(
  db: Db,
  organizationId: string,
  mode?: NppForeignPolicyMode
): Promise<CountryId[]> {
  const players = await votingMembers(db, organizationId);
  const rolloutMode = mode ?? (await readForeignPolicyMode(db));
  if (rolloutMode !== "active") return players;

  const modelledMembers = (await getMembers(db, organizationId as never)).filter(
    (member): member is CountryId =>
      member in COUNTRY_CONFIGS && hasBillLifecycle(member as CountryId)
  );
  if (modelledMembers.length === 0) return players;
  const formations = await db
    .collection<GovernmentFormation>("governmentFormations")
    .find({
      _id: { $in: modelledMembers },
      status: "formed",
      $or: [{ pmNppId: { $ne: null } }, { presidentNppId: { $ne: null } }],
    })
    .toArray();
  return Array.from(new Set([...players, ...formations.map((formation) => formation.countryId)]));
}
