/**
 * Party-eligibility reconciliation for the majority-gated Congress leadership
 * offices.
 *
 * Pro Tempore, Majority Leader and Majority Whip are `largest-single-party`
 * roles: the chamber's biggest party runs for them, votes on them, and holds
 * them.
 *
 * Two pieces live here.
 *
 * `openElectionsForVacatedMajorityRoles` is the one that does the day-to-day
 * work. `cleanupPartyPositionsOnSwitch` has always vacated these seats on a
 * party switch, but it stopped there, so the chair read "Vacant" until an admin
 * hand-started a race. This opens that race at the vacancy transition — the same
 * shape as `vacateSpeakerIfLostSeat` → `openSpeakerElection`, which is why the
 * Speaker never had this problem.
 *
 * `reconcileLeadershipPartyEligibility` is the backstop for the paths that
 * mutate `characters.party` WITHOUT going through that cleanup — the admin heal
 * and bulk-edit routes. It vacates a holder whose live party no longer satisfies
 * the policy and opens the race itself.
 *
 * Neither one polls for empty seats, and that is deliberate: a race nobody
 * enters resolves by vacating the role and closing, so a poller would read that
 * as a fresh vacancy and re-open forever.
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
 * Vacate every majority-gated leadership role in `chamber` whose holder has
 * left the qualifying party, opening a 24-turn election for each.
 *
 * A backstop, not the main path: an ordinary switch is already caught by
 * `cleanupPartyPositionsOnSwitch`, which vacates the seat before this ever runs.
 * What reaches here is the admin routes that write `characters.party` directly
 * and bypass that cleanup entirely.
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

  const roles = MAJORITY_GATED_ROLES[chamber];

  // Three queries total, not three per role: this runs on the congress page
  // GETs, right beside `vacateLeadershipBulkIfLostSeat`, which exists in bulk
  // form for exactly this reason.
  const leaders = await db
    .collection<CongressLeader>("congressLeaders")
    .find({ role: { $in: roles.map((r) => r.leaderRole) } })
    .toArray();
  const holderIds = leaders.flatMap((l) => (l.characterId ? [l.characterId] : []));
  if (holderIds.length === 0) return [];

  const [seats, characters] = await Promise.all([
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find({
        officeType: chamber,
        $or: [{ characterId: { $in: holderIds } }, { nppId: { $in: holderIds } }],
      })
      .toArray(),
    db
      .collection<Character>("characters")
      .find({ _id: { $in: holderIds } }, { projection: { party: 1 } })
      .toArray(),
  ]);

  const seatByHolder = new Map<string, ElectedOfficial>();
  for (const seat of seats) {
    if (seat.characterId) seatByHolder.set(seat.characterId.toString(), seat);
    if (seat.nppId) seatByHolder.set(seat.nppId.toString(), seat);
  }
  const charByHolder = new Map(characters.map((c) => [c._id.toString(), c]));
  const leaderByRole = new Map(leaders.map((l) => [l.role, l]));

  const vacated: LeadershipPartyVacancy[] = [];

  for (const { leaderRole, role } of roles) {
    const leader = leaderByRole.get(leaderRole);
    if (!leader?.characterId) continue;
    const holderKey = leader.characterId.toString();

    // A holder with no seat is the seat-loss sweep's business, not ours —
    // vacating here as well would spuriously open a party-switch election.
    const seat = seatByHolder.get(holderKey);
    if (!seat) continue;

    const policy = POLICY_BY_ROLE[leaderRole];
    const party = resolveSeatHolderParty(seat, charByHolder.get(holderKey) ?? null);
    if (isPartyEligible(policy, party, ctx)) continue;

    // Ineligible — but for one of two very different reasons:
    //   (a) the holder walked out of the qualifying party, or
    //   (b) the chamber's majority moved out from under a holder who stayed put.
    //
    // Only (a) belongs here. Case (b) is already handled, more gently, by
    // `triggerLeadershipElectionsAfterChamberVote`: it opens a race at the next
    // chamber-changing vote and leaves the incumbent seated (and auto-nominated)
    // until it resolves. Vacating here would pre-empt that and leave the chamber
    // with no leaders for 24 turns over a shift they had no part in.
    //
    // `congressLeaders.party` is the party the holder qualified under when they
    // took the office — stamped by the resolver and by the admin assign route,
    // and deliberately never touched afterwards. If it STILL satisfies the
    // policy then the office has not moved, so the ineligibility is the holder's
    // own doing. If it does not, the majority flipped and this is case (b).
    const qualifiedUnder = leader.party ?? null;
    if (qualifiedUnder === null) {
      // No baseline to attribute the change to, and vacating an office is not a
      // coin toss. Leave it to the chamber-vote path.
      console.warn(
        `[Leadership] ${leaderRole} holder ${leader.characterName} is ineligible (${party ?? "no party"}) but the row records no qualifying party; skipping`
      );
      continue;
    }
    if (!isPartyEligible(policy, qualifiedUnder, ctx)) continue;

    // Scoped to the holder we just read, so of two overlapping page loads only
    // one opens the election and only one posts the notice.
    const claimed = await vacateCongressLeadershipRole(db, leaderRole, now, leader.characterId);
    if (!claimed) continue;

    vacated.push({
      leaderRole,
      role,
      characterName: leader.characterName,
      party: party ?? "independent",
    });
  }

  // One place opens the race and posts the notice, shared with the party-switch
  // path, so the two cannot drift in behaviour or wording.
  if (vacated.length > 0) {
    await openElectionsForVacatedMajorityRoles(
      db,
      vacated.map((v) => ({ leaderRole: v.leaderRole, formerHolderName: v.characterName })),
      chamber === "senate" ? { senate: ctx, house: null } : { senate: null, house: ctx },
      now
    );
  }

  return vacated;
}

const LEADER_ROLE_TO_CHAMBER = new Map(
  (["house", "senate"] as const).flatMap((chamber) =>
    MAJORITY_GATED_ROLES[chamber].map(
      ({ leaderRole, role }) => [leaderRole, { chamber, role }] as const
    )
  )
);

/** A role that has just been emptied, plus who was holding it. */
export interface VacatedRole {
  leaderRole: LeadershipRole;
  /** Outgoing holder, read BEFORE the vacate. Only used for the feed notice. */
  formerHolderName?: string;
}

/** Per-chamber composition contexts, or null for a chamber that is not needed. */
export interface ChamberContexts {
  house: ChamberLeadershipContext | null;
  senate: ChamberLeadershipContext | null;
}

/**
 * Open a 24-turn race for each majority-gated role in `vacatedRoles`.
 *
 * Called at the moment a party switch empties the chair, mirroring
 * `vacateSpeakerIfLostSeat` → `openSpeakerElection`: the Speaker vacates AND
 * refills itself, while these five roles only ever vacated, so the seat sat
 * empty until an admin noticed. Roles outside the majority-gated set are
 * ignored — `congressLeaders` also holds the minority roles, the Speaker, and
 * the DE/CN chairs, none of which are this module's business.
 *
 * This deliberately fires on the vacancy *transition* rather than polling for
 * empty seats. A poller would re-open forever: a race nobody enters resolves by
 * vacating the role and closing, which would look like a fresh vacancy on the
 * next pass.
 *
 * @returns the leader roles an election was actually opened for.
 */
export async function openElectionsForVacatedMajorityRoles(
  db: Db,
  vacatedRoles: readonly VacatedRole[],
  contexts: ChamberContexts,
  now: Date
): Promise<LeadershipRole[]> {
  const opened: LeadershipRole[] = [];

  for (const { leaderRole, formerHolderName } of vacatedRoles) {
    const target = LEADER_ROLE_TO_CHAMBER.get(leaderRole);
    if (!target) continue;

    const ctx = contexts[target.chamber];
    // Same guard as the reconciler: with no majority party there is nobody
    // eligible to run, so opening a race would just time out into a vacancy.
    if (!ctx || ctx.majorityParty === null) continue;

    const didOpen = await openCongressLeadershipElection(db, {
      role: target.role,
      chamber: target.chamber,
      ctx,
      now,
      // The seat was just emptied; there is no incumbent to seed.
      skipIncumbentNomination: true,
    });
    // A race was already running for this seat — leave it be, and do not
    // announce a second time.
    if (!didOpen) continue;

    opened.push(leaderRole);
    const label = leadershipRoleLabel(leaderRole);
    console.log(`[Leadership] ${leaderRole} vacated by a party change; 24-turn election opened`);
    sendCountryGameEvent("US", {
      title: `Leadership Vacancy — ${label}`,
      description: formerHolderName
        ? `**${formerHolderName}** has changed party and no longer qualifies to hold **${label}**. ` +
          `The office is vacant and a 24 turn election has opened.`
        : `**${label}** is vacant after a party change. A 24 turn election has opened.`,
      color: DISCORD_COLORS.leadership,
      footer: { text: "A House Divided" },
      timestamp: now.toISOString(),
    }).catch(() => {});
  }

  return opened;
}

/**
 * Build only the chamber contexts the given roles actually need, so a switch
 * that touches no congressional leadership costs nothing.
 */
export async function buildContextsForRoles(
  db: Db,
  roles: readonly VacatedRole[]
): Promise<ChamberContexts> {
  const needed = new Set(
    roles.flatMap((r) => {
      const target = LEADER_ROLE_TO_CHAMBER.get(r.leaderRole);
      return target ? [target.chamber] : [];
    })
  );
  if (needed.size === 0) return { house: null, senate: null };

  const partyMap = await getPartyMap(db, "US");
  const [senate, house] = await Promise.all([
    needed.has("senate") ? getSenateComposition(db, partyMap) : null,
    needed.has("house") ? getHouseComposition(db, partyMap) : null,
  ]);

  return {
    senate: senate
      ? buildChamberLeadershipContext({
          composition: senate.composition,
          majorityParty: senate.majorityParty,
          majorityBloc: senate.majorityBloc,
        })
      : null,
    house: house
      ? buildChamberLeadershipContext({
          composition: house.composition,
          majorityParty: house.majorityParty,
          majorityBloc: house.majorityBloc,
        })
      : null,
  };
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
