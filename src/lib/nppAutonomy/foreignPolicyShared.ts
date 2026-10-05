import { ObjectId } from "mongodb";
import { type AlignmentPoleId } from "@/lib/constants/alignmentEras";
import { type CountryId } from "@/lib/constants/countries";
import { FOREIGN_AFFAIRS_POSITION_BY_COUNTRY } from "@/lib/constants/internationalOrganizations";
import { type OrganizationCategory } from "@/lib/constants/orgCategory";
import type { NPP, NppForeignPolicyMode, NppForeignPolicyStage } from "@/lib/db/types";
import type { CountryAlignment } from "@/lib/db/types/countryAlignment";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { BattleDeclarationDoc } from "@/lib/db/types/battleDeclaration";
import type {
  OrganizationLeadershipElection,
  OrganizationLegislation,
  OrganizationMembership,
  OrganizationMembershipProposal,
  ProposalVoteRecord,
} from "@/lib/db/types/internationalOrganization";
import type { Tariff } from "@/lib/db/types/tariff";
import type { TradeEmbargo } from "@/lib/db/types/tradeEmbargo";
import type { TradeFlowSnapshot } from "@/lib/db/types/tradeFlowSnapshot";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { PeaceOfferDoc } from "@/lib/db/types/peaceOffer";
import type { PersistedSphereMembership } from "@/lib/world/spheres/membershipStore";

export type ForeignPolicyMode = NppForeignPolicyMode;

export type ForeignPolicyActionType =
  | "vote_org_yes"
  | "vote_org_no"
  | "propose_fta"
  | "propose_sanctions"
  | "propose_aid"
  | "endorse_country"
  | "condemn_country"
  | "raise_tariff"
  | "lower_tariff"
  | "impose_embargo"
  | "lift_embargo"
  | "support_war"
  | "join_war"
  | "conduct_war"
  | "seek_peace";

export interface ForeignPolicyChoice {
  type: ForeignPolicyActionType;
  score: number;
  targetCountryId?: CountryId;
  organizationId?: string;
  conflictId?: string;
  conflictSide?: "A" | "B";
  pendingItemId?: string;
  pendingKind?: "membership" | "legislation" | "leadership";
  reasons: string[];
}

export interface ForeignPolicyResult {
  ran: boolean;
  mode: ForeignPolicyMode;
  acted: boolean;
  decisionRecorded: boolean;
  choice: ForeignPolicyChoice | null;
  /** Ballots cast this turn, which do not compete for the action slot. */
  ballotsCast: number;
  skipReason?: "inactive" | "off" | "no-government" | "no-choice";
}

export interface OpinionFactor {
  key: string;
  value: number;
  reason: string;
}

export interface CountryOpinion {
  targetCountryId: CountryId;
  score: number;
  tradeDependence: number;
  factors: OpinionFactor[];
}

export interface ForeignPolicyContext {
  countryId: CountryId;
  currentTurn: number;
  mode: ForeignPolicyMode;
  stage: NppForeignPolicyStage;
  head: NPP;
  alignments: CountryAlignment[];
  spheres: PersistedSphereMembership[];
  memberships: OrganizationMembership[];
  organizationCategories: Map<string, OrganizationCategory>;
  poleLeaders: Map<AlignmentPoleId, CountryId>;
  conflicts: ConflictDoc[];
  embargoes: TradeEmbargo[];
  tariffs: Tariff[];
  pendingTariffTargets: Set<CountryId>;
  activeResolutions: OrganizationLegislation[];
  pendingMemberships: OrganizationMembershipProposal[];
  pendingLegislation: OrganizationLegislation[];
  pendingLeadership: OrganizationLeadershipElection[];
  tradeSnapshot: TradeFlowSnapshot | null;
  debtToGdpRatio: number;
  recentDecisions: PersistedForeignPolicyDecision[];
  availableMilitaryUnits: number;
  averageMilitaryReadiness: number;
  approvalRating: number;
  militaryUnits: MilitaryUnit[];
  pendingBattleDeclarations: BattleDeclarationDoc[];
  pendingPeaceOffers: PeaceOfferDoc[];
  /**
   * Admin switch for `conduct_war`. False suppresses the candidate outright rather
   * than refusing it at execution, so the country ranks its remaining options and
   * spends the slot on one of them instead of burning a whole Tier-1 slot on a refusal.
   */
  offensiveInitiationEnabled: boolean;
}

export interface PersistedForeignPolicyDecision {
  _id: ObjectId;
  countryId: CountryId;
  turn: number;
  mode: ForeignPolicyMode;
  stage: NppForeignPolicyStage;
  headNppId: ObjectId;
  headNppName: string;
  selected: ForeignPolicyChoice | null;
  alternatives: ForeignPolicyChoice[];
  /**
   * Ballots cast this turn. Separate from `selected` because voting is not the
   * country's one strategic action — see `processAutonomousForeignPolicy`.
   */
  ballots?: ForeignPolicyChoice[];
  /** How many of `ballots` the write path actually landed. */
  ballotsCast?: number;
  acted: boolean;
  executionStatus: "planned" | "claimed" | "executed" | "rejected" | "no_action";
  executionNote: string;
  createdAt: Date;
}

export const DECISION_COLLECTION = "nppForeignPolicyDecisions";
export const MINIMUM_ACTION_SCORE = 25;
export const MAX_ALTERNATIVES = 5;
/**
 * Priority floor for the two choices an active belligerent makes about a war it
 * is already fighting: `conduct_war` and `seek_peace`. Only the single
 * top-ranked choice acts, and routine diplomacy scores in the 46-73 band (org
 * votes 46-86, hostile tariffs to 68, embargoes to 73), so war actions based at
 * 25 and 38 could never win a slot against any pending vote or hostile
 * neighbour. That starved the whole war stage: production recorded 205
 * autonomous decisions with zero `conduct_war` and zero `seek_peace` selections
 * while NATO members sat deployed and ready in an active war, so allies joined
 * the roster but never once attacked (ticket #1233). War conduct now starts
 * above the routine band; the readiness/approval gates, the 6-turn conduct
 * cooldown, and `seek_peace`'s pressure terms remain the restraint.
 */
export const BELLIGERENT_WAR_ACTION_BASE = 60;
export const STANDARD_COOLDOWN_TURNS = 24;
export const TRADE_ESCALATION_COOLDOWN_TURNS = 48;
export const FOREIGN_POLICY_COUNTRIES = (
  Object.keys(FOREIGN_AFFAIRS_POSITION_BY_COUNTRY) as CountryId[]
).filter((countryId) => FOREIGN_AFFAIRS_POSITION_BY_COUNTRY[countryId] !== null);

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, places = 2): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

export function alreadyVoted(
  votes: ProposalVoteRecord[] | undefined,
  countryId: CountryId
): boolean {
  return (votes ?? []).some((vote) => vote.countryId === countryId);
}

export function memberOrganizations(
  memberships: OrganizationMembership[],
  countryId: CountryId
): Set<string> {
  return new Set(
    memberships
      .filter((membership) => membership.countryId === countryId)
      .map((membership) => membership.organizationId)
  );
}

export function alignmentSimilarity(
  source: CountryAlignment | undefined,
  target: CountryAlignment | undefined
): number | null {
  if (!source || !target || source.eraKey !== target.eraKey) return null;
  const poles = new Set<AlignmentPoleId>([
    ...(Object.keys(source.shares) as AlignmentPoleId[]),
    ...(Object.keys(target.shares) as AlignmentPoleId[]),
  ]);
  let distance = Math.abs(source.nonAligned - target.nonAligned);
  for (const pole of poles) {
    distance += Math.abs((source.shares[pole] ?? 0) - (target.shares[pole] ?? 0));
  }
  return clamp(1 - distance / 200, 0, 1);
}

export function bilateralTradeDependence(
  snapshot: TradeFlowSnapshot | null,
  sourceCountryId: CountryId,
  targetCountryId: CountryId
): number {
  if (!snapshot) return 0;
  let bilateral = 0;
  for (const commodity of Object.values(snapshot.commodities)) {
    if (!commodity) continue;
    bilateral += commodity.flow[sourceCountryId]?.[targetCountryId] ?? 0;
    bilateral += commodity.flow[targetCountryId]?.[sourceCountryId] ?? 0;
  }
  const national = snapshot.national[sourceCountryId];
  const total = (national?.exports ?? 0) + (national?.imports ?? 0);
  return total > 0 ? clamp(bilateral / total, 0, 1) : 0;
}

export function conflictRelationship(
  conflicts: ConflictDoc[],
  sourceCountryId: CountryId,
  targetCountryId: CountryId
): "same" | "opposed" | null {
  for (const conflict of conflicts) {
    const sourceSide = conflict.sideA.countries.includes(sourceCountryId)
      ? "A"
      : conflict.sideB.countries.includes(sourceCountryId)
        ? "B"
        : null;
    const targetSide = conflict.sideA.countries.includes(targetCountryId)
      ? "A"
      : conflict.sideB.countries.includes(targetCountryId)
        ? "B"
        : null;
    if (sourceSide && targetSide) return sourceSide === targetSide ? "same" : "opposed";
  }
  return null;
}

export function activeEmbargo(embargo: TradeEmbargo, currentTurn: number): boolean {
  return embargo.expiresTurn == null || embargo.expiresTurn >= currentTurn;
}

export function opinionReasons(opinion: CountryOpinion, limit = 3): string[] {
  return [...opinion.factors]
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, limit)
    .map((factor) => factor.reason);
}
