import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CommodityType } from "@/lib/constants/commodities";
import type { InternationalOrganizationId } from "@/lib/constants/internationalOrganizations";
import type { AlertPosture } from "@/lib/constants/orgPosture";
import type { InternationalActionType } from "./legislation";
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";

/**
 * An organisation member. Any entity in the game may belong to one: playable
 * countries, full countries an admin has not enabled for players, and macro-tier
 * entities alike.
 *
 * Widened from CountryId rather than renamed, because every CountryId already IS
 * a WorldEntityId — so no document changes and no migration. The field keeps the
 * name `countryId` deliberately: Jordan is a country, just not a playable one.
 */
export type OrgMemberId = WorldEntityId;

/**
 * An entity's current membership in an international organization.
 * One document per (organizationId, countryId) pair. Status "founding" is set
 * by the seed; "active" is set after a successful join proposal.
 *
 * Membership is open to any entity in the game; voting, leadership and dues
 * belong to player-enabled countries, and everyone else pays tribute and is
 * silent. See `orgMembership.ts`.
 */
export interface OrganizationMembership {
  _id: ObjectId;
  organizationId: InternationalOrganizationId;
  countryId: OrgMemberId;
  status: "founding" | "active";
  joinedAt: Date;
  joinedTurn: number;
  /**
   * First turn this member's share in its org's pole fell to the leave threshold,
   * or null/absent while it stands. Cleared the moment it recovers, so leaving
   * needs a SUSTAINED run rather than a cumulative tally. Only ever set for orgs
   * that have an alignment channel.
   */
  wantsOutSinceTurn?: number | null;
}

/**
 * Tombstone marking a deliberate withdrawal from an organization. One document
 * per (organizationId, countryId) that has left. Consulted by the founding-member
 * self-heal (`ensureFoundingMembershipsAndLeadership` / `seedInternationalOrganizations`)
 * so a founding member that withdrew is NOT silently re-added on the next view
 * load or reseed. Cleared when the country legitimately re-joins; wiped on world reset.
 */
export interface OrganizationWithdrawal {
  _id: ObjectId;
  organizationId: InternationalOrganizationId;
  countryId: CountryId;
  withdrawnTurn: number;
  withdrawnAt: Date;
}

export type ProposalVote = "yes" | "no" | "abstain";

export interface ProposalVoteRecord {
  countryId: CountryId;
  characterId: ObjectId;
  characterName: string;
  vote: ProposalVote;
  castAt: Date;
  castOnTurn: number;
}

/**
 * A foreign minister's request that their country be admitted to an org.
 * Voting window is 24 turns; resolution requires unanimous "yes" from all
 * current members (abstain or no-vote both count as non-approval).
 */
export interface OrganizationMembershipProposal {
  _id: ObjectId;
  organizationId: InternationalOrganizationId;
  proposingCountryId: CountryId;
  proposedByCharacterId: ObjectId;
  proposedByCharacterName: string;
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled";
  votes: ProposalVoteRecord[];
  proposedAt: Date;
  proposedOnTurn: number;
  closesOnTurn: number;
  resolvedAt?: Date;
  resolvedOnTurn?: number;
  /** Parallel-join: the linked domestic Join bill (both must pass to admit). */
  domesticBillId?: ObjectId;
  /** Set true/false when the unanimous member vote resolves. */
  orgApproved?: boolean;
  /**
   * True when the application was filed while the org had 0 members: the
   * unanimous member vote is waived (orgApproved is pre-set true at insert)
   * and only the domestic Join bill decides admission. The turn resolver must
   * NOT recompute orgApproved for exempt proposals.
   */
  orgVoteExempt?: boolean;
  /** Set true/false when the linked Join bill passes/fails. */
  domesticApproved?: boolean;
  /** Reason recorded if the application is cancelled by the counterpart side. */
  cancelledReason?: string;
}

/**
 * Resolution types an international organization can pass. `free_trade_agreement`
 * is the original (and, through Phase 1, the only proposable) type, which when
 * ratified zeros all tariffs between the named parties (a subset of current
 * members). The others are modeled here so the turn-phase dispatch and passage
 * rules can branch on them — their proposal surfaces + effects land in Phase 2.
 */
export type OrganizationResolutionType =
  | "free_trade_agreement"
  | "sanctions"
  | "directive"
  | "joint_statement"
  | "aid_package"
  | "set_dues"
  | "set_posture"
  | "fund_agency";

/** @deprecated Use `OrganizationResolutionType`. Kept so existing imports compile. */
export type OrganizationLegislationType = OrganizationResolutionType;

export interface OrganizationLegislation {
  _id: ObjectId;
  organizationId: InternationalOrganizationId;
  type: OrganizationResolutionType;
  title: string;
  description?: string;
  /** Subset of current org members the legislation binds (FTA parties). */
  parties: CountryId[];
  /** `sanctions`: the country the bloc embargoes. */
  sanctionsTargetCountryId?: CountryId;
  /** `sanctions`: the single commodity embargoed (or "all"). */
  sanctionsCommodity?: CommodityType | "all";
  /** `sanctions`: turn the embargoes auto-lift and the resolution terminates. */
  sanctionsExpiresOnTurn?: number;
  /** `aid_package`: member funding the transfer. */
  aidDonorCountryId?: CountryId;
  /** `aid_package`: member receiving the transfer. */
  aidRecipientCountryId?: CountryId;
  /** `aid_package`: transfer size in the org fund's (founding) currency. */
  aidAmount?: number;
  /** `set_dues`: proposed new annual dues rate (fraction of member GDP). */
  duesRateAnnual?: number;
  /** `directive`: catalog key (see `DIRECTIVE_CATALOG`) of the bloc policy passed. */
  directiveKey?: string;
  /** `directive`: turn the directive auto-terminates and its metric nudge lifts. */
  directiveExpiresOnTurn?: number;
  /** `joint_statement`: the country the declaration is about. */
  jointStatementSubjectCountryId?: CountryId;
  /** `joint_statement`: whether the bloc endorses or condemns the subject. */
  jointStatementStance?: "endorse" | "condemn";
  /** `joint_statement`: turn the approval effect lifts and the statement terminates. */
  jointStatementExpiresOnTurn?: number;
  /** `set_posture`: the alliance alert posture the resolution sets when it passes. */
  postureValue?: AlertPosture;
  /** `fund_agency`: catalog key (see `AGENCY_CATALOG`) of the programme funded. */
  agencyKey?: string;
  /** `fund_agency`: turn the programme's effect lapses and the resolution terminates. */
  agencyExpiresOnTurn?: number;
  proposingCountryId: CountryId;
  proposedByCharacterId: ObjectId;
  proposedByCharacterName: string;
  status: "pending" | "active" | "rejected" | "expired" | "terminated";
  votes: ProposalVoteRecord[];
  proposedAt: Date;
  proposedOnTurn: number;
  closesOnTurn: number;
  enactedAt?: Date;
  enactedOnTurn?: number;
  terminatedAt?: Date;
}

export interface PendingOrganizationWithdrawalMeasure {
  billId: ObjectId;
  targetType: InternationalActionType;
  targetCountryId: CountryId;
  organizationId: InternationalOrganizationId;
  organizationLegislationId?: ObjectId;
  organizationLegislationTitle?: string;
}

/**
 * Currently held leadership of an org. One document per organizationId. Absent
 * (or `holderCharacterId === null`) means the seat is vacant.
 */
export interface OrganizationLeadership {
  _id: ObjectId;
  organizationId: InternationalOrganizationId;
  holderCharacterId: ObjectId | null;
  holderCharacterName: string | null;
  holderCountryId: CountryId | null;
  electedAt: Date | null;
  electedOnTurn: number | null;
  termEndsOnTurn: number | null;
  updatedAt: Date;
}

/**
 * An election to fill an org's leadership position. Resolved by simple majority
 * of current members at `closesOnTurn`; ties leave the seat unchanged.
 */
export interface OrganizationLeadershipElection {
  _id: ObjectId;
  organizationId: InternationalOrganizationId;
  candidateCharacterId: ObjectId;
  candidateCharacterName: string;
  candidateCountryId: CountryId;
  nominatedByCharacterId: ObjectId;
  nominatedByCharacterName: string;
  nominatedByCountryId: CountryId;
  status: "pending" | "elected" | "rejected" | "expired";
  votes: ProposalVoteRecord[];
  proposedAt: Date;
  proposedOnTurn: number;
  closesOnTurn: number;
  resolvedAt?: Date;
  resolvedOnTurn?: number;
}
