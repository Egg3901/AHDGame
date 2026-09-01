/**
 * Party-eligibility reconciliation for the majority-gated Congress leadership
 * offices.
 *
 * Pro Tempore, Majority Leader and Majority Whip are `largest-single-party`
 * roles: the chamber's biggest party runs for them, votes on them, and holds
 * them. Nothing enforced the *holding* half — a member elected as Majority
 * Leader could cross the aisle or go independent and keep the gavel
 * indefinitely, because the only sweep that ever vacated leadership
 * (`vacateLeadershipBulkIfLostSeat`) checks for a lost seat, not a lost party.
 *
 * This module closes that gap: a holder whose live party no longer satisfies
 * their role's policy is vacated and the seat goes straight to a fresh 24-turn
 * election.
 *
 * Deliberately NOT extended to the minority roles or the Speaker — see the
 * scope decision recorded on the branch. The minority roles are `non-coalition`
 * and the Speaker is `any-seated`, so both need their own rules.
 */
import type { Db } from "@/lib/mongodb";
import { sendCountryGameEvent, DISCORD_COLORS } from "@/lib/discordWebhooks";
import { getPartyMap } from "@/lib/db/partyMap";
import { getSenateComposition } from "@/lib/congress/senateComposition";
import { getHouseComposition } from "@/lib/congress/houseComposition";
import { vacateCongressLeadershipRole } from "@/lib/congress/leadershipElections";
import {
  isPartyEligible,
  POLICY_BY_ROLE,
  buildChamberLeadershipContext,
  type ChamberLeadershipContext,
} from "@/lib/congress/leadership/rolePolicy";
import { leadershipRoleLabel } from "@/lib/congress/leadership/electionRoleMap";
import {
  openCongressLeadershipElection,
  resolveSeatHolderParty,
  type ChamberElectionRole,
} from "@/lib/congress/leadership/openElection";
import type { Character, CongressLeader, ElectedOfficial, LeadershipRole } from "@/lib/db/types";

/**
 * The majority-party-gated roles, per chamber, paired with the per-chamber
 * election id their race is keyed by.
 */
const MAJORITY_GATED_ROLES: Record<
  "house" | "senate",
  Array<{ leaderRole: LeadershipRole; role: ChamberElectionRole }>
> = {
  senate: [
    { leaderRole: "president_pro_tempore", role: "pro_tempore" },
    { leaderRole: "majority_leader_senate", role: "majority_leader" },
    { leaderRole: "majority_whip_senate", role: "majority_whip" },
  ],
  house: [
    { leaderRole: "majority_leader_house", role: "majority_leader" },
    { leaderRole: "majority_whip_house", role: "majority_whip" },
  ],
};

export interface LeadershipPartyVacancy {
  leaderRole: LeadershipRole;
  role: ChamberElectionRole;
  characterName: string;
  /** The party the holder had moved to, which cost them the office. */
  party: string;
}

/**
 * Vacate every majority-gated leadership role in `chamber` whose holder no
 * longer belongs to the majority party, opening a 24-turn election for each.
 *
 * Idempotent: it vacates before opening, so a repeat pass sees an empty seat
 * and returns without touching anything. That matters because this runs on the
 * congress page GETs, not only once per turn.
 *
 * @returns one entry per role vacated (empty when nothing changed).
 */
export async function reconcileLeadershipPartyEligibility(
  db: Db,
  chamber: "house" | "senate",
  ctx: ChamberLeadershipContext,
  now: Date
): Promise<LeadershipPartyVacancy[]> {
  // No composition data means no reliable majority party. Bailing out here is
  // what stops a bootstrap or a transient empty read from vacating the entire
  // leadership slate: `isPartyEligible` rejects every party when
  // `majorityParty` is null, so without this guard the sweep would fire on all
  // of them at once.
  if (ctx.majorityParty === null) return [];

  const vacated: LeadershipPartyVacancy[] = [];

  for (const { leaderRole, role } of MAJORITY_GATED_ROLES[chamber]) {
    const leader = await db
      .collection<CongressLeader>("congressLeaders")
      .findOne({ role: leaderRole });
    if (!leader?.characterId) continue;

    // A holder with no seat is the seat-loss sweep's business, not ours —
    // vacating here as well would spuriously open a party-switch election.
    const seat = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      officeType: chamber,
      $or: [{ characterId: leader.characterId }, { nppId: leader.characterId }],
    });
    if (!seat) continue;

    const char = await db
      .collection<Character>("characters")
      .findOne({ _id: leader.characterId }, { projection: { party: 1 } });

    const party = resolveSeatHolderParty(seat, char);
    if (isPartyEligible(POLICY_BY_ROLE[leaderRole], party, ctx)) continue;

    await vacateCongressLeadershipRole(db, leaderRole, now);
    await openCongressLeadershipElection(db, {
      role,
      chamber,
      ctx,
      now,
      // The holder was just vacated for being ineligible; re-seeding them onto
      // the ballot they were removed from is exactly what must not happen.
      skipIncumbentNomination: true,
    });

    const label = leadershipRoleLabel(leaderRole);
    vacated.push({
      leaderRole,
      role,
      characterName: leader.characterName,
      party: party ?? "independent",
    });
    console.log(
      `[Leadership] Vacated ${leaderRole}: ${leader.characterName} left the majority party; 24-turn election opened`
    );
    sendCountryGameEvent("US", {
      title: `Leadership Vacancy — ${label}`,
      description:
        `**${leader.characterName}** has left the majority party and no longer qualifies to hold ` +
        `**${label}**. The office is vacant and a 24 turn election has opened.`,
      color: DISCORD_COLORS.leadership,
      footer: { text: "A House Divided" },
      timestamp: now.toISOString(),
    }).catch(() => {});
  }

  return vacated;
}

/**
 * Both chambers in one call, building each chamber's composition context
 * itself. Used by the turn processor, which has no context to hand in.
 */
export async function reconcileAllLeadershipPartyEligibility(
  db: Db,
  now: Date
): Promise<LeadershipPartyVacancy[]> {
  const partyMap = await getPartyMap(db, "US");
  const [senate, house] = await Promise.all([
    getSenateComposition(db, partyMap),
    getHouseComposition(db, partyMap),
  ]);

  const senateVacancies = await reconcileLeadershipPartyEligibility(
    db,
    "senate",
    buildChamberLeadershipContext({
      composition: senate.composition,
      majorityParty: senate.majorityParty,
      majorityBloc: senate.majorityBloc,
    }),
    now
  );
  const houseVacancies = await reconcileLeadershipPartyEligibility(
    db,
    "house",
    buildChamberLeadershipContext({
      composition: house.composition,
      majorityParty: house.majorityParty,
      majorityBloc: house.majorityBloc,
    }),
    now
  );

  return [...senateVacancies, ...houseVacancies];
}
