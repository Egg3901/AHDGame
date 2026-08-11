import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";

export interface CoalitionMember {
  partyId: ObjectId;
  partySequentialId: number;
  joinedAt: Date;
}

export interface CoalitionInvite {
  partyId: ObjectId;
  invitedBy: ObjectId;
  invitedAt: Date;
}

export interface CoalitionJoinRequest {
  partyId: ObjectId;
  requestedBy: ObjectId;
  requestedAt: Date;
}

export interface CoalitionDisbandVoteEntry {
  partyId: ObjectId;
  characterId: ObjectId;
  vote: "yes" | "no";
  votedAt: Date;
}

export interface CoalitionDisbandVote {
  initiatedBy: ObjectId;
  initiatedAt: Date;
  expiresAt: Date;
  /** Game-clock turn on which the disband vote auto-resolves. Server uses this. */
  expiresOnTurn?: number;
  votes: CoalitionDisbandVoteEntry[];
}

export type CoalitionPriorityType = "policy_theme" | "bill" | "leadership_goal";

export type CoalitionPriorityVisibility = "public" | "internal";

export type CoalitionPriorityStatus = "proposed" | "active" | "archived" | "rejected" | "expired";

export type CoalitionPriorityStance = "support" | "oppose";

export type CoalitionPriorityPartyVote = "support" | "oppose" | "abstain";

export type CoalitionLeadershipGoalKey =
  | "speaker"
  | "lower_chamber_leadership"
  | "upper_chamber_leadership"
  | "government_formation"
  | "cabinet_formation"
  | "no_confidence";

export interface CoalitionPriorityVoteEntry {
  partyId: ObjectId;
  chairCharacterId: ObjectId;
  vote: CoalitionPriorityPartyVote;
  votedAt: Date;
}

export interface CoalitionPriority {
  id: string;
  type: CoalitionPriorityType;
  visibility: CoalitionPriorityVisibility;
  status: CoalitionPriorityStatus;
  stance: CoalitionPriorityStance;
  title: string;
  description: string;
  policyThemeKey?: string | null;
  billId?: ObjectId | null;
  billTitle?: string | null;
  leadershipGoalKey?: CoalitionLeadershipGoalKey | null;
  targetName?: string | null;
  /**
   * Leadership goals auto-expire against their target window. This is optional
   * for policy themes, and required for leadership goals in the first pass.
   */
  expiresAt?: Date | null;
  /** Game-clock turn on which the priority auto-expires. Server uses this. */
  expiresOnTurn?: number | null;
  votes: CoalitionPriorityVoteEntry[];
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
  activatedAt?: Date | null;
  resolvedAt?: Date | null;
  resolvedBy?: ObjectId | null;
}

export interface Coalition {
  _id: ObjectId;
  sequentialId: number;
  countryId: CountryId;
  name: string;
  abbreviation: string;
  color: string;
  logoUrl?: string;
  discordInviteUrl?: string | null;
  chairPartyId: ObjectId;
  /** Null when the chair seat is vacant (leader banned or stepped down, #3234). */
  chairCharacterId: ObjectId | null;
  members: CoalitionMember[];
  pendingInvites: CoalitionInvite[];
  joinRequests: CoalitionJoinRequest[];
  disbandVote?: CoalitionDisbandVote | null;
  priorities?: CoalitionPriority[];
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
