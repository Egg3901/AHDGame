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
  ElectedOfficial,
  NPP,
} from "@/lib/db/types";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import { DISCORD_COLORS, sendCountryGameEvent } from "@/lib/discordWebhooks";
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
    acting: true,
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

/**
 * Tell the people the deadlock involves: the acting president, the three
 * tickets still on the House ballot, and every player sitting in the House, plus
 * the country's game-event feed. Never throws: messaging must not undo seating.
 */
export async function announceActingPresidency(
  db: Db,
  params: {
    election: Election;
    vote: ContingentHouseVote;
    houseThreshold: number;
    candidates: Pick<ElectionCandidate, "_id" | "characterId" | "characterName" | "isNPP">[];
  }
): Promise<void> {
  const { election, vote, houseThreshold, candidates } = params;
  const electionId = election._id.toString();
  const ballot = new Set(vote.eligibleCandidateIds);
  const onBallot = candidates.filter((c) => ballot.has(c._id.toString()));
  const names = onBallot.map((c) => c.characterName).join(", ");
  const window = `The House keeps voting until turn ${vote.closesTurn}.`;
  const metadata = { electionId, electionType: "president", contingentHouseVote: true };
  try {
    const inputs: NotificationInput[] = [];
    const userOf = async (characterId: ObjectId | null | undefined) =>
      characterId
        ? ((
            await db
              .collection<Character>("characters")
              .findOne({ _id: characterId }, { projection: { userId: 1 } })
          )?.userId ?? null)
        : null;

    if (!isNppContingentId(vote.actingPresidentId)) {
      const userId = await userOf(toCharacterObjectId(vote.actingPresidentId));
      if (userId)
        inputs.push({
          userId,
          type: "general_win",
          title: "Acting President of the United States",
          message: `No candidate won a majority of state delegations, so nobody has been elected president yet. As the vice president chosen by the Senate, you serve as acting president. ${window}`,
          metadata,
        });
    }
    for (const c of onBallot) {
      if (c.isNPP) continue;
      const userId = await userOf(c.characterId);
      if (userId)
        inputs.push({
          userId,
          type: "system",
          title: "The House has not chosen a president",
          message: `No candidate reached ${houseThreshold} state delegations. ${vote.actingPresidentName} serves as acting president. You remain on the House ballot with ${names}. ${window}`,
          metadata,
        });
    }
    const houseMembers = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find(
        { countryId: election.countryId ?? "US", officeType: "house", characterId: { $ne: null } },
        { projection: { characterId: 1 } }
      )
      .toArray();
    const notified = new Set(inputs.map((i) => String(i.userId)));
    for (const member of houseMembers) {
      const userId = await userOf(member.characterId);
      if (!userId || notified.has(String(userId))) continue;
      notified.add(String(userId));
      inputs.push({
        userId,
        type: "system",
        title: "The House chooses the president",
        message: `No candidate won ${houseThreshold} state delegations. The House keeps voting for one of ${names}, one vote per state delegation. ${vote.actingPresidentName} serves as acting president meanwhile. ${window}`,
        metadata,
      });
    }
    if (inputs.length > 0) await createNotifications(inputs);
  } catch (err) {
    console.error(
      `[Turn] President election ${electionId}: acting presidency notifications failed`,
      err
    );
  }
  try {
    await sendCountryGameEvent(election.countryId ?? "US", {
      title: "Presidential election: the House has not chosen",
      description: `No candidate won a majority of the Electoral College, and no candidate reached ${houseThreshold} state delegations in the House.`,
      color: DISCORD_COLORS.electionResult,
      fields: [
        { name: "Acting president", value: vote.actingPresidentName, inline: false },
        { name: "Still on the House ballot", value: names || "None", inline: false },
        { name: "House vote", value: `Open until turn ${vote.closesTurn}`, inline: false },
      ],
      footer: { text: "The vice president chosen by the Senate acts until the House chooses." },
    });
  } catch (err) {
    console.error(`[Turn] President election ${electionId}: acting presidency webhook failed`, err);
  }
}
