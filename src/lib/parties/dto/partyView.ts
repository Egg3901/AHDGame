import type { CountryId } from "@/lib/constants/countries";
import type { NationalPartyElectionPosition } from "@/lib/db/types";
import type { PositionShiftAxis, RetiredPositionShiftAxis } from "@/lib/db/types/committeeProposal";
import type { TreasuryPresetId } from "@/lib/treasury/partyTreasuryPresets";

export interface PartyLeader {
  id: string;
  sequentialId?: number;
  name: string;
  avatarUrl?: string;
}

export interface PartyMember {
  id: string;
  sequentialId?: number;
  name: string;
  homeState: string;
  currentOffice: { type: string; state?: string; seatsHeld?: number } | null;
  isNPP?: boolean;
  partyInfluence?: number;
}

export interface PartyJoinRequestView {
  /** Requesting character's ObjectId (as a string) — the accept/decline payload. */
  characterId: string;
  characterName: string;
  /** ISO-8601 instant the request was filed. */
  requestedAt: string;
}

export interface PartyData {
  id: string;
  name: string;
  abbreviation: string;
  color: string;
  discordInviteUrl?: string | null;
  economicPosition: number;
  socialPosition: number;
  chair: PartyLeader | null;
  viceChair: PartyLeader | null;
  treasurer: PartyLeader | null;
  /** Up to 3 committee-confirmed campaigners. May be empty. */
  campaigners: PartyLeader[];
  committeeIds: string[];
  treasury: number;
  nationalTaxRate: number;
  expectedHourlyIncome: number;
  gotvBudgetPercent: number;
  gotvEstimatedSpend: number;
  gotvTargetCategory: string | null;
  gotvTargetGroup: string | null;
  suppressionBudgetPercent: number;
  suppressionEstimatedSpend: number;
  suppressionTargetCategory: string | null;
  suppressionTargetGroup: string | null;
  /** Voter-registration drive budget (player suggestion #81). */
  registrationBudgetPercent: number;
  registrationEstimatedSpend: number;
  transferReserveAmount: number;
  memberSupportReserveAmount: number;
  nppRecruitmentReserveAmount: number;
  treasuryPreset: TreasuryPresetId;
  totalReserveTarget: number;
  discretionaryTreasury: number;
  netHourlyTreasuryChange: number;
  turnsUntilZero: number | null;
  turnsUntilReserveFloor: number | null;
  turnsToReachReserveFloor: number | null;
  politicalStrength: number;
  /** Optional per-party PS cap override (Phase 3); null falls back to formula default. */
  politicalStrengthCap?: number | null;
  /**
   * Tier-resolved effective PS cap the turn engine enforces — Major → full
   * national cap; Minor → `100 + 10×earned-regions` (clamped); explicit
   * override wins. Use this as the header denominator, not the national cap.
   */
  effectivePsCap: number;
  /** Dedicated NPP Action Points pool (national scope) — sole currency for NPP work. */
  nppActionPoints: number;
  nppActionPointCap: number;
  nppActionPointRegen: number;
  /** Chair-set per-turn USD budget for explicit PS investment. 0 = off. */
  psInvestmentBudget: number;
  /**
   * @deprecated The "% of treasury" phantom-PS stream was removed in the
   * 2026-06-25 PS-building rebalance; the engine no longer reads this. Retained
   * on the DTO for backward compatibility only.
   */
  totalBonusActions: number;
  memberCount: number;
  isDefault: boolean;
  /** Major/Minor party tier (D5) — drives the tier badge + national PS cap. */
  tier?: "major" | "minor";
  /**
   * Active Major→Minor demotion warning (D5). Present while the party is at risk;
   * the page shows a countdown (`startedTurn + grace − currentTurn`).
   */
  majorDemotionWarning?: { startedTurn: number } | null;
  /**
   * Regime status for parties in countries with `governmentType: "onePartyState"`
   * (currently CN). `null` in non-one-party countries. See
   * `docs/design/ruling-party-confidence.md` for the three-tier model.
   */
  regimeStatus?: "ruling" | "approved" | "banned" | null;
  countryId: CountryId;
  createdAt: string;
  members: PartyMember[];
  logoUrl?: string;
  /** Turn on which the party's last member purge occurred (undefined = never purged) */
  lastPurgeAtTurn?: number;
  /** Current game turn — used by the chair UI to compute purge cooldown remaining */
  currentTurn?: number;
  /** True when this party has been dissolved via a merge */
  isDefunct?: boolean;
  defunctAtTurn?: number;
  /** How national leadership elections are decided */
  leadershipElectionMethod?: "party" | "committee" | "influence";
  /**
   * Membership gate (suggestion #72). "open" (or absent) — joins take effect
   * immediately. "approval" — joins file a pending request for a party leader
   * to accept or decline.
   */
  membershipMode?: "open" | "approval";
  /**
   * Pending join requests while `membershipMode` is "approval". Surfaced to
   * leaders in the Chair Office; empty when the party is open or has none.
   */
  pendingJoinRequests?: PartyJoinRequestView[];
}

export interface CommitteeMember {
  id: string;
  sequentialId?: number;
  name: string;
}

export interface CommitteeCandidate {
  id: string;
  characterId: string;
  sequentialId?: number;
  characterName: string;
  voteCount: number;
  isCurrentCommittee: boolean;
}

export interface CommitteeElection {
  id: string;
  status: "voting" | "completed" | "cancelled";
  startTime: string;
  endTime: string;
  startTurn: number;
  endTurn: number;
  durationTurns: number;
  candidates: CommitteeCandidate[];
  totalVoters: number;
  winnerIds: string[];
}

export interface CommitteeData {
  committeeMembers: CommitteeMember[];
  committeeSize: number;
  election: CommitteeElection | null;
  canVote: boolean;
  canRun: boolean;
  /**
   * ISO-8601 instant the viewer's 24h new-character cooldown unblocks at,
   * or `null` when not blocked / no viewer. Wall-clock based — see
   * `src/lib/auth/newCharacterCooldown.ts`. Committee path uses the default
   * `includePartyJoinedAt: true`, matching the committee/enter route.
   */
  runCooldownUntil: string | null;
  userVotes: string[];
  isCandidate: boolean;
  electionDuration: number;
}

export interface PartyViewerData {
  username: string;
  isAdmin: boolean;
  isModerator?: boolean;
  hasCharacter: boolean;
  character?: {
    id: string;
    party: string;
    homeState: string;
    funds?: number;
    countryId?: CountryId;
  };
}

export type NationalPosition = "chair" | "viceChair" | "treasurer";
export type Position = NationalPosition;

export interface NationalCandidate {
  id: string;
  characterId: string;
  sequentialId?: number;
  characterName: string;
  voteCount: number;
  isCurrentHolder: boolean;
}

export interface NationalElectionEntry {
  id: string;
  position: NationalPartyElectionPosition;
  positionLabel: string;
  status: "voting" | "completed" | "cancelled";
  startTime: string;
  endTime: string;
  startTurn: number;
  endTurn: number;
  durationTurns: number;
  candidates: NationalCandidate[];
  totalVotes: number;
  winnerId: string | null;
  winnerName: string | null;
}

export interface NationalElectionsState {
  elections: Record<NationalPosition, NationalElectionEntry | null>;
  currentHolders: Record<NationalPosition, string | null>;
  canVote: boolean;
  canRun: boolean;
  /** How national leadership elections are tallied (defaults to "party" when absent). */
  leadershipElectionMethod?: "party" | "committee" | "influence";
  /**
   * ISO-8601 instant the viewer's 24h new-character cooldown unblocks at,
   * or `null` when not blocked / no viewer. Officer leadership path passes
   * `includePartyJoinedAt: false` so country/party moves don't re-block
   * veteran players — see `src/lib/auth/newCharacterCooldown.ts`.
   */
  runCooldownUntil: string | null;
  userVotes: Record<NationalPosition, { candidateId: string; candidateName: string } | null>;
  isCandidate: Record<NationalPosition, boolean>;
}

export interface PartyActivityFeedLink {
  tab: string;
  subPath?: string;
}

export interface PartyActivityFeedItem {
  id: string;
  type: "treasury" | "slate";
  createdAt: string;
  summary: string;
  detail?: string;
  link?: PartyActivityFeedLink;
}

export interface PartyActivityFeedResponse {
  items: PartyActivityFeedItem[];
  nextBefore: string | null;
}

export interface PartySlateStateAggregate {
  state: string;
  slateCount: number;
  byStatus: { invited: number; accepted: number; declined: number; filed: number };
  highPriority: number;
  contested: number;
}

export interface PartySlateOverviewItem {
  id: string | null;
  electionId: string;
  electionType: string;
  senateClass: number | null;
  chamberClass: number | null;
  electionStatus: string | null;
  electionCycle: number | null;
  electionPrimaryEndTime: string | null;
  state: string;
  priority: string;
  notes: string | null;
  archivedAt: string | null;
  candidateCounts: {
    invited: number;
    considering: number;
    accepted: number;
    declined: number;
    withdrawn: number;
    filed: number;
  };
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PartySlateOverviewResponse {
  items: PartySlateOverviewItem[];
  stateAggregates: PartySlateStateAggregate[];
}

export interface NationalPartyInfluenceActionView {
  type: string;
  name: string;
  description: string;
  actionCost: number;
  baseFundCost: number;
  baseChance: number;
  available: boolean;
  unavailableReason?: string;
}

export interface ProposalVoteSummary {
  yes: number;
  no: number;
  notVoted: number;
}

export interface ProposalView {
  id: string;
  type:
    | "rename"
    | "positionShift"
    | "merge"
    | "electionMethod"
    | "electionDuration"
    | "removeOfficeHolder"
    | "transactionApprovalMode"
    | "campaignerAppointment";
  status: "open" | "passed" | "rejected" | "expired";
  proposedBy: string;
  proposedByName: string;
  createdAtTurn: number;
  expiresAtTurn: number;
  resolvedAtTurn?: number;

  rename?: { newName: string; newAbbreviation: string };
  positionShift?: {
    /** New proposals are economic|social; historical rows may carry a retired axis. */
    axis: PositionShiftAxis | RetiredPositionShiftAxis;
    direction: 1 | -1;
  };
  merge?: { targetPartyId: string; targetPartyName: string };
  electionMethod?: { method: "party" | "committee" | "influence" };
  electionDuration?: { durationTurns: number };
  removeOfficeHolder?: {
    role: "chair" | "viceChair" | "treasurer" | "committeeMember" | "campaigner";
    targetCharacterId: string;
    targetCharacterName: string;
  };
  campaignerAppointment?: { targetCharacterId: string; targetCharacterName: string };
  transactionApprovalMode?: { mode: "single" | "double" };

  proposingVoteSummary: ProposalVoteSummary;
  targetVoteSummary?: ProposalVoteSummary;

  /** Authenticated viewer's vote in the proposing committee */
  myProposingVote?: "yes" | "no";
  /** Authenticated viewer's vote in the target committee (merge only) */
  myTargetVote?: "yes" | "no";
}

export interface ProposalsResponse {
  openProposals: ProposalView[];
  /** Merge proposals from other parties targeting this party */
  incomingMergeProposals: ProposalView[];
  /** Last 10 resolved/expired proposals */
  pastProposals: ProposalView[];
  /** True if viewer is a committee member of this party */
  canPropose: boolean;
  /** True if viewer is the chair of this party */
  canProposeMerge: boolean;
  /** True if viewer is eligible to vote (committee member OR national leadership) */
  canVote: boolean;
  /**
   * Party's current `transactionApprovalMode`. The
   * `transactionApprovalMode` proposal modal uses this to grey out the
   * active option (the server also rejects no-op proposals defensively).
   */
  currentTransactionApprovalMode: "single" | "double";
}

export interface NationalPartyInfluenceResponse {
  partyId: string;
  partyName: string;
  politicalStrength: number;
  treasury: number;
  /** Dedicated NPP Action Points pool (national scope) — sole currency for NPP work. */
  nppActionPoints: number;
  nppActionPointCap: number;
  nppActionPointRegen: number;
  actions: NationalPartyInfluenceActionView[];
  availableStates: string[];
  stateNames: Record<string, string>;
  targetStates: Array<{
    id: string;
    name: string;
    actionCost: number;
    fundCost: number;
    currentNPPs: number;
    maxSlots: number;
    full: boolean;
  }>;
  nppsByState: Record<string, Array<Record<string, unknown>>>;
  context: {
    activeElections: Array<{
      id: string;
      label: string;
      state: string;
      type: string;
      senateClass?: number;
    }>;
    nppCandidacies: Array<{
      electionId: string;
      candidateId: string;
      nppId?: string;
    }>;
    candidates: Array<{
      id: string;
      electionId: string;
      name: string;
      party: string;
      isNPP: boolean;
      politicalInfluence: number;
    }>;
  };
}
