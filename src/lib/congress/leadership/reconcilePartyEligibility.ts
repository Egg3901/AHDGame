/**
 * Party-eligibility reconciliation for the majority-gated Congress leadership
 * offices.
 *
 * Pro Tempore, Majority Leader and Majority Whip are `largest-single-party`
 * roles: the chamber's biggest party runs for them, votes on them, and holds
 * them.
 *
 * Three pieces live here.
 *
 * `vacateRolesLostToPartySwitch` is the front door for a party switch: it gives
 * up only the offices the switch actually disqualifies the holder from, so an
 * `any-seated` office such as the Speaker survives one. `vacateAllLeadershipRoles`
 * is its no-questions sibling, for a ban.
 *
 * `openElectionsForVacatedRoles` is the one that does the day-to-day work.
 * `cleanupPartyPositionsOnSwitch` has always vacated these seats on a party
 * switch, but it stopped there, so the chair read "Vacant" until an admin
 * hand-started a race. This opens that race at the vacancy transition — the same
 * shape as `vacateSpeakerIfLostSeat` → `openSpeakerElection`.
 *
 * `reconcileLeadershipPartyEligibility` is the backstop for the paths that
 * mutate `characters.party` WITHOUT going through that cleanup — the admin heal
 * and bulk-edit routes write the field directly. It vacates a holder whose live
 * party no longer satisfies the policy, then hands the seat to the same opener
 * above so both routes into a vacancy behave identically.
 *
 * Neither one polls for empty seats, and that is deliberate: a race nobody
 * enters resolves by vacating the role and closing, so a poller would read that
 * as a fresh vacancy and re-open forever.
 *
 * The reconciler stays majority-only, because `largest-single-party` is the one
 * policy a direct `characters.party` write can silently break. The opener does
 * not: it covers every US congressional role, Speaker and minority seats
 * included, since a vacated seat with no race never refills itself.
 */
import type { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import { sendCountryGameEvent, DISCORD_COLORS } from "@/lib/discordWebhooks";
import { getPartyMap } from "@/lib/db/partyMap";
import { getSenateComposition } from "@/lib/congress/senateComposition";
import { getHouseComposition } from "@/lib/congress/houseComposition";
import { vacateCongressLeadershipRole } from "@/lib/congress/leadershipElections";
import {
  isPartyEligible,
  qualifiesAfterPartySwitch,
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
import { openSpeakerElection } from "@/lib/congress/speaker/openSpeakerElection";
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
  // GETs, right beside `vacateLeadershipForLostSeats`, which is batched for
  // exactly this reason.
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
    //
    // A row with no recorded party gives no baseline at all, so it falls out
    // here too. Both skips stay silent on purpose: this runs on a public GET and
    // the condition persists across every page load, so logging it would spam.
    // `scripts/debug/heal-ineligible-majority-leadership.ts` reports these on
    // demand instead.
    const qualifiedUnder = leader.party ?? null;
    if (qualifiedUnder === null) continue;
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
    await openElectionsForVacatedRoles(
      db,
      vacated.map((v) => ({ leaderRole: v.leaderRole, formerHolderName: v.characterName })),
      chamber === "senate" ? { senate: ctx, house: null } : { senate: null, house: ctx },
      now
    );
  }

  return vacated;
}

/**
 * Every US chamber role with a per-role election doc, majority-gated or not.
 * The minority seats are vacated by the same paths as the rest, so they need
 * the same follow-up race; only the reconciler above is majority-only.
 */
const CHAMBER_ELECTION_ROLES: Record<
  "house" | "senate",
  Array<{ leaderRole: LeadershipRole; role: ChamberElectionRole }>
> = {
  senate: [
    ...MAJORITY_GATED_ROLES.senate,
    { leaderRole: "minority_leader_senate", role: "minority_leader" },
    { leaderRole: "minority_whip_senate", role: "minority_whip" },
  ],
  house: [
    ...MAJORITY_GATED_ROLES.house,
    { leaderRole: "minority_leader_house", role: "minority_leader" },
    { leaderRole: "minority_whip_house", role: "minority_whip" },
  ],
};

const LEADER_ROLE_TO_CHAMBER = new Map(
  (["house", "senate"] as const).flatMap((chamber) =>
    CHAMBER_ELECTION_ROLES[chamber].map(
      ({ leaderRole, role }) => [leaderRole, { chamber, role }] as const
    )
  )
);

/**
 * Roles whose race lives in its own singleton collection rather than under a
 * `ChamberElectionRole` key, mapped to the chamber whose composition gates them.
 */
const SINGLETON_ELECTION_ROLES = new Map<LeadershipRole, "house" | "senate">([
  ["speaker_of_the_house", "house"],
]);

/** The chamber a role's race is gated by, or null if this module cannot run it. */
function chamberForLeaderRole(leaderRole: LeadershipRole): "house" | "senate" | null {
  return (
    LEADER_ROLE_TO_CHAMBER.get(leaderRole)?.chamber ??
    SINGLETON_ELECTION_ROLES.get(leaderRole) ??
    null
  );
}

/**
 * Why a chair was emptied. It only steers the wording of the feed notice, but
 * getting it wrong publishes a false claim about a player: a ban is not a party
 * change, and saying so in the feed would invent one.
 */
export type VacancyReason = "party-change" | "removal";

/** The feed notice for a vacancy, in the wording its reason earns. */
function vacancyNotice(
  reason: VacancyReason,
  label: string,
  formerHolderName: string | undefined
): string {
  const tail = "The office is vacant and a 24 turn election has opened.";
  if (reason === "removal") {
    return formerHolderName
      ? `**${formerHolderName}** no longer holds **${label}**. ${tail}`
      : `**${label}** is vacant. A 24 turn election has opened.`;
  }
  return formerHolderName
    ? `**${formerHolderName}** has changed party and no longer qualifies to hold **${label}**. ${tail}`
    : `**${label}** is vacant after a party change. A 24 turn election has opened.`;
}

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
 * Open a 24-turn race for each US congressional role in `vacatedRoles`.
 *
 * Called at the moment a party switch empties the chair, mirroring
 * `vacateSpeakerIfLostSeat` → `openSpeakerElection`. Every role this module can
 * open a race for belongs here, because a role that is vacated without one sits
 * empty indefinitely: the Speaker's own auto-open early-returns the instant
 * `characterId` is already null, so whichever path empties the chair first
 * suppresses it for good. Roles whose race is run by another module (the DE and
 * CN chairs) are ignored.
 *
 * This deliberately fires on the vacancy *transition* rather than polling for
 * empty seats. A poller would re-open forever: a race nobody enters resolves by
 * vacating the role and closing, which would look like a fresh vacancy on the
 * next pass.
 *
 * @returns the leader roles an election was actually opened for.
 */
export async function openElectionsForVacatedRoles(
  db: Db,
  vacatedRoles: readonly VacatedRole[],
  contexts: ChamberContexts,
  now: Date,
  reason: VacancyReason = "party-change"
): Promise<LeadershipRole[]> {
  const opened: LeadershipRole[] = [];

  for (const { leaderRole, formerHolderName } of vacatedRoles) {
    const chamber = chamberForLeaderRole(leaderRole);
    if (!chamber) continue;

    const ctx = contexts[chamber];
    // Same guard as the reconciler: with no majority party the chamber has no
    // seated members at all, so opening a race would just time out into a
    // vacancy.
    if (!ctx || ctx.majorityParty === null) continue;

    const target = LEADER_ROLE_TO_CHAMBER.get(leaderRole);
    const didOpen = target
      ? await openCongressLeadershipElection(db, {
          role: target.role,
          chamber,
          ctx,
          now,
          // The seat was just emptied; there is no incumbent to seed.
          skipIncumbentNomination: true,
        })
      : // The Speaker's race is a singleton doc in its own collection, and its
        // opener already seeds no incumbent for an empty chair.
        await openSpeakerElection(db, now);
    // A race was already running for this seat — leave it be, and do not
    // announce a second time.
    if (!didOpen) continue;

    opened.push(leaderRole);
    const label = leadershipRoleLabel(leaderRole);
    console.log(`[Leadership] ${leaderRole} vacated (${reason}); 24-turn election opened`);
    sendCountryGameEvent("US", {
      title: `Leadership Vacancy — ${label}`,
      description: vacancyNotice(reason, label, formerHolderName),
      color: DISCORD_COLORS.leadership,
      footer: { text: "A House Divided" },
      timestamp: now.toISOString(),
    }).catch(() => {});
  }

  return opened;
}

/**
 * Chamber contexts for `roles`, degrading to none rather than throwing. Callers
 * use the empty result to fall back to vacating every party-gated role, which
 * is what these paths did before there was an eligibility gate: an ineligible
 * holder keeping the office is the worse of the two failures.
 */
async function buildContextsSafely(
  db: Db,
  roles: readonly HeldLeadershipRole[]
): Promise<ChamberContexts> {
  try {
    return await buildContextsForRoles(db, roles);
  } catch (err) {
    console.error(
      JSON.stringify({
        error: "leadership_context_unavailable",
        operation: "vacate_leadership_roles",
        details: err instanceof Error ? err.message : "Unknown error",
      })
    );
    return { house: null, senate: null };
  }
}

/** A leadership role the switching character holds right now. */
export interface HeldLeadershipRole {
  leaderRole: LeadershipRole;
  /** The seated holder, so the vacate can be scoped to them. */
  holderId: ObjectId;
  /** Read BEFORE the vacate, so the feed notice can still name them. */
  formerHolderName?: string;
}

/**
 * Give up the leadership roles a character's party switch has actually cost
 * them, and open a race for each one emptied.
 *
 * The gate is the role's own eligibility policy, not the fact of the switch:
 * `any-seated` offices (the Speaker above all) are held on the strength of a
 * seat, so their holder keeps them and no race is needed. Vacating those
 * regardless is what left the House with an empty chair and no election — the
 * Speaker's own auto-open cannot recover it, because it early-returns once
 * `characterId` is already null.
 *
 * `newParty` comes from the caller's argument rather than `characters.party`,
 * so the decision does not depend on whether the switch has been written yet
 * (`performRelocation` deliberately cleans up first — see its comment at the
 * `cleanupPartyPositionsOnSwitch` call).
 *
 * A composition read that fails degrades to vacating every party-gated role,
 * which is what this path did before the gate existed: an ineligible holder
 * keeping the office is the worse of the two failures.
 *
 * @returns the roles actually vacated.
 */
export async function vacateRolesLostToPartySwitch(
  db: Db,
  heldRoles: readonly HeldLeadershipRole[],
  newParty: string,
  now: Date
): Promise<LeadershipRole[]> {
  if (heldRoles.length === 0) return [];

  const contexts = await buildContextsSafely(db, heldRoles);

  // The holder sits in the chamber, so the party they are joining has a seat in
  // it by definition. Saying so explicitly is what makes the answer the same
  // whichever caller this is: the party `leave` route relabels the seat row
  // before running the cleanup, while `performRelocation` deliberately runs the
  // cleanup first (see its comment at the call site), so the composition read
  // here may or may not have caught up yet. Only the gate sees this; the opener
  // still gets the real composition.
  const withHolderSeat = (ctx: ChamberLeadershipContext | null) =>
    ctx ? { ...ctx, allChamberPartySlugs: new Set([...ctx.allChamberPartySlugs, newParty]) } : null;

  const lost = heldRoles.filter(({ leaderRole }) => {
    const chamber = chamberForLeaderRole(leaderRole);
    const ctx = chamber ? withHolderSeat(contexts[chamber]) : null;
    return !qualifiesAfterPartySwitch(POLICY_BY_ROLE[leaderRole], newParty, ctx);
  });

  return vacateAllLeadershipRoles(db, lost, now, { contexts, reason: "party-change" });
}

/** Options for {@link vacateAllLeadershipRoles}. */
export interface VacateAllOptions {
  /** Contexts already built by the caller, so they are not read twice. */
  contexts?: ChamberContexts;
  /** Defaults to "removal": the reason a caller with no party question has. */
  reason?: VacancyReason;
}

/**
 * Empty every one of `heldRoles` and open a race for each, with no eligibility
 * question asked.
 *
 * For the removals where the holder's standing is not in doubt because they are
 * gone: a ban, which is not a party switch and must reach the `any-seated`
 * offices a switch deliberately leaves alone.
 *
 * @returns the roles actually vacated — fewer than asked for when another
 * request claimed the same vacancy first.
 */
export async function vacateAllLeadershipRoles(
  db: Db,
  heldRoles: readonly HeldLeadershipRole[],
  now: Date,
  { contexts: knownContexts, reason = "removal" }: VacateAllOptions = {}
): Promise<LeadershipRole[]> {
  if (heldRoles.length === 0) return [];
  const contexts = knownContexts ?? (await buildContextsSafely(db, heldRoles));

  // Scoped to the holder so two overlapping requests cannot both claim the same
  // vacancy and both open a race.
  const claimed = await Promise.all(
    heldRoles.map(async (role) => ({
      role,
      won: await vacateCongressLeadershipRole(db, role.leaderRole, now, role.holderId),
    }))
  );
  const vacated = claimed.filter((c) => c.won).map((c) => c.role);
  if (vacated.length === 0) return [];

  await openElectionsForVacatedRoles(db, vacated, contexts, now, reason);
  return vacated.map((r) => r.leaderRole);
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
      const chamber = chamberForLeaderRole(r.leaderRole);
      return chamber ? [chamber] : [];
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
