import { ObjectId } from "mongodb";
import type { Db, Filter } from "mongodb";
import { sendCountryGameEvent, DISCORD_COLORS } from "@/lib/discordWebhooks";
import { getPartyMap } from "@/lib/db/partyMap";
import { getSenateComposition } from "@/lib/congress/senateComposition";
import { getHouseComposition } from "@/lib/congress/houseComposition";
import { computeCongressLeadershipTally } from "@/lib/congress/governmentVoteBreakdown";
import { getGameTime } from "@/lib/time/gameTime";
import { claimStatusTransition } from "@/lib/turn/atomicClaim";
import {
  buildChamberLeadershipContext,
  isPartyEligible,
  POLICY_BY_ROLE,
  type ChamberLeadershipContext,
  type RoleEligibilityPolicy,
} from "@/lib/congress/leadership/rolePolicy";
import {
  houseElectionRoleToLeader,
  leadershipRoleLabel,
  senateElectionRoleToLeader,
} from "@/lib/congress/leadership/electionRoleMap";
import type {
  CongressLeader,
  SenateLeadershipElection,
  SenateLeadershipElectionRole,
  HouseLeadershipElection,
  HouseLeadershipElectionRole,
  SenateLeadershipNomination,
  HouseLeadershipNomination,
  SpeakerElection,
  SpeakerNomination,
  BundestagspraesidentElection,
  NpcscChairElection,
  CppccChairElection,
  ElectedOfficial,
  Character,
  LeadershipRole,
} from "@/lib/db/types";

const LEADERSHIP_ELECTION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Whether a leadership election's voting window has closed. Prefers the
 * turn-based `endsOnTurn` (drift-immune, freezes on pause); falls back to the
 * legacy `endsAt` Date for docs not yet backfilled. The Date fallback is
 * retained as a permanent safety net for legacy/un-backfilled docs.
 */
export function isLeadershipElectionClosed(
  el: { endsOnTurn?: number | null; endsAt?: Date | null },
  currentTurn: number,
  effectiveNow: Date
): boolean {
  if (typeof el.endsOnTurn === "number") return currentTurn >= el.endsOnTurn;
  return !!el.endsAt && effectiveNow.getTime() >= new Date(el.endsAt).getTime();
}

type ChamberKind = "senate" | "house";

export async function vacateCongressLeadershipRole(
  db: Db,
  leaderRole: LeadershipRole,
  now: Date
): Promise<void> {
  await db.collection<CongressLeader>("congressLeaders").updateOne(
    { role: leaderRole },
    {
      $set: {
        role: leaderRole,
        characterId: null,
        characterName: "Vacant",
        updatedAt: now,
      },
      $unset: {
        party: "",
        nominatedBy: "",
        electedAt: "",
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
}

/**
 * Checks if current leader still holds their seat. If not, vacates the position.
 */
export async function vacateLeadershipIfLostSeat(
  db: Db,
  leaderRole: LeadershipRole,
  chamber: ChamberKind
): Promise<void> {
  const leaderDoc = await db
    .collection<CongressLeader>("congressLeaders")
    .findOne({ role: leaderRole });
  if (!leaderDoc?.characterId) return;

  const officeType = chamber;
  const stillHasSeat = await db.collection<ElectedOfficial>("electedOfficials").findOne({
    officeType,
    $or: [{ characterId: leaderDoc.characterId }, { nppId: leaderDoc.characterId }],
  });

  if (stillHasSeat) return;

  const now = new Date();
  await db
    .collection<CongressLeader>("congressLeaders")
    .updateOne(
      { role: leaderRole },
      { $set: { characterId: null, characterName: "Vacant", updatedAt: now } }
    );
}

/**
 * Batch version of vacateLeadershipIfLostSeat.
 * Fetches all leader docs in one query and all seat checks in one query per
 * office type, avoiding the N+1 pattern of calling vacateLeadershipIfLostSeat
 * sequentially for multiple roles.
 */
export async function vacateLeadershipBulkIfLostSeat(
  db: Db,
  roles: Array<{ leaderRole: LeadershipRole; chamber: ChamberKind }>
): Promise<void> {
  const leaderRoleNames = roles.map((r) => r.leaderRole);

  const leaderDocs = await db
    .collection<CongressLeader>("congressLeaders")
    .find({ role: { $in: leaderRoleNames } })
    .toArray();

  const docsWithLeader = leaderDocs.filter((doc: CongressLeader) => doc.characterId);
  if (docsWithLeader.length === 0) return;

  const roleToOfficeType = new Map(roles.map((r) => [r.leaderRole, r.chamber] as const));

  // Group by officeType so we can do one electedOfficials query per office type
  const byOfficeType = new Map<string, CongressLeader[]>();
  for (const doc of docsWithLeader) {
    const officeType = roleToOfficeType.get(doc.role) ?? "senate";
    if (!byOfficeType.has(officeType)) byOfficeType.set(officeType, []);
    byOfficeType.get(officeType)!.push(doc);
  }

  const hasSeats = new Set<string>();
  await Promise.all(
    [...byOfficeType.entries()].map(async ([officeType, docs]) => {
      const orClauses = docs.flatMap((doc) =>
        doc.characterId ? [{ characterId: doc.characterId }, { nppId: doc.characterId }] : []
      );
      const seats = await db
        .collection<ElectedOfficial>("electedOfficials")
        .find({ officeType, $or: orClauses }, { projection: { characterId: 1, nppId: 1 } })
        .toArray();
      for (const seat of seats) {
        if (seat.characterId) hasSeats.add(seat.characterId.toString());
        if (seat.nppId) hasSeats.add(seat.nppId.toString());
      }
    })
  );

  const now = new Date();
  const toVacate = docsWithLeader.filter(
    (doc: CongressLeader) => !hasSeats.has(doc.characterId!.toString())
  );
  if (toVacate.length > 0) {
    await Promise.all(
      toVacate.map((doc: CongressLeader) =>
        db
          .collection<CongressLeader>("congressLeaders")
          .updateOne(
            { role: doc.role },
            { $set: { characterId: null, characterName: "Vacant", updatedAt: now } }
          )
      )
    );
  }
}

/**
 * Resolves a leadership election when voting ends.
 * Handles both cases: with candidates (declares winner) and without (vacates the role).
 */
export async function resolveLeadershipElection(
  db: Db,
  role: SenateLeadershipElectionRole | HouseLeadershipElectionRole,
  leaderRole: LeadershipRole,
  chamber: ChamberKind,
  force = false
): Promise<boolean> {
  type ChamberNomination = SenateLeadershipNomination | HouseLeadershipNomination;

  const electionCollection =
    chamber === "senate" ? "senateLeadershipElections" : "houseLeadershipElections";
  const nominationCollection =
    chamber === "senate" ? "senateLeadershipNominations" : "houseLeadershipNominations";

  const nominationFilter = {
    role,
    status: { $in: ["open", "voting"] as const },
  } as Filter<ChamberNomination>;

  const election = await db
    .collection<SenateLeadershipElection | HouseLeadershipElection>(electionCollection)
    .findOne({ _id: role });

  if (!election || election.status !== "voting") return false;
  if (!force) {
    const gameTime = await getGameTime();
    if (!isLeadershipElectionClosed(election, gameTime.currentTurn, gameTime.effectiveNow))
      return false;
  }

  const now = new Date();
  const candidacies = await db
    .collection<ChamberNomination>(nominationCollection)
    .find(nominationFilter)
    .sort({ votesFor: -1 })
    .toArray();

  // No candidates: close the election and vacate the role.
  if (candidacies.length === 0) {
    await vacateCongressLeadershipRole(db, leaderRole, now);

    await db
      .collection<SenateLeadershipElection | HouseLeadershipElection>(electionCollection)
      .updateOne({ _id: role }, { $set: { status: "closed", updatedAt: now } });
    return true;
  }

  // Has candidates: declare the winner by the seat-scoped seat-weighted
  // count (not the cached `votesFor`, which can include de-seated voters), so
  // the resolved winner matches what the leadership page displays.
  const leadershipOfficeType = chamber === "senate" ? "senate" : "house";
  const countedCandidacies = await Promise.all(
    candidacies.map(async (c) => ({
      nom: c,
      count: (await computeCongressLeadershipTally(db, leadershipOfficeType, c.votes)).votesFor,
    }))
  );
  countedCandidacies.sort(
    (a, b) => b.count - a.count || a.nom.createdAt.getTime() - b.nom.createdAt.getTime()
  );
  const winner = countedCandidacies[0]!.nom;

  await db
    .collection<ChamberNomination>(nominationCollection)
    .updateOne({ _id: winner._id }, { $set: { status: "confirmed", updatedAt: now } });

  await db.collection<ChamberNomination>(nominationCollection).updateMany(
    {
      role,
      _id: { $ne: winner._id },
      status: { $in: ["open", "voting"] },
    } as Filter<ChamberNomination>,
    {
      $set: { status: "failed", updatedAt: now },
    }
  );

  await db.collection<CongressLeader>("congressLeaders").updateOne(
    { role: leaderRole },
    {
      $set: {
        role: leaderRole,
        characterId: winner.nomineeId,
        characterName: winner.nomineeName,
        party: winner.nomineeParty,
        nominatedBy: winner.nominatedById,
        electedAt: now,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  // Mark leadership achievement
  try {
    const { markCongressLeadershipHeld } = await import("@/lib/wiki/markCongressLeadership");
    await markCongressLeadershipHeld(db, winner.nomineeId.toString(), now);
  } catch (err) {
    console.error(
      JSON.stringify({
        error: "mark_leadership_failed",
        operation: "leadership_election_resolution",
        chamber,
        role,
        timestamp: now.toISOString(),
        details: err instanceof Error ? err.message : "Unknown error",
      })
    );
  }

  // Atomically claim the close so a concurrent resolver (turn phase racing a
  // real-time action, or two containers overlapping on redeploy) cannot also
  // announce this result. Only the caller that flips voting→closed posts.
  const claimed = await claimStatusTransition(
    db,
    electionCollection,
    { _id: role, status: "voting" },
    { $set: { status: "closed", updatedAt: now } }
  );

  if (claimed) {
    const roleLabel = leadershipRoleLabel(leaderRole);
    const chamberLabel = chamber === "senate" ? "Senate" : "House";
    sendCountryGameEvent("US", {
      title: `Leadership Election Result — ${roleLabel}`,
      description: `**${winner.nomineeName}** has been elected as **${roleLabel}** in the ${chamberLabel}.`,
      color: DISCORD_COLORS.leadership,
      footer: { text: "A House Divided" },
      timestamp: now.toISOString(),
    }).catch(() => {});
  }

  return true;
}

// ─── Auto-trigger leadership elections after chamber votes ────────────────────

/**
 * Auto-nominate the incumbent into a freshly-opened leadership election,
 * provided they are a player, still hold a seat in the correct chamber,
 * and remain eligible under the role's policy.
 */
async function autoNominateIncumbent(
  db: Db,
  role: SenateLeadershipElectionRole | HouseLeadershipElectionRole,
  leaderRole: LeadershipRole,
  officeType: "house" | "senate",
  policy: RoleEligibilityPolicy,
  ctx: ChamberLeadershipContext,
  now: Date
): Promise<void> {
  const leader = await db
    .collection<CongressLeader>("congressLeaders")
    .findOne({ role: leaderRole });
  if (!leader?.characterId) return;

  const hasSeat = await db.collection<ElectedOfficial>("electedOfficials").findOne({
    officeType,
    characterId: leader.characterId,
  });
  if (!hasSeat) return;

  const char = await db
    .collection<Character>("characters")
    .findOne({ _id: leader.characterId }, { projection: { party: 1, homeState: 1 } });
  if (!char) return;

  const incumbentParty = char.party ?? leader.party ?? null;
  if (!isPartyEligible(policy, incumbentParty, ctx)) return;

  const nominationCol =
    officeType === "senate" ? "senateLeadershipNominations" : "houseLeadershipNominations";

  // Idempotent: this runs once per resolved seat, so a single general election
  // triggers it multiple times with the same game-clock `now`; a bare insert
  // produced duplicate incumbent nominations with identical createdAt (ticket
  // #959: "James W L C Polk" listed twice, 0 votes each). Upsert on the active
  // (role, nominee) so a second call is a no-op. A partial unique index on
  // {role, nomineeId} (status open/voting) is the concurrency backstop.
  await db.collection(nominationCol).updateOne(
    { role, nomineeId: leader.characterId, status: { $in: ["open", "voting"] } },
    {
      $setOnInsert: {
        _id: new ObjectId(),
        role,
        nomineeId: leader.characterId,
        nomineeName: leader.characterName,
        nomineeParty: incumbentParty ?? undefined,
        nomineeState: char.homeState ?? undefined,
        nominatedById: leader.characterId,
        nominatedByName: "Incumbent",
        status: "voting",
        votesFor: 0,
        votesAgainst: 0,
        votes: {},
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true }
  );
}

/**
 * Auto-nominate the incumbent Speaker or President Pro Tempore into a
 * freshly-opened election. Mirrors {@link autoNominateIncumbent} but writes
 * to the singleton-style collections (`speakerNominations` /
 * `senateLeadershipNominations` keyed by `role: "pro_tempore"`).
 */
async function autoNominateStandingIncumbent(
  db: Db,
  leaderRole: LeadershipRole,
  officeType: "house" | "senate",
  nominationCollection: "speakerNominations" | "senateLeadershipNominations",
  role: "current" | "pro_tempore",
  policy: RoleEligibilityPolicy,
  ctx: ChamberLeadershipContext,
  now: Date
): Promise<void> {
  const speaker = await db
    .collection<CongressLeader>("congressLeaders")
    .findOne({ role: leaderRole });
  if (!speaker?.characterId) return;

  const hasSeat = await db.collection<ElectedOfficial>("electedOfficials").findOne({
    officeType,
    characterId: speaker.characterId,
  });
  if (!hasSeat) return;

  const char = await db
    .collection<Character>("characters")
    .findOne({ _id: speaker.characterId }, { projection: { party: 1, homeState: 1 } });
  if (!char) return;

  const incumbentParty = char.party ?? speaker.party ?? null;
  if (!isPartyEligible(policy, incumbentParty, ctx)) return;

  // Idempotent for the same reason as autoNominateIncumbent (#959): dedup on the
  // active nominee (scoped by `role` for the senate pro-tempore collection, which
  // shares senateLeadershipNominations with the other senate roles).
  const roleFilter = nominationCollection === "senateLeadershipNominations" ? { role } : {};
  await db.collection(nominationCollection).updateOne(
    { ...roleFilter, nomineeId: speaker.characterId, status: { $in: ["open", "voting"] } },
    {
      $setOnInsert: {
        _id: new ObjectId(),
        ...(nominationCollection === "senateLeadershipNominations" ? { role } : {}),
        nomineeId: speaker.characterId,
        nomineeName: speaker.characterName,
        nomineeParty: incumbentParty ?? undefined,
        nomineeState: char.homeState ?? undefined,
        nominatedById: speaker.characterId,
        nominatedByName: "Incumbent",
        status: "voting",
        votesFor: 0,
        votesAgainst: 0,
        votes: {},
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true }
  );
}

/**
 * Fails active House leadership nominations whose nominee is no longer
 * eligible under that role's policy. Called when chamber composition
 * changes so stale nominations from a prior alignment don't persist into
 * the next election cycle.
 */
export async function clearIneligibleHouseLeadershipNominations(
  db: Db,
  ctx: ChamberLeadershipContext,
  now: Date
): Promise<void> {
  const roles: HouseLeadershipElectionRole[] = [
    "majority_leader",
    "minority_leader",
    "majority_whip",
    "minority_whip",
  ];
  for (const role of roles) {
    const policy = POLICY_BY_ROLE[houseElectionRoleToLeader(role)];
    if (policy.kind === "any-seated") continue; // no party can be ineligible
    const noms = await db
      .collection<HouseLeadershipNomination>("houseLeadershipNominations")
      .find({ role, status: { $in: ["open", "voting"] } })
      .toArray();
    const toFail = noms
      .filter((n) => !isPartyEligible(policy, n.nomineeParty ?? null, ctx))
      .map((n) => n._id);
    if (toFail.length > 0) {
      await db
        .collection<HouseLeadershipNomination>("houseLeadershipNominations")
        .updateMany({ _id: { $in: toFail } }, { $set: { status: "failed", updatedAt: now } });
    }
  }
}

/**
 * Called automatically when a house or senate general election resolves.
 * Opens a 24-hour leadership election window for each relevant role,
 * but only if no election for that role is already underway.
 *
 * House elections resolve → Speaker + Majority Leader + Minority Leader (House)
 * Senate elections resolve → Pro Tempore + Majority Leader + Minority Leader (Senate)
 */
/**
 * Whether the party that should hold `leaderRole` per the current chamber
 * composition (`expectedParty`) differs from who actually holds it — i.e.
 * whether a new leadership election is actually warranted. Without this,
 * `triggerLeadershipElectionsAfterChamberVote` would reopen a full
 * Speaker/Leader/Whip cycle on every incidental House seat resolution (a
 * routine one-seat special election filling a vacancy), re-electing the same
 * unopposed incumbent and spamming a "Leadership Election Result" notice for
 * an office that never actually changed hands. Mirrors the Senate branch's
 * existing `majorityChanged` check, generalized to any role/expected-party
 * pair (majority ones compare against the majority party, minority ones
 * against the minority party).
 *
 * Returns true (a new election is warranted) when there's no chamber-majority
 * data yet, when the role is currently vacant (no seated characterId), or
 * when the seated holder's party no longer matches `expectedParty`.
 */
async function hasControllingPartyChanged(
  db: Db,
  leaderRole: LeadershipRole,
  expectedParty: string | null
): Promise<boolean> {
  if (expectedParty == null) return true;
  const current = await db
    .collection<CongressLeader>("congressLeaders")
    .findOne({ role: leaderRole });
  if (!current?.characterId) return true;
  return current.party !== expectedParty;
}

export async function triggerLeadershipElectionsAfterChamberVote(
  db: Db,
  chamber: "house" | "senate",
  now: Date
): Promise<void> {
  const partyMap = await getPartyMap(db, "US");
  // Turn-based close anchor, derived the same way the resolver reads it so the
  // window is exactly DURATION turns regardless of game-clock drift.
  const currentTurn = (await getGameTime()).currentTurn;
  const endsOnTurn = currentTurn + LEADERSHIP_ELECTION_DURATION_MS / 3_600_000;

  if (chamber === "house") {
    const house = await getHouseComposition(db, partyMap);
    const endsAt = new Date(now.getTime() + LEADERSHIP_ELECTION_DURATION_MS);
    const ctx = buildChamberLeadershipContext({
      composition: house.composition,
      majorityParty: house.majorityParty,
      majorityBloc: house.majorityBloc,
    });

    // Clear any nominations whose party is no longer eligible for that role.
    await clearIneligibleHouseLeadershipNominations(db, ctx, now);

    // ── House Majority / Minority Leader + Whip ──────────────────────────────
    const houseRoles: HouseLeadershipElectionRole[] = [
      "majority_leader",
      "minority_leader",
      "majority_whip",
      "minority_whip",
    ];

    for (const role of houseRoles) {
      const leaderRole = houseElectionRoleToLeader(role);
      const policy = POLICY_BY_ROLE[leaderRole];
      const expectedParty =
        role === "majority_leader" || role === "majority_whip"
          ? house.majorityParty
          : house.minorityParty;
      if (!(await hasControllingPartyChanged(db, leaderRole, expectedParty))) continue;

      const existing = await db
        .collection<HouseLeadershipElection>("houseLeadershipElections")
        .findOne({ _id: role });
      if (existing?.status === "voting" && !isLeadershipElectionClosed(existing, currentTurn, now))
        continue;

      await db
        .collection<HouseLeadershipNomination>("houseLeadershipNominations")
        .updateMany(
          { role, status: { $in: ["open", "voting"] } },
          { $set: { status: "failed", updatedAt: now } }
        );
      await db.collection<HouseLeadershipElection>("houseLeadershipElections").updateOne(
        { _id: role },
        {
          $set: { _id: role, status: "voting", startedAt: now, endsAt, endsOnTurn, updatedAt: now },
        },
        { upsert: true }
      );
      await autoNominateIncumbent(db, role, leaderRole, "house", policy, ctx, now);
      console.log(`[Turn] House ${role} leadership election opened (ends ${endsAt.toISOString()})`);
    }

    // ── Speaker ───────────────────────────────────────────────────────────────
    const speakerPolicy = POLICY_BY_ROLE.speaker_of_the_house;
    const speakerControlChanged = await hasControllingPartyChanged(
      db,
      "speaker_of_the_house",
      house.majorityParty
    );
    const speakerExisting = speakerControlChanged
      ? await db.collection<SpeakerElection>("speakerElections").findOne({ _id: "current" })
      : null;
    if (
      speakerControlChanged &&
      !(
        speakerExisting?.status === "voting" &&
        !isLeadershipElectionClosed(speakerExisting, currentTurn, now)
      )
    ) {
      await db
        .collection<SpeakerNomination>("speakerNominations")
        .updateMany(
          { status: { $in: ["open", "voting"] } },
          { $set: { status: "failed", updatedAt: now } }
        );
      await db.collection<SpeakerElection>("speakerElections").updateOne(
        { _id: "current" },
        {
          $set: {
            _id: "current",
            status: "voting",
            startedAt: now,
            endsAt,
            endsOnTurn,
            updatedAt: now,
          },
        },
        { upsert: true }
      );
      await autoNominateStandingIncumbent(
        db,
        "speaker_of_the_house",
        "house",
        "speakerNominations",
        "current",
        speakerPolicy,
        ctx,
        now
      );
      console.log(`[Turn] Speaker election opened (ends ${endsAt.toISOString()})`);
    }
  } else {
    // ── Senate Pro Tempore / Majority / Minority Leader / Whip ────────────────
    const senate = await getSenateComposition(db, partyMap);
    const endsAt = new Date(now.getTime() + LEADERSHIP_ELECTION_DURATION_MS);
    const ctx = buildChamberLeadershipContext({
      composition: senate.composition,
      majorityParty: senate.majorityParty,
      majorityBloc: senate.majorityBloc,
    });

    // Reopen each Senate leadership role on the SAME rule the House loop uses:
    // whether the party that should hold it (per current composition) differs
    // from who actually holds it (`hasControllingPartyChanged`). The old gate
    // keyed on `senateClass === 1`, so on class-2/3 cycles with the majority
    // unchanged NO Senate leadership elections opened at all — Pro Tem, Minority
    // Leader and both Whips stayed frozen for two of every three election cycles
    // (ticket #974: "nothing started in senate"). The in-flight guard below still
    // prevents reopening a live window, so this is idempotent across the multiple
    // per-seat trigger calls a general election makes.
    const senateRoles: {
      role: SenateLeadershipElectionRole;
      autoNominateStanding?: boolean;
    }[] = [
      { role: "pro_tempore", autoNominateStanding: true },
      { role: "majority_leader" },
      { role: "minority_leader" },
      { role: "majority_whip" },
      { role: "minority_whip" },
    ];

    for (const { role, autoNominateStanding } of senateRoles) {
      const leaderRole = senateElectionRoleToLeader(role);
      // Pro Tempore + the majority roles are majority-party held; the minority
      // roles are minority-party held. Compare each against the expected party.
      const expectedParty =
        role === "minority_leader" || role === "minority_whip"
          ? senate.minorityParty
          : senate.majorityParty;
      if (!(await hasControllingPartyChanged(db, leaderRole, expectedParty))) continue;

      const policy = POLICY_BY_ROLE[leaderRole];
      const existing = await db
        .collection<SenateLeadershipElection>("senateLeadershipElections")
        .findOne({ _id: role });
      if (existing?.status === "voting" && !isLeadershipElectionClosed(existing, currentTurn, now))
        continue;

      await db
        .collection<SenateLeadershipNomination>("senateLeadershipNominations")
        .updateMany(
          { role, status: { $in: ["open", "voting"] } },
          { $set: { status: "failed", updatedAt: now } }
        );
      await db.collection<SenateLeadershipElection>("senateLeadershipElections").updateOne(
        { _id: role },
        {
          $set: { _id: role, status: "voting", startedAt: now, endsAt, endsOnTurn, updatedAt: now },
        },
        { upsert: true }
      );
      if (autoNominateStanding) {
        await autoNominateStandingIncumbent(
          db,
          "president_pro_tempore",
          "senate",
          "senateLeadershipNominations",
          "pro_tempore",
          policy,
          ctx,
          now
        );
      } else {
        await autoNominateIncumbent(db, role, leaderRole, "senate", policy, ctx, now);
      }
      console.log(
        `[Turn] Senate ${role} leadership election opened (ends ${endsAt.toISOString()})`
      );
    }
  }
}

/**
 * Auto-resolve any leadership elections whose voting window has expired.
 * Called each turn from turnSystem.ts — mirrors the admin "force_end" flow.
 *
 * Uses the game clock so the endsAt comparison matches turn-based resolution
 * even when real wall-time has drifted ahead of the last successful turn.
 */
export async function resolveExpiredLeadershipElections(db: Db): Promise<void> {
  const gameTime = await getGameTime();
  const now = gameTime.effectiveNow;
  const currentTurn = gameTime.currentTurn;

  // House leadership (leaders + whips)
  const houseRoleToLeader: Record<HouseLeadershipElectionRole, LeadershipRole> = {
    majority_leader: "majority_leader_house",
    minority_leader: "minority_leader_house",
    majority_whip: "majority_whip_house",
    minority_whip: "minority_whip_house",
  };
  for (const role of Object.keys(houseRoleToLeader) as HouseLeadershipElectionRole[]) {
    const el = await db
      .collection<HouseLeadershipElection>("houseLeadershipElections")
      .findOne({ _id: role });
    if (el?.status === "voting" && isLeadershipElectionClosed(el, currentTurn, now)) {
      await resolveLeadershipElection(db, role, houseRoleToLeader[role], "house", true);
      console.log(`[Turn] Auto-resolved house ${role} leadership election`);
    }
  }

  // Senate leadership (pro tempore + leaders + whips)
  const senateRoleToLeader: Record<SenateLeadershipElectionRole, LeadershipRole> = {
    pro_tempore: "president_pro_tempore",
    majority_leader: "majority_leader_senate",
    minority_leader: "minority_leader_senate",
    majority_whip: "majority_whip_senate",
    minority_whip: "minority_whip_senate",
  };
  for (const role of Object.keys(senateRoleToLeader) as SenateLeadershipElectionRole[]) {
    const el = await db
      .collection<SenateLeadershipElection>("senateLeadershipElections")
      .findOne({ _id: role });
    if (el?.status === "voting" && isLeadershipElectionClosed(el, currentTurn, now)) {
      await resolveLeadershipElection(db, role, senateRoleToLeader[role], "senate", true);
      console.log(`[Turn] Auto-resolved senate ${role} leadership election`);
    }
  }

  // Speaker (US House)
  const speakerEl = await db
    .collection<SpeakerElection>("speakerElections")
    .findOne({ _id: "current" });
  if (speakerEl?.status === "voting" && isLeadershipElectionClosed(speakerEl, currentTurn, now)) {
    const { resolveSpeakerElection } =
      await import("@/lib/congress/speaker/resolveSpeakerElection");
    const partyMap = await getPartyMap(db, "US");
    await resolveSpeakerElection(db, partyMap, true);
    console.log(`[Turn] Auto-resolved Speaker election`);
  }

  // Bundestagspräsident (DE) — same auto-resolve pattern. Imported lazily
  // to keep the per-turn resolution path lean when no DE election is open.
  const bundestagspraesidentEl = await db
    .collection<BundestagspraesidentElection>("bundestagspraesidentElections")
    .findOne({ _id: "current" });
  if (
    bundestagspraesidentEl?.status === "voting" &&
    isLeadershipElectionClosed(bundestagspraesidentEl, currentTurn, now)
  ) {
    const { resolveBundestagspraesidentElection } =
      await import("@/lib/congress/bundestagspraesident/resolveElection");
    const partyMap = await getPartyMap(db, "DE");
    await resolveBundestagspraesidentElection(db, partyMap, true);
    console.log(`[Turn] Auto-resolved Bundestagspräsident election`);
  }

  // NPC Standing Committee Chairman (CN) — same auto-resolve pattern. Imported
  // lazily to keep the per-turn resolution path lean when no CN election is open.
  const npcscChairEl = await db
    .collection<NpcscChairElection>("npcscChairElections")
    .findOne({ _id: "current" });
  if (
    npcscChairEl?.status === "voting" &&
    isLeadershipElectionClosed(npcscChairEl, currentTurn, now)
  ) {
    const { resolveNpcscChairElection } = await import("@/lib/congress/npcscChair/resolveElection");
    const partyMap = await getPartyMap(db, "CN");
    await resolveNpcscChairElection(db, partyMap, true);
    console.log(`[Turn] Auto-resolved NPC Standing Committee Chairman election`);
  }

  // CPPCC Chairman (CN) — same auto-resolve pattern.
  const cppccChairEl = await db
    .collection<CppccChairElection>("cppccChairElections")
    .findOne({ _id: "current" });
  if (
    cppccChairEl?.status === "voting" &&
    isLeadershipElectionClosed(cppccChairEl, currentTurn, now)
  ) {
    const { resolveCppccChairElection } = await import("@/lib/congress/cppccChair/resolveElection");
    const partyMap = await getPartyMap(db, "CN");
    await resolveCppccChairElection(db, partyMap, true);
    console.log(`[Turn] Auto-resolved CPPCC Chairman election`);
  }
}

/**
 * Vacate all Congress leadership positions for leaders who no longer hold
 * the correct seat (lost re-election, changed chambers, elected to Governor/State Senate).
 * Called after general elections resolve to ensure leadership is cleared immediately.
 */
export async function vacateLeadershipAfterElections(db: Db): Promise<number> {
  const now = new Date();

  // All leadership roles and their required chamber. `bundestag` covers the
  // DE Bundestagspräsident — same shape as house/senate (one chamber → one
  // officeType → one membership set).
  const leadershipRoles: Array<{
    role: LeadershipRole;
    chamber: "house" | "senate" | "bundestag" | "npcDelegate";
  }> = [
    { role: "speaker_of_the_house", chamber: "house" },
    { role: "majority_leader_house", chamber: "house" },
    { role: "minority_leader_house", chamber: "house" },
    { role: "majority_whip_house", chamber: "house" },
    { role: "minority_whip_house", chamber: "house" },
    { role: "president_pro_tempore", chamber: "senate" },
    { role: "majority_leader_senate", chamber: "senate" },
    { role: "minority_leader_senate", chamber: "senate" },
    { role: "majority_whip_senate", chamber: "senate" },
    { role: "minority_whip_senate", chamber: "senate" },
    { role: "speaker_of_the_bundestag", chamber: "bundestag" },
    { role: "chair_npcsc", chamber: "npcDelegate" },
    { role: "chair_cppcc", chamber: "npcDelegate" },
  ];

  // Fetch all current leaders
  const leaderDocs = await db
    .collection<CongressLeader>("congressLeaders")
    .find({ role: { $in: leadershipRoles.map((r) => r.role) } })
    .toArray();

  const leaderRoleToDoc = new Map(leaderDocs.map((d) => [d.role, d]));

  // Fetch all current officials across every relevant chamber.
  const allOfficials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({ officeType: { $in: ["house", "senate", "bundestag", "npcDelegate"] } })
    .toArray();

  // Build sets of character IDs who currently hold each chamber seat
  const houseCharacterIds = new Set<string>();
  const senateCharacterIds = new Set<string>();
  const bundestagCharacterIds = new Set<string>();
  const npcDelegateCharacterIds = new Set<string>();

  for (const official of allOfficials) {
    const charId = official.characterId?.toString() ?? official.nppId?.toString();
    if (!charId) continue;

    if (official.officeType === "house") {
      houseCharacterIds.add(charId);
    } else if (official.officeType === "senate") {
      senateCharacterIds.add(charId);
    } else if (official.officeType === "bundestag") {
      bundestagCharacterIds.add(charId);
    } else if (official.officeType === "npcDelegate") {
      npcDelegateCharacterIds.add(charId);
    }
  }

  let vacated = 0;

  for (const { role, chamber } of leadershipRoles) {
    const leaderDoc = leaderRoleToDoc.get(role);
    if (!leaderDoc?.characterId) continue;

    const charId = leaderDoc.characterId.toString();
    const requiredSet =
      chamber === "house"
        ? houseCharacterIds
        : chamber === "senate"
          ? senateCharacterIds
          : chamber === "bundestag"
            ? bundestagCharacterIds
            : npcDelegateCharacterIds;

    if (!requiredSet.has(charId)) {
      // Leader no longer holds the required seat — vacate
      await db.collection<CongressLeader>("congressLeaders").updateOne(
        { role },
        {
          $set: {
            characterId: null,
            characterName: "Vacant",
            updatedAt: now,
          },
        }
      );
      console.log(
        `[Turn] Vacated ${role}: ${leaderDoc.characterName} no longer holds a ${chamber} seat`
      );
      vacated++;
    }
  }

  return vacated;
}
