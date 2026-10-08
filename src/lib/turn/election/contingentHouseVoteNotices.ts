/**
 * In-game notices and the news item for the House vote after a contingent
 * deadlock: opening, a once-per-turn reminder to members who have not voted,
 * and the outcome. Notices only; nothing here reaches Discord.
 */
import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type {
  Character,
  Coalition,
  ElectedOfficial,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  PoliticalParty,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { CONTINGENT_EXCLUDED_HOUSE_STATE } from "@/lib/elections/contingentConstants";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import { createSystemNewsPost } from "@/lib/news";
import { logger } from "../../observability/logger";

type HouseVote = NonNullable<ElectionVoteTally["contingentHouseVote"]>;
type Role = "member" | "candidate" | "whip";

interface Audience {
  /** User id to the roles that user holds in the vote. */
  roles: Map<string, { userId: ObjectId; roles: Set<Role>; characterId: string }>;
}

async function userIdsFor(db: Db, characterIds: ObjectId[]): Promise<Map<string, ObjectId>> {
  if (characterIds.length === 0) return new Map();
  const chars = await db
    .collection<Character>("characters")
    .find({ _id: { $in: characterIds } })
    .project<Pick<Character, "_id" | "userId">>({ _id: 1, userId: 1 })
    .toArray();
  return new Map(chars.filter((c) => c.userId).map((c) => [c._id.toString(), c.userId]));
}

async function loadHouseMemberCharacterIds(db: Db, countryId: string) {
  const seats = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({
      countryId: countryId as CountryId,
      officeType: "house",
      characterId: { $ne: null },
      state: { $ne: CONTINGENT_EXCLUDED_HOUSE_STATE },
    })
    .project<Pick<ElectedOfficial, "characterId" | "party">>({ characterId: 1, party: 1 })
    .toArray();
  return seats;
}

async function loadAudience(
  db: Db,
  election: Pick<Election, "countryId">,
  vote: Pick<HouseVote, "eligibleCandidateIds">
): Promise<Audience> {
  const countryId = election.countryId ?? "US";
  const seats = await loadHouseMemberCharacterIds(db, countryId);
  const memberIds = seats.map((s) => s.characterId as ObjectId);
  const seatedParties = new Set(seats.map((s) => s.party).filter((p): p is string => Boolean(p)));

  const [candidacies, parties, coalitions] = await Promise.all([
    db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ _id: { $in: vote.eligibleCandidateIds.map((id) => new ObjectId(id)) } })
      .project<Pick<ElectionCandidate, "characterId" | "isNPP" | "party">>({
        characterId: 1,
        isNPP: 1,
        party: 1,
      })
      .toArray(),
    db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId: countryId as CountryId, chairId: { $ne: null } })
      .project<Pick<PoliticalParty, "chairId" | "sequentialId">>({ chairId: 1, sequentialId: 1 })
      .toArray(),
    db
      .collection<Coalition>("coalitions")
      .find({ countryId: countryId as CountryId, chairCharacterId: { $ne: null } })
      .project<Pick<Coalition, "chairCharacterId">>({ chairCharacterId: 1 })
      .toArray(),
  ]);
  for (const c of candidacies) if (c.party) seatedParties.add(c.party);

  const candidateIds = candidacies
    .filter((c) => !c.isNPP && c.characterId)
    .map((c) => c.characterId as ObjectId);
  const whipIds = [
    ...parties
      .filter((p) => seatedParties.has(String(p.sequentialId)) && p.chairId)
      .map((p) => p.chairId as ObjectId),
    ...coalitions.map((c) => c.chairCharacterId as ObjectId),
  ];

  const users = await userIdsFor(db, [...memberIds, ...candidateIds, ...whipIds]);
  const roles: Audience["roles"] = new Map();
  const add = (characterId: ObjectId, role: Role) => {
    const key = characterId.toString();
    const userId = users.get(key);
    if (!userId) return;
    const entry = roles.get(userId.toString()) ?? {
      userId,
      roles: new Set<Role>(),
      characterId: key,
    };
    entry.roles.add(role);
    roles.set(userId.toString(), entry);
  };
  memberIds.forEach((id) => add(id, "member"));
  candidateIds.forEach((id) => add(id, "candidate"));
  whipIds.forEach((id) => add(id, "whip"));
  return { roles };
}

async function send(inputs: NotificationInput[]): Promise<void> {
  if (inputs.length === 0) return;
  await createNotifications(inputs).catch((err) =>
    logger.error("Turn", "House vote notification failed", err)
  );
}

function turnsLabel(n: number): string {
  return `${n} ${n === 1 ? "turn" : "turns"}`;
}

/** The vote just opened: tell the House, the candidates and the whips. */
export async function notifyHouseVoteOpened(
  db: Db,
  election: Pick<Election, "_id" | "countryId">,
  vote: HouseVote,
  houseThreshold: number
): Promise<void> {
  const audience = await loadAudience(db, election, vote);
  const base =
    `No ticket won a majority of electoral votes, so the House of Representatives chooses the president. ` +
    `Each state delegation casts one vote, a tied delegation casts none, and a candidate needs ${houseThreshold} state delegations. ` +
    `The Senate already chose ${vote.actingPresidentName} as vice president, and they act as president until the House chooses. ` +
    `The House ballots again every turn and the first candidate with a majority wins, ` +
    `until turn ${vote.closesTurn}.`;
  await send(
    [...audience.roles.values()].map(({ userId, roles }) => {
      const extra: string[] = [];
      if (roles.has("member")) {
        extra.push(
          "You sit in the House: vote on the election page, and change your vote any time."
        );
      }
      if (roles.has("whip")) {
        extra.push(
          "As a party or coalition chair you can set a whip for your House members there."
        );
      }
      if (roles.has("candidate")) {
        extra.push("You are one of the three candidates the House is choosing between.");
      }
      return {
        userId,
        type: "election_opened" as const,
        title: "The House is choosing the president",
        message: [base, ...extra].join(" "),
        metadata: {
          electionId: election._id.toString(),
          electionType: "president",
          kind: "house_vote_opened",
        },
      };
    })
  );
}

/**
 * Remind House members who have not voted. Called only when the ballot moved;
 * the caller claims the turn first so a retry never sends twice.
 */
export async function notifyHouseVoteReminder(
  db: Db,
  election: Pick<Election, "_id" | "countryId">,
  vote: HouseVote,
  summary: { leaderName: string | null; leaderDelegations: number; threshold: number },
  currentTurn: number
): Promise<number> {
  const audience = await loadAudience(db, election, vote);
  const voted = new Set(Object.keys(vote.votes ?? {}));
  const left = Math.max(0, vote.closesTurn - currentTurn);
  const lead = summary.leaderName
    ? `${summary.leaderName} leads with ${summary.leaderDelegations} of ${summary.threshold} delegations. `
    : "";
  const targets = [...audience.roles.values()].filter(
    (r) => r.roles.has("member") && !voted.has(r.characterId)
  );
  await send(
    targets.map(({ userId }) => ({
      userId,
      type: "election_opened" as const,
      title: "The House vote is still open",
      message: `${lead}${turnsLabel(left)} left. You have not voted yet, so you follow your whip or your party's usual preference.`,
      metadata: {
        electionId: election._id.toString(),
        electionType: "president",
        kind: "house_vote_reminder",
      },
    }))
  );
  return targets.length;
}

/** The vote ended, with or without a president: tell everyone involved and post the news. */
export async function notifyHouseVoteClosed(
  db: Db,
  election: Pick<Election, "_id" | "countryId">,
  vote: HouseVote,
  outcome: { winnerName: string | null; delegations: number; threshold: number }
): Promise<void> {
  const audience = await loadAudience(db, election, vote);
  const message = outcome.winnerName
    ? `The House chose ${outcome.winnerName} as president with ${outcome.delegations} of ${outcome.threshold} state delegations needed. ${vote.actingPresidentName} becomes vice president.`
    : `The House ended its vote without a majority. ${vote.actingPresidentName} continues as acting president.`;
  const title = outcome.winnerName
    ? "The House has chosen a president"
    : "The House vote has ended";
  await send(
    [...audience.roles.values()].map(({ userId }) => ({
      userId,
      type: "system" as const,
      title,
      message,
      metadata: {
        electionId: election._id.toString(),
        electionType: "president",
        kind: "house_vote_closed",
      },
    }))
  );
  await createSystemNewsPost(message, "election", { title }).catch((err) =>
    logger.error("Turn", "House vote news failed", err)
  );
}
