// Coalition system types shared between server-side helpers (e.g. priorityApi)
// and the coalition UI under src/app/country/[code]/parties.
//
// Lives in lib/ so domain code never has to reach into src/app for types.
// The app-layer file at src/app/country/[code]/parties/coalitionTypes.ts is a
// re-export shim kept for backward compatibility with existing UI imports.

export interface CoalitionMemberParty {
  partyId: number;
  partyObjectId: string;
  name: string;
  abbreviation: string;
  color: string;
  logoUrl?: string;
  memberCount: number;
  joinedAt: string;
  chairName: string;
  chairId: string | null;
  isCoalitionChair: boolean;
  /** Regime status of the member party (one-party-state countries only). */
  regimeStatus?: "ruling" | "approved" | "banned" | null;
}

export interface CoalitionListItem {
  id: string;
  sequentialId: number;
  countryId: "US" | "UK" | "DE" | "JP";
  name: string;
  abbreviation: string;
  color: string;
  logoUrl?: string;
  discordInviteUrl?: string | null;
  chairName: string;
  partyCount: number;
  totalMembers: number;
  memberParties: {
    partyId: number;
    name: string;
    abbreviation: string;
    color: string;
    memberCount: number;
    joinedAt: string;
  }[];
  createdAt: string;
}

export interface CoalitionDetail {
  id: string;
  sequentialId: number;
  countryId: "US" | "UK" | "DE" | "JP";
  name: string;
  abbreviation: string;
  color: string;
  logoUrl?: string;
  discordInviteUrl?: string | null;
  chairPartySequentialId: number;
  chairCharacterId: string;
  chairName: string;
  economicPosition: number;
  socialPosition: number;
  members: CoalitionMemberParty[];
  pendingInvites: {
    partyId: number;
    partyName: string;
    invitedAt: string;
  }[];
  joinRequests: {
    partyId: number;
    partyName: string;
    requestedAt: string;
  }[];
  disbandVote: {
    initiatedAt: string;
    expiresAt: string;
    /** Turn the vote auto-resolves (turn-first countdown). Null on legacy votes. */
    expiresOnTurn?: number | null;
    votes: {
      partyId: number;
      vote: "yes" | "no";
      votedAt: string;
    }[];
    totalMembers: number;
    yesCount: number;
    noCount: number;
  } | null;
  partyCount: number;
  totalMembers: number;
  createdAt: string;
}

export type CoalitionPriorityType = "policy_theme" | "bill" | "leadership_goal";

export type CoalitionPriorityVisibility = "public" | "internal";

export type CoalitionPriorityStatus = "proposed" | "active" | "archived" | "rejected" | "expired";

export type CoalitionPriorityVote = "support" | "oppose" | "abstain";

export interface CoalitionPriorityPartyStance {
  partyId: number;
  partyObjectId: string;
  partyName: string;
  abbreviation: string;
  color: string;
  chairName: string | null;
  vote: CoalitionPriorityVote | null;
  votedAt: string | null;
}

export interface CoalitionPriorityItem {
  id: string;
  type: CoalitionPriorityType;
  visibility: CoalitionPriorityVisibility;
  status: CoalitionPriorityStatus;
  stance: "support" | "oppose";
  title: string;
  description: string;
  policyThemeKey?: string | null;
  policyThemeLabel?: string | null;
  billId?: string | null;
  billTitle?: string | null;
  leadershipGoalKey?: string | null;
  leadershipGoalLabel?: string | null;
  targetName?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
  activatedAt?: string | null;
  resolvedAt?: string | null;
  createdByName: string | null;
  tally: {
    support: number;
    oppose: number;
    abstain: number;
    requiredToPass: number;
  };
  partyStances: CoalitionPriorityPartyStance[];
}

export interface CoalitionPrioritiesPayload {
  cohesion: {
    score: number;
    label: "Strong" | "Mixed" | "Fractured" | "Unaligned";
    activePriorityCount: number;
    supportVotes: number;
    opposeVotes: number;
    abstainVotes: number;
  };
  viewer: {
    isAdmin: boolean;
    isCoalitionChair: boolean;
    isMemberParty: boolean;
    isMemberPartyChair: boolean;
    canPropose: boolean;
    canVote: boolean;
    canViewInternal: boolean;
    partySequentialId: number | null;
  };
  priorities: {
    active: CoalitionPriorityItem[];
    proposed: CoalitionPriorityItem[];
    archived: CoalitionPriorityItem[];
  };
  options: {
    policyThemes: { key: string; label: string }[];
    leadershipGoals: { key: string; label: string }[];
    bills: {
      id: string;
      title: string;
      chamber: string;
      status: string;
    }[];
  };
}
