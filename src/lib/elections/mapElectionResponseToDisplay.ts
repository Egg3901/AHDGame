import type { ElectionDisplay } from "@/lib/db/types";
import type { ElectionResponse } from "@/lib/elections/resolveElection";

export function mapElectionResponseToDisplay(election: ElectionResponse): ElectionDisplay {
  return {
    id: election.id,
    seatId: election.seatId ?? undefined,
    electionType: election.electionType,
    state: election.state,
    countryId: election.countryId,
    senateClass: election.senateClass ?? undefined,
    chamberClass: election.chamberClass ?? undefined,
    cycle: election.cycle,
    electionYear: election.electionYear ?? undefined,
    status: election.status,
    totalSeats: election.totalSeats ?? undefined,
    startTime: election.startTime ? String(election.startTime) : undefined,
    endTime: election.endTime ? String(election.endTime) : undefined,
    primaryEndTime: election.primaryEndTime ? String(election.primaryEndTime) : undefined,
    startTurn: election.startTurn ?? undefined,
    endTurn: election.endTurn ?? undefined,
    primaryEndTurn: election.primaryEndTurn ?? undefined,
    durationHours: election.durationHours ?? undefined,
    primaryDurationHours: election.primaryDurationHours ?? undefined,
    inPrimary: election.inPrimary,
    polling: election.polling ?? undefined,
    seatsEstimate: election.seatsEstimate ?? undefined,
    primaryVotes: election.primaryVotes ?? undefined,
    generalTally: election.generalVotes
      ? {
          totalVotes: election.generalVotes.totalVotes,
          turnSnapshots: election.generalVotes.turnSnapshots.map((snapshot) => ({
            turn: snapshot.turn,
            sharesPct: snapshot.sharesPct,
            cumulativeVotes: snapshot.cumulativeVotes,
            seatsEstimate: snapshot.seatsEstimate,
          })),
        }
      : undefined,
    candidates: election.candidates.map((candidate) => ({
      id: candidate.id,
      characterId: candidate.characterId ?? "",
      characterName: candidate.characterName,
      avatarUrl: candidate.avatarUrl,
      party: candidate.party,
      partyName: candidate.partyName,
      partyColor: candidate.partyColor,
      isNPP: candidate.isNPP,
      nppId: candidate.nppId ?? undefined,
      endorsements: (candidate.endorsements ?? [])
        .filter(
          (endorsement) => endorsement.type === "npp" && endorsement.nppId && endorsement.nppName
        )
        .map((endorsement) => ({
          nppId: endorsement.nppId!,
          nppName: endorsement.nppName!,
        })),
    })),
  };
}
