import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { createNotification, createNotifications } from "@/lib/notifications";
import type { NationalPartyElectionPosition, Character } from "@/lib/db/types";
import { type CountryId } from "@/lib/constants/countries";
import { getPartyRoleLabel } from "@/lib/parties/partyRoleLabels";

async function findPartyByElectionPartyId(
  db: Db,
  partyId: string,
  countryId: CountryId
): Promise<PoliticalParty | null> {
  const sequentialId = Number.parseInt(partyId, 10);
  if (Number.isNaN(sequentialId)) {
    return null;
  }
  // Always use countryId to find the correct party (sequentialId is only unique within a country)
  return db.collection<PoliticalParty>("politicalParties").findOne({ sequentialId, countryId });
}

// ─── Notification helpers ────────────────────────────────────────────────────

export async function notifyNationalMembersElectionOpened(
  partyId: string,
  countryId: CountryId,
  position: NationalPartyElectionPosition,
  durationTurns: number
): Promise<void> {
  const db = await getDb();
  // Filter members by both partyId and countryId to avoid cross-country notifications
  const members = await db
    .collection<Character>("characters")
    .find({ party: partyId, countryId })
    .project<{ _id: ObjectId; userId: ObjectId }>({ _id: 1, userId: 1 })
    .toArray();

  const label = getPartyRoleLabel(countryId, position);
  const party = await findPartyByElectionPartyId(db, partyId, countryId);
  const partyName = party?.name ?? partyId;

  await createNotifications(
    members.map((m) => ({
      userId: m.userId,
      type: "national_leadership_election_opened",
      title: `${label} Election Open`,
      message:
        `A new ${label} election has opened for the ${partyName}. ` +
        `Voting is open for ${durationTurns} turns. Declare your candidacy or cast your vote on the party page.`,
      metadata: { partyId, countryId, position, recipientCharacterId: m._id.toString() },
    }))
  );
}

export async function notifyNationalMembersElectionsOpenedBatch(
  partyId: string,
  countryId: CountryId,
  positions: NationalPartyElectionPosition[],
  durationTurns: number,
  opts: { founding?: boolean } = {}
): Promise<void> {
  const db = await getDb();
  const members = await db
    .collection<Character>("characters")
    .find({ party: partyId, countryId })
    .project<{ _id: ObjectId; userId: ObjectId }>({ _id: 1, userId: 1 })
    .toArray();

  const party = await findPartyByElectionPartyId(db, partyId, countryId);
  const partyName = party?.name ?? partyId;

  const labels = positions.map((p) => getPartyRoleLabel(countryId, p));
  const positionList =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  const title =
    positions.length === 1 ? `${labels[0]} Election Open` : "National Leadership Elections Open";

  await createNotifications(
    members.map((m) => ({
      userId: m.userId,
      type: "national_leadership_election_opened",
      title,
      message:
        `New ${positionList} elections have opened for the ${partyName}. ` +
        `Voting is open for ${durationTurns} turns. Declare your candidacy or cast your vote on the party page.` +
        (opts.founding
          ? ` This is an accelerated founding election — the 24-hour new-character and party-tenure requirements are waived, so every member can declare and vote immediately.`
          : ""),
      metadata: { partyId, countryId, positions, recipientCharacterId: m._id.toString() },
    }))
  );
}

export async function notifyNationalLeadershipElected(
  winnerId: ObjectId,
  partyId: string,
  position: NationalPartyElectionPosition,
  winnerName: string,
  countryId: CountryId
): Promise<void> {
  const db = await getDb();
  const char = await db.collection<Character>("characters").findOne({ _id: winnerId });
  if (!char) return;

  const party = await findPartyByElectionPartyId(db, partyId, countryId);
  const partyName = party?.name ?? partyId;
  const label = getPartyRoleLabel(countryId, position);

  await createNotification({
    userId: char.userId,
    type: "national_leadership_elected",
    title: `You've been elected ${label}!`,
    message:
      `Congratulations, ${winnerName}! You have won the ${partyName} ${label} election. ` +
      `You now hold this national leadership position.`,
    metadata: { partyId, position, recipientCharacterId: char._id.toString() },
  });
}

export async function notifyNationalLeadershipLost(
  loserId: ObjectId,
  partyId: string,
  position: NationalPartyElectionPosition,
  loserName: string,
  winnerName: string,
  countryId: CountryId
): Promise<void> {
  const db = await getDb();
  const char = await db.collection<Character>("characters").findOne({ _id: loserId });
  if (!char) return;

  const party = await findPartyByElectionPartyId(db, partyId, countryId);
  const partyName = party?.name ?? partyId;
  const label = getPartyRoleLabel(countryId, position);

  await createNotification({
    userId: char.userId,
    type: "national_leadership_lost",
    title: `${label} Election Result`,
    message:
      `The ${partyName} ${label} election has concluded. ` +
      `${winnerName} won the race. Better luck next time, ${loserName}.`,
    metadata: { partyId, position, recipientCharacterId: char._id.toString() },
  });
}

export async function notifyNationalLeadershipRemoved(
  holderId: ObjectId,
  partyId: string,
  position: NationalPartyElectionPosition,
  countryId: CountryId
): Promise<void> {
  const db = await getDb();
  const char = await db.collection<Character>("characters").findOne({ _id: holderId });
  if (!char) return;

  const label = getPartyRoleLabel(countryId, position);
  await createNotification({
    userId: char.userId,
    type: "national_leadership_removed",
    title: `Removed as ${label}`,
    message:
      `You have been replaced as ${label} of the national party ` +
      `following the conclusion of the leadership election.`,
    metadata: { partyId, position, recipientCharacterId: char._id.toString() },
  });
}

export async function notifyNationalLeadershipVacatedForNewRole(
  holderId: ObjectId,
  partyId: string,
  vacatedPosition: NationalPartyElectionPosition,
  newPosition: NationalPartyElectionPosition,
  countryId: CountryId
): Promise<void> {
  const db = await getDb();
  const char = await db.collection<Character>("characters").findOne({ _id: holderId });
  if (!char) return;

  const vacatedLabel = getPartyRoleLabel(countryId, vacatedPosition);
  const newLabel = getPartyRoleLabel(countryId, newPosition);
  await createNotification({
    userId: char.userId,
    type: "national_leadership_removed",
    title: `Vacated ${vacatedLabel} role`,
    message:
      `You have stepped down as ${vacatedLabel} of the national party ` +
      `after winning the ${newLabel} election. A character can hold ` +
      `only one national party leadership office at a time.`,
    metadata: {
      partyId,
      position: vacatedPosition,
      newPosition,
      recipientCharacterId: char._id.toString(),
    },
  });
}

/**
 * Sent when a leadership cycle closed with no winner and the incumbent had not
 * entered the race, so the seat was vacated rather than rolled over (#1100).
 */
export async function notifyNationalLeadershipNotReStood(
  holderId: ObjectId,
  partyId: string,
  vacatedPosition: NationalPartyElectionPosition,
  countryId: CountryId
): Promise<void> {
  const db = await getDb();
  const char = await db.collection<Character>("characters").findOne({ _id: holderId });
  if (!char) return;

  const label = getPartyRoleLabel(countryId, vacatedPosition);
  await createNotification({
    userId: char.userId,
    type: "national_leadership_removed",
    title: `Term as ${label} ended`,
    message:
      `Your term as ${label} of the national party has ended. You did not stand in the ` +
      `leadership election, so the seat is now vacant and open for the next election.`,
    metadata: {
      partyId,
      position: vacatedPosition,
      reason: "did_not_stand",
      recipientCharacterId: char._id.toString(),
    },
  });
}

export async function notifyNationalLeadershipVacatedInactive(
  holderId: ObjectId,
  partyId: string,
  vacatedPosition: NationalPartyElectionPosition,
  countryId: CountryId
): Promise<void> {
  const db = await getDb();
  const char = await db.collection<Character>("characters").findOne({ _id: holderId });
  if (!char) return;

  const label = getPartyRoleLabel(countryId, vacatedPosition);
  await createNotification({
    userId: char.userId,
    type: "national_leadership_removed",
    title: `Removed as ${label}`,
    message:
      `You have been removed as ${label} of the national party due to inactivity. ` +
      `The seat is now open for the next leadership election.`,
    metadata: {
      partyId,
      position: vacatedPosition,
      reason: "inactive",
      recipientCharacterId: char._id.toString(),
    },
  });
}

export async function notifyNationalLeadershipAppointed(
  characterId: ObjectId,
  partyId: string,
  position: NationalPartyElectionPosition,
  appointedByName: string,
  countryId: CountryId
): Promise<void> {
  const db = await getDb();
  const char = await db.collection<Character>("characters").findOne({ _id: characterId });
  if (!char) return;

  const label = getPartyRoleLabel(countryId, position);
  await createNotification({
    userId: char.userId,
    type: "national_leadership_appointed",
    title: `Appointed as ${label}`,
    message:
      `You have been appointed as ${label} of the national party ` + `by ${appointedByName}.`,
    metadata: { partyId, position },
  });
}

export async function notifyNationalCandidacyDeclared(
  partyId: string,
  position: NationalPartyElectionPosition,
  candidateName: string,
  candidateCharId: ObjectId,
  countryId: CountryId
): Promise<void> {
  const db = await getDb();
  const filter: Record<string, unknown> = {
    party: partyId,
    countryId,
    _id: { $ne: candidateCharId },
  };
  const members = await db
    .collection<Character>("characters")
    .find(filter)
    .project<{ _id: ObjectId; userId: ObjectId }>({ _id: 1, userId: 1 })
    .toArray();

  const label = getPartyRoleLabel(countryId, position);
  const party = await findPartyByElectionPartyId(db, partyId, countryId);
  const partyName = party?.name ?? partyId;

  await createNotifications(
    members.map((m) => ({
      userId: m.userId,
      type: "national_leadership_candidacy",
      title: `New ${label} Candidate`,
      message:
        `${candidateName} has declared their candidacy for ${label} ` +
        `of the ${partyName}. Cast your vote on the party page.`,
      metadata: { partyId, position, candidateName, recipientCharacterId: m._id.toString() },
    }))
  );
}
