/**
 * Updates politician page (election history) when an election resolves.
 * Called from election resolution after winners/losers are determined.
 */
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type {
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  PoliticianOverride,
  PoliticianElectionEntry,
  State,
  PoliticalParty,
} from "@/lib/db/types";
import { formatElectionTypeLabel, MULTI_SEAT_TYPES } from "@/lib/utils/electionLabels";

export async function updatePoliticianPagesAfterElection(
  db: Db,
  election: Election,
  candidateIds: string[],
  tally: ElectionVoteTally | null,
  winnerIds: Set<string>,
  loserIds: Set<string>,
  seatsEstimate: Record<string, number>,
  now: Date
): Promise<void> {
  if (election.status !== "completed") return;

  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ _id: { $in: candidateIds.map((id) => new ObjectId(id)) } })
    .toArray();

  const totalVotes = tally ? Object.values(tally.totalVotes).reduce((s, v) => s + v, 0) : 0;
  const state = election.state
    ? await db
        .collection<State>("states")
        .findOne({ _id: election.state, countryId: election.countryId })
    : null;
  const stateName =
    state?.name ?? (election.state === "US" ? "United States" : (election.state ?? "Unknown"));
  const year = election.endTime
    ? new Date(election.endTime).getFullYear()
    : new Date().getFullYear();
  const officeLabel = `${formatElectionTypeLabel(election.electionType, election.countryId)} (${stateName})`;
  const isMultiSeat = MULTI_SEAT_TYPES.has(election.electionType);

  for (const cand of candidates) {
    if (cand.isNPP) continue;
    const politicianId = cand.characterId?.toString();
    if (!politicianId) continue;

    const votes = tally?.totalVotes[cand._id.toString()] ?? 0;
    const votesPct = totalVotes > 0 ? (votes / totalVotes) * 100 : 0;
    const seats = isMultiSeat ? (seatsEstimate[cand._id.toString()] ?? 0) : 0;
    const won = isMultiSeat ? seats > 0 : winnerIds.has(cand._id.toString());

    // Parties are uniquely identified by (sequentialId, countryId).
    // cand.party stores the sequentialId as a string.
    const candPartySeqId = Number(cand.party);
    const party = Number.isFinite(candPartySeqId)
      ? await db.collection<PoliticalParty>("politicalParties").findOne({
          sequentialId: candPartySeqId,
          countryId: election.countryId ?? "US",
        })
      : null;
    const partyName = party?.name ?? cand.party;

    const entry: PoliticianElectionEntry = {
      electionId: election._id.toString(),
      electionType: election.electionType,
      state: election.state,
      stateName,
      year,
      result: won ? "won" : "lost",
      votes,
      votesPct,
      party: partyName,
      officeLabel,
      completedAt: election.endTime ?? now,
    };

    const existing = await db
      .collection<PoliticianOverride>("politicianOverrides")
      .findOne({ politicianId });
    const history = existing?.electionHistory ?? [];
    const updated = [entry, ...history.filter((e) => e.electionId !== entry.electionId)];

    if (existing) {
      await db
        .collection<PoliticianOverride>("politicianOverrides")
        .updateOne({ politicianId }, { $set: { electionHistory: updated, updatedAt: now } });
    } else {
      await db.collection<PoliticianOverride>("politicianOverrides").insertOne({
        politicianId,
        electionHistory: updated,
        updatedAt: now,
      } as PoliticianOverride);
    }
  }
}
