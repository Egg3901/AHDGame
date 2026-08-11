import type {
  ElectoralMapState,
  VoteTurnSnapshot,
} from "@/app/elections/[id]/components/ElectionDetailTypes";
import type {
  ContingentElectionDisplay,
  PresidentialResolutionMode,
} from "@/lib/elections/presidentialResolutionDisplay";

export interface PrimaryCandidate {
  characterName: string;
  party: string;
  primaryScore: number;
  sharePct: number;
  won?: boolean;
}

export interface PrimaryResult {
  partyId: string;
  partyName: string;
  partyColor: string;
  candidates: PrimaryCandidate[];
}

export interface GeneralResults {
  totalVotes: Record<string, number>;
  candidateNames: Record<string, string>;
  candidateParties: Record<string, string>;
  seatsEstimate?: Record<string, number>;
  finalized: boolean;
  electoralVotesByCandidate?: Record<string, number>;
  totalVotesByUnit?: Record<string, Record<string, number>>;
  electoralMapData?: Record<string, ElectoralMapState>;
  stateVoteData?: Record<
    string,
    { votesByCandidate: Record<string, number>; evByCandidate: Record<string, number> }
  >;
  stateVotesOverTime?: Record<string, VoteTurnSnapshot[]>;
  resolutionMode?: PresidentialResolutionMode;
  contingentResult?: ContingentElectionDisplay;
}

export interface PrimarySnapshotPoint {
  recordedAt: string;
  byParty: Record<string, { characterName: string; sharePct: number }[]>;
}

export interface ElectionDetail {
  id: string;
  electionType: string;
  state: string;
  stateName: string;
  senateClass: number | null;
  cycle: number;
  totalSeats: number | null;
  endTime: string | null;
  year: number;
  label: string;
  primaryResults: PrimaryResult[];
  primarySnapshotHistory?: PrimarySnapshotPoint[];
  generalResults: GeneralResults | null;
  candidateCount: number;
}
