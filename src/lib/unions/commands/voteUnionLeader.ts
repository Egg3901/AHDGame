import type { Db } from "mongodb";
import { ObjectId, type MongoServerError } from "mongodb";
import type { Character, Union } from "@/lib/db/types";
import type { UnionLeaderVote, UnionOrganizer } from "@/lib/db/types/union";
import type { CountryId } from "@/lib/constants/countries";
import { isSameCountry } from "@/lib/api/sameCountry";
import { createNotification } from "@/lib/notifications";
import { isUnionLeadershipElectionOpen } from "@/lib/unions/unionEconomy";
import { isUnionsBanned, UNIONS_BANNED_MESSAGE } from "@/lib/labour/unionLaws";
import {
  loadUnionVoteWeights,
  seatedPlayerPresidentId,
  tallyUnionLeaderVotes,
} from "@/lib/unions/unionLeadershipVote";

const DUPLICATE_KEY_ERROR_CODE = 11000;

export type VoteUnionLeaderResult =
  | { ok: true; status: 200; pendingLeaderCharacterId: string | null }
  | { ok: false; status: number; error: string };

/**
 * Cast an organizer's vote for union president. Contests stay open once the
 * union is strong enough — including while a president sits — mirroring
 * corporation CEO votes. Updates `pendingLeaderCharacterId` when the plurality
 * leader is someone other than the incumbent.
 */
export async function voteUnionLeader(
  db: Db,
  voter: Character,
  union: Union,
  candidateCharacterId: ObjectId
): Promise<VoteUnionLeaderResult> {
  if (!isUnionLeadershipElectionOpen(union)) {
    return {
      ok: false,
      status: 400,
      error: "Organize this union further before voting for a president.",
    };
  }
  if (!isSameCountry(voter, { countryId: union.countryId as CountryId })) {
    return {
      ok: false,
      status: 403,
      error: "You must be in this union's country to vote.",
    };
  }
  // Union ban (player suggestion #93): leadership elections freeze while banned.
  if (await isUnionsBanned(db, union.countryId as CountryId)) {
    return { ok: false, status: 403, error: UNIONS_BANNED_MESSAGE };
  }

  const organizer = await db
    .collection<UnionOrganizer>("unionOrganizers")
    .findOne({ unionId: union._id, characterId: voter._id });
  if (!organizer || !(typeof organizer.strength === "number" && organizer.strength > 0)) {
    return {
      ok: false,
      status: 403,
      error: "Run an organize drive before voting for president.",
    };
  }

  const incumbentId = seatedPlayerPresidentId(union);
  const isIncumbentCandidate = incumbentId === candidateCharacterId.toString();

  const candidate = await db
    .collection<Character>("characters")
    .findOne(
      { _id: candidateCharacterId },
      { projection: { name: 1, userId: 1, countryId: 1, unionLeaderOf: 1 } }
    );
  if (!candidate) {
    return { ok: false, status: 404, error: "Candidate not found." };
  }
  // Sitting president stays votable even if they moved countries — otherwise
  // shareholders of organizing strength could not reaffirm them and any
  // challenger would run unopposed (CEO residency exemption parallel).
  if (!isIncumbentCandidate && !isSameCountry(candidate, { countryId: union.countryId as CountryId })) {
    return {
      ok: false,
      status: 403,
      error: "The candidate must be in this union's country.",
    };
  }
  if (
    candidate.unionLeaderOf != null &&
    candidate.unionLeaderOf.toString() !== union._id.toString()
  ) {
    return {
      ok: false,
      status: 403,
      error: "That character already leads another union.",
    };
  }

  const now = new Date();
  const upsertFilter = { unionId: union._id, voterCharacterId: voter._id };
  try {
    await db.collection<Omit<UnionLeaderVote, "_id">>("unionLeaderVotes").updateOne(
      upsertFilter,
      {
        $set: { candidateCharacterId, updatedAt: now },
        $setOnInsert: {
          unionId: union._id,
          voterCharacterId: voter._id,
          createdAt: now,
        },
      },
      { upsert: true }
    );
  } catch (error) {
    const code = (error as MongoServerError | undefined)?.code;
    if (code !== DUPLICATE_KEY_ERROR_CODE) throw error;
    await db.collection<UnionLeaderVote>("unionLeaderVotes").updateOne(upsertFilter, {
      $set: { candidateCharacterId, updatedAt: now },
    });
  }

  const [allVotes, weights] = await Promise.all([
    db.collection<UnionLeaderVote>("unionLeaderVotes").find({ unionId: union._id }).toArray(),
    loadUnionVoteWeights(db, union._id),
  ]);
  const tally = tallyUnionLeaderVotes(allVotes, weights, incumbentId);
  const leaderId = tally?.leaderId ?? null;
  const prevPending = union.pendingLeaderCharacterId?.toString() ?? null;

  // Incumbent (player) leading, or nobody leading: clear any stale offer.
  // NPP incumbents are never character candidates, so any player plurality
  // always differs from the seated NPP and should get an offer.
  if (!leaderId || leaderId === incumbentId) {
    if (prevPending) {
      await db
        .collection<Union>("unions")
        .updateOne(
          { _id: union._id },
          { $set: { pendingLeaderCharacterId: null, updatedAt: now } }
        );
    }
    return { ok: true, status: 200, pendingLeaderCharacterId: null };
  }

  if (leaderId === prevPending) {
    return { ok: true, status: 200, pendingLeaderCharacterId: leaderId };
  }

  await db
    .collection<Union>("unions")
    .updateOne(
      { _id: union._id },
      { $set: { pendingLeaderCharacterId: new ObjectId(leaderId), updatedAt: now } }
    );

  const leaderChar = await db
    .collection<Character>("characters")
    .findOne({ _id: new ObjectId(leaderId) }, { projection: { userId: 1, name: 1 } });
  if (leaderChar?.userId) {
    await createNotification({
      userId: leaderChar.userId,
      type: "union_leader_offer",
      title: "Union presidency offered",
      message: `Organizers of ${union.name} have voted you their top choice for president. Visit the union page to accept or decline.`,
      metadata: {
        unionId: union._id.toString(),
        unionName: union.name,
      },
    });
  }

  return { ok: true, status: 200, pendingLeaderCharacterId: leaderId };
}
