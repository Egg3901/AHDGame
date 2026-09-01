/**
 * Shared opener for the US Congress leadership races (House and Senate).
 *
 * Both admin `start_election` handlers used to inline this logic, and they
 * drifted: each `$set` only `endsAt`, never `endsOnTurn`. Because
 * `isLeadershipElectionClosed` PREFERS `endsOnTurn`, a stale value left on the
 * doc by the previous race survived the upsert and made the freshly opened
 * election read as already closed — it resolved on the very next GET, re-crowned
 * the auto-nominated incumbent and re-posted the victory webhook, so the button
 * appeared to do nothing. Writing both anchors in one place is what keeps them
 * from drifting apart again.
 *
 * Mirrors `speaker/openSpeakerElection.ts` and
 * `bundestagspraesident/openElection.ts`; those chambers have their own
 * singleton collections and keep their own openers.
 */
import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import { getGameTime } from "@/lib/time/gameTime";
import { isLeadershipElectionClosed } from "@/lib/congress/leadershipElections";
import {
  isPartyEligible,
  POLICY_BY_ROLE,
  type ChamberLeadershipContext,
} from "@/lib/congress/leadership/rolePolicy";
import {
  houseElectionRoleToLeader,
  senateElectionRoleToLeader,
} from "@/lib/congress/leadership/electionRoleMap";
import type {
  Character,
  CongressLeader,
  ElectedOfficial,
  HouseLeadershipElectionRole,
  SenateLeadershipElection,
  SenateLeadershipElectionRole,
  SenateLeadershipNomination,
} from "@/lib/db/types";

export const LEADERSHIP_ELECTION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours = 24 turns

export type ChamberElectionRole = SenateLeadershipElectionRole | HouseLeadershipElectionRole;

/**
 * The Senate and House election/nomination documents are identical apart from
 * the role key, so widening just that key gives one type that describes either
 * collection. Derived from the real interfaces rather than hand-written, so a
 * schema change still typechecks the reads and writes below — the alternative,
 * casting the union away, would silently accept a misspelled `endsOnTurn`,
 * which is the exact bug this module exists to prevent.
 */
type ChamberElection = Omit<SenateLeadershipElection, "_id"> & { _id: ChamberElectionRole };
type ChamberNomination = Omit<SenateLeadershipNomination, "role"> & { role: ChamberElectionRole };

export interface OpenLeadershipElectionArgs {
  role: ChamberElectionRole;
  chamber: "house" | "senate";
  /** Chamber composition context, used for the incumbent's eligibility check. */
  ctx: ChamberLeadershipContext;
  now: Date;
  /**
   * Skip seeding the incumbent nomination. Set by the party-eligibility
   * reconciler, which has just vacated the seat precisely because the holder is
   * no longer eligible — the policy check below would reject them anyway, so
   * this only avoids three pointless queries.
   */
  skipIncumbentNomination?: boolean;
}

/**
 * The party a seat holder actually belongs to right now.
 *
 * NOT `congressLeaders.party`: that field is stamped when the leader is elected
 * and never updated afterwards, so it still reads as the old party after a
 * switch. All three switch paths (`applyCharacterPartyJoin`, the party `leave`
 * route, and `purge`) write `characters.party` and `electedOfficials.party`
 * together, and the seat row is the only one of the two that exists for an
 * NPP-held seat.
 */
export function resolveSeatHolderParty(
  seat: Pick<ElectedOfficial, "party"> | null,
  character: Pick<Character, "party"> | null
): string | null {
  return character?.party ?? seat?.party ?? null;
}

/**
 * Open a fresh 24-turn leadership election for one chamber role.
 *
 * Idempotent: a no-op returning `false` while a live election for the role is
 * still running, so it is safe to call from a per-request path.
 *
 * @returns true if an election was opened, false if one was already live.
 */
export async function openCongressLeadershipElection(
  db: Db,
  { role, chamber, ctx, now, skipIncumbentNomination }: OpenLeadershipElectionArgs
): Promise<boolean> {
  const electionCollection =
    chamber === "senate" ? "senateLeadershipElections" : "houseLeadershipElections";
  const nominationCollection =
    chamber === "senate" ? "senateLeadershipNominations" : "houseLeadershipNominations";

  const gameTime = await getGameTime();
  const existing = await db.collection<ChamberElection>(electionCollection).findOne({ _id: role });
  if (
    existing?.status === "voting" &&
    !isLeadershipElectionClosed(existing, gameTime.currentTurn, gameTime.effectiveNow)
  ) {
    return false;
  }

  await db
    .collection<ChamberNomination>(nominationCollection)
    .updateMany(
      { role, status: { $in: ["open", "voting"] } },
      { $set: { status: "failed", updatedAt: now } }
    );

  // Both anchors, always. `endsAt` is derived from the game clock (not wall
  // time) so the two agree even when real time has drifted ahead of the last
  // processed turn.
  const endsAt = new Date(gameTime.effectiveNow.getTime() + LEADERSHIP_ELECTION_DURATION_MS);
  const endsOnTurn = gameTime.currentTurn + LEADERSHIP_ELECTION_DURATION_MS / 3_600_000;
  await db
    .collection<ChamberElection>(electionCollection)
    .updateOne(
      { _id: role },
      { $set: { _id: role, status: "voting", startedAt: now, endsAt, endsOnTurn, updatedAt: now } },
      { upsert: true }
    );

  if (skipIncumbentNomination) return true;

  const leaderRole =
    chamber === "senate"
      ? senateElectionRoleToLeader(role as SenateLeadershipElectionRole)
      : houseElectionRoleToLeader(role as HouseLeadershipElectionRole);
  const incumbent = await db
    .collection<CongressLeader>("congressLeaders")
    .findOne({ role: leaderRole });
  if (!incumbent?.characterId) return true;

  const seat = await db.collection<ElectedOfficial>("electedOfficials").findOne({
    officeType: chamber,
    characterId: incumbent.characterId,
  });
  if (!seat) return true;

  const char = await db
    .collection<Character>("characters")
    .findOne({ _id: incumbent.characterId }, { projection: { party: 1, homeState: 1 } });
  // Congressional leadership races are player-only, so an incumbent without a
  // character document is never seeded onto the ballot.
  if (!char) return true;

  const party = resolveSeatHolderParty(seat, char);
  if (!party || !isPartyEligible(POLICY_BY_ROLE[leaderRole], party, ctx)) return true;

  await db.collection<ChamberNomination>(nominationCollection).insertOne({
    _id: new ObjectId(),
    role,
    nomineeId: incumbent.characterId,
    nomineeName: incumbent.characterName,
    nomineeParty: party,
    nomineeState: char.homeState ?? seat.state ?? undefined,
    nominatedById: incumbent.characterId,
    nominatedByName: "Incumbent",
    status: "voting",
    votesFor: 0,
    votesAgainst: 0,
    votes: {},
    createdAt: now,
    updatedAt: now,
  });

  return true;
}
