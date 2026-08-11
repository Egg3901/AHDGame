import type { LastElectionPartySummary } from "@/lib/actions/prevElectionPartyShares";
import type { GranularPollPayload } from "@/lib/actions/granularPollPayload";

export type { LastElectionPartySummary };

export interface GroupResult {
  id: string;
  name: string;
  populationPct: number;
  economicLean: number;
  socialLean: number;
  turnoutPct: number;
  influencePct: number;
  groupPop: number;
  turnoutPop: number;
  reachedPop: number;
  appeal: number;
  rawPotential: number;
  weightedPotential: number;
  categoryName: string;
  categoryId: string;
  categoryWeight: number;
  /** When in an active general election: estimated share of this group (0–100%) */
  estimatedSharePct?: number;
  /** Per-archetype approval modifier (stored when computed) */
  archetypeApproval?: number;
  /** Effective favorability after archetype adjustment */
  effectiveFavorability?: number;
}

export interface CategoryResult {
  id: string;
  name: string;
  weight: number;
  categoryTurnoutPop: number;
  totalRawPotential: number;
  totalPotentialVoters: number;
  groups: GroupResult[];
}

export interface InRaceVoteShare {
  myVotes: number;
  opponentVotes: Record<string, number>;
}

export interface StoredPoll {
  takenAt: string;
  overallAppeal: number;
  totalEstimatedVoters: number;
  totalPotentialVoters: number;
  topGroups: GroupResult[];
  bottomGroups: GroupResult[];
  categories?: CategoryResult[];
  /** When poll was taken during an active general election: vote totals from group-level allocation */
  inRaceVoteShare?: InRaceVoteShare;
  /** Additive granular electorate breakdown; present only when the flag is enabled. */
  granular?: GranularPollPayload;
}

export interface OpponentSummary {
  candidateId: string;
  name: string;
  party: string;
  isNPP: boolean;
  economicPosition: number;
  socialPosition: number;
  favorability: number;
  politicalInfluence: number;
  /** When present, used for in-race poll weighting (matches Character/NPP). */
  archetypeApprovals?: Record<string, number>;
  overallAppeal: number;
  totalPotentialVoters: number;
  totalEstimatedVoters: number;
}

export interface ElectionContext {
  electionId: string;
  electionType: string;
  state: string;
  opponents: OpponentSummary[];
  lastElection?: LastElectionPartySummary | null;
}

export interface DemographicTurnoutEntry {
  key: string;
  label: string;
  statePct: number;
  turnoutRate: number;
  turnoutPop: number;
}

export interface DemographicTurnoutData {
  race: DemographicTurnoutEntry[];
  age: DemographicTurnoutEntry[];
  education: DemographicTurnoutEntry[];
  wealth: DemographicTurnoutEntry[];
}

export interface PollData {
  pollType: "small" | "large";
  homeState: string;
  stateName: string;
  statePopulation: number;
  character: {
    economicPosition: number;
    socialPosition: number;
    favorability: number;
    politicalInfluence: number;
    /** Party organization strength in home state (0–100). Undefined for independents. */
    partyOrg?: number;
  };
  fundCost: number;
  actionCost: number;
  canAffordSmall: boolean;
  canAffordLarge: boolean;
  hasActionsSmall: boolean;
  hasActionsLarge: boolean;
  storedPoll: StoredPoll | null;
  electionContext: ElectionContext | null;
  demographicTurnout: DemographicTurnoutData | null;
}
