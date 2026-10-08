/**
 * House deadlock in a US contingent election.
 *
 * When no presidential candidate wins a majority of state delegations, the
 * House has not chosen a president. As under the 20th Amendment, the
 * vice president the Senate elected serves as acting president, and the House
 * keeps voting: a contingent House vote stays open for
 * `CONTINGENT_HOUSE_VOTE_TURNS` turns. The plurality leader is never seated.
 */
import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type {
  Character,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  NPP,
} from "@/lib/db/types";
import type { ContingentElectionResult } from "@/lib/elections/contingentElection";
import { seatPresidentialExecutive } from "@/lib/turn/election/presidentExecutiveSeating";
import { isNppContingentId, toCharacterObjectId, toNppObjectId } from "./contingentPersonIds";

/** How long the House keeps voting after a deadlock (hourly turns: about a day). */
export const CONTINGENT_HOUSE_VOTE_TURNS = 24;

export type ContingentHouseVote = NonNullable<ElectionVoteTally["contingentHouseVote"]>;

/** True when the ballot left the House deadlocked with a Senate-elected VP to act. */
export function needsActingPresidency(
  result: Pick<ContingentElectionResult, "houseDeadlocked" | "vicePresidentWinnerId"> | undefined
): boolean {
  return Boolean(result?.houseDeadlocked && result.vicePresidentWinnerId);
}

async function loadActingPerson(
  db: Db,
  personId: string
): Promise<{ characterId: ObjectId | null; nppId: ObjectId | null; name: string; party: string }> {
  if (isNppContingentId(personId)) {
    const nppId = toNppObjectId(personId);
    const npp = await db
      .collection<NPP>("npps")
      .findOne({ _id: nppId }, { projection: { name: 1, party: 1 } });
    if (!npp) throw new Error(`Acting president NPP ${personId} not found`);
    return { characterId: null, nppId, name: npp.name, party: npp.party ?? "independent" };
  }
  const characterId = toCharacterObjectId(personId);
  const char = await db
    .collection<Character>("characters")
    .findOne({ _id: characterId }, { projection: { name: 1, party: 1 } });
  if (!char) throw new Error(`Acting president character ${personId} not found`);
  return { characterId, nppId: null, name: char.name, party: char.party ?? "independent" };
}

/**
 * Seat the Senate's vice-presidential pick as acting president, leave the vice
 * presidency vacant, and open the House vote on the tally. Idempotent on the
 * vote record: a seating retry keeps the original window.
 */
export async function seatActingPresidencyForHouseVote(
  db: Db,
  params: {
    election: Election;
    contingentResult: Pick<
      ContingentElectionResult,
      "vicePresidentWinnerId" | "eligiblePresidentCandidateIds"
    >;
    existingVote?: ContingentHouseVote;
    now: Date;
    turn: number;
  }
): Promise<ContingentHouseVote> {
  const { election, contingentResult, existingVote, now, turn } = params;
  const actingId = contingentResult.vicePresidentWinnerId;
  if (!actingId) throw new Error("A House deadlock needs a Senate-elected vice president to act");
  const person = await loadActingPerson(db, actingId);

  // The seating path takes a candidacy; the acting president holds none, so
  // describe the person in the fields it reads.
  const actingCandidacy = {
    _id: new ObjectId(),
    electionId: election._id,
    countryId: election.countryId,
    characterId: person.characterId,
    characterName: person.name,
    party: person.party,
    status: "active",
    isNPP: person.nppId != null,
    nppId: person.nppId ?? undefined,
  } as unknown as ElectionCandidate;

  await seatPresidentialExecutive(db, {
    election,
    winnerCandidate: actingCandidacy,
    now,
    turn,
  });

  const vote: ContingentHouseVote = existingVote ?? {
    status: "open",
    openedTurn: turn,
    closesTurn: turn + CONTINGENT_HOUSE_VOTE_TURNS,
    actingPresidentId: actingId,
    actingPresidentName: person.name,
    eligibleCandidateIds: contingentResult.eligiblePresidentCandidateIds,
    votes: {},
  };
  await db.collection<ElectionVoteTally>("electionVoteTallies").updateOne(
    { electionId: election._id },
    {
      $set: {
        contingentHouseVote: vote,
        executiveSeatingPending: false,
        updatedAt: now,
      },
    }
  );
  return vote;
}
