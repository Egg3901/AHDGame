import { ObjectId, type Db } from "mongodb";
import { ALIGNMENT_POLES, type AlignmentPoleId } from "@/lib/constants/alignmentEras";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { FOREIGN_AFFAIRS_POSITION_BY_COUNTRY } from "@/lib/constants/internationalOrganizations";
import { canTableResolutionType, type OrganizationCategory } from "@/lib/constants/orgCategory";
import { NATIONAL_TERMINAL_STATUSES } from "@/lib/congress/billProposalLimits";
import type {
  Bill,
  BillStatus,
  NPP,
  NppForeignPolicyMode,
  NppForeignPolicyStage,
} from "@/lib/db/types";
import type { CountryAlignment } from "@/lib/db/types/countryAlignment";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { GovernmentApproval } from "@/lib/db/types/governmentApproval";
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
import { loadOrganizationDefWithPowers } from "@/lib/internationalOrganizations/service";
import { buildActiveNationalBillFilter } from "@/lib/legislature/nationalBillScope";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { PeaceOfferDoc } from "@/lib/db/types/peaceOffer";
import type { PersistedSphereMembership } from "@/lib/world/spheres/membershipStore";
import { isNppAutonomyActive } from "./featureFlag";
import { executeForeignPolicyChoice } from "./foreignPolicyActions";
import {
  foreignPolicyActionAllowed,
  foreignPolicyModeFrom,
  foreignPolicyStageFrom,
} from "./foreignPolicyRollout";
import { nppOffensiveFlagFrom } from "./offensiveFlags";
import { hostSideOf } from "@/lib/military/warEntryPolicy";

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
  skipReason?: "inactive" | "off" | "no-government" | "no-choice";
}

interface OpinionFactor {
  key: string;
  value: number;
  reason: string;
}

interface CountryOpinion {
  targetCountryId: CountryId;
  score: number;
  tradeDependence: number;
  factors: OpinionFactor[];
}

interface ForeignPolicyContext {
  countryId: CountryId;
  currentTurn: number;
  mode: ForeignPolicyMode;
  stage: NppForeignPolicyStage;
  head: NPP;
  alignments: CountryAlignment[];
  spheres: PersistedSphereMembership[];
  memberships: OrganizationMembership[];
  organizationCategories: Map<string, OrganizationCategory>;
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

interface PersistedForeignPolicyDecision {
  _id: ObjectId;
  countryId: CountryId;
  turn: number;
  mode: ForeignPolicyMode;
  stage: NppForeignPolicyStage;
  headNppId: ObjectId;
  headNppName: string;
  selected: ForeignPolicyChoice | null;
  alternatives: ForeignPolicyChoice[];
  acted: boolean;
  executionStatus: "planned" | "claimed" | "executed" | "rejected" | "no_action";
  executionNote: string;
  createdAt: Date;
}

const DECISION_COLLECTION = "nppForeignPolicyDecisions";
const MINIMUM_ACTION_SCORE = 25;
const MAX_ALTERNATIVES = 5;
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
const BELLIGERENT_WAR_ACTION_BASE = 60;
const STANDARD_COOLDOWN_TURNS = 24;
const TRADE_ESCALATION_COOLDOWN_TURNS = 48;
const FOREIGN_POLICY_COUNTRIES = (
  Object.keys(FOREIGN_AFFAIRS_POSITION_BY_COUNTRY) as CountryId[]
).filter((countryId) => FOREIGN_AFFAIRS_POSITION_BY_COUNTRY[countryId] !== null);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, places = 2): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function alreadyVoted(votes: ProposalVoteRecord[] | undefined, countryId: CountryId): boolean {
  return (votes ?? []).some((vote) => vote.countryId === countryId);
}

function memberOrganizations(
  memberships: OrganizationMembership[],
  countryId: CountryId
): Set<string> {
  return new Set(
    memberships
      .filter((membership) => membership.countryId === countryId)
      .map((membership) => membership.organizationId)
  );
}

function alignmentSimilarity(
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

function bilateralTradeDependence(
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

function conflictRelationship(
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

function activeEmbargo(embargo: TradeEmbargo, currentTurn: number): boolean {
  return embargo.expiresTurn == null || embargo.expiresTurn >= currentTurn;
}

function buildOpinion(context: ForeignPolicyContext, targetCountryId: CountryId): CountryOpinion {
  const factors: OpinionFactor[] = [];
  const sourceAlignment = context.alignments.find(
    (alignment) => alignment.entityId === context.countryId
  );
  const targetAlignment = context.alignments.find(
    (alignment) => alignment.entityId === targetCountryId
  );
  const similarity = alignmentSimilarity(sourceAlignment, targetAlignment);
  if (similarity != null) {
    const value = (similarity * 2 - 1) * 24;
    factors.push({
      key: "alignment",
      value,
      reason: `Cold War alignment compatibility contributes ${round(value)}.`,
    });
  }

  const sourceSphere = context.spheres.find((sphere) => sphere.entityId === context.countryId);
  const targetSphere = context.spheres.find((sphere) => sphere.entityId === targetCountryId);
  if (
    sourceSphere?.primarySphereId &&
    sourceSphere.primarySphereId === targetSphere?.primarySphereId
  ) {
    factors.push({
      key: "shared-sphere",
      value: 18,
      reason: `Both countries share the ${sourceSphere.primarySphereId} sphere.`,
    });
  }
  const directSphere = sourceSphere?.relationships.find(
    (relationship) => relationship.sponsorId === targetCountryId
  );
  if (directSphere) {
    const value = 10 + directSphere.alignment * 12 + directSphere.integration * 8;
    factors.push({
      key: "sponsor-tie",
      value,
      reason: `Direct sphere alignment and integration contribute ${round(value)}.`,
    });
  }

  const sourceOrganizations = memberOrganizations(context.memberships, context.countryId);
  const targetOrganizations = memberOrganizations(context.memberships, targetCountryId);
  const sharedOrganizations = Array.from(sourceOrganizations).filter((orgId) =>
    targetOrganizations.has(orgId)
  );
  if (sharedOrganizations.length > 0) {
    const value = Math.min(18, sharedOrganizations.length * 6);
    factors.push({
      key: "shared-organizations",
      value,
      reason: `Shared membership in ${sharedOrganizations.join(", ")} contributes ${value}.`,
    });
  }

  const warRelationship = conflictRelationship(
    context.conflicts,
    context.countryId,
    targetCountryId
  );
  if (warRelationship === "same") {
    factors.push({ key: "same-war-side", value: 28, reason: "They fight on the same side." });
  } else if (warRelationship === "opposed") {
    factors.push({ key: "war-enemy", value: -75, reason: "They are opposing belligerents." });
  }

  const activeEmbargoes = context.embargoes.filter((row) =>
    activeEmbargo(row, context.currentTurn)
  );
  if (
    activeEmbargoes.some(
      (embargo) =>
        embargo.sourceCountry === context.countryId && embargo.targetCountry === targetCountryId
    )
  ) {
    factors.push({
      key: "outgoing-embargo",
      value: -28,
      reason: "The government currently embargoes this country.",
    });
  }
  if (
    activeEmbargoes.some(
      (embargo) =>
        embargo.sourceCountry === targetCountryId && embargo.targetCountry === context.countryId
    )
  ) {
    factors.push({
      key: "incoming-embargo",
      value: -36,
      reason: "This country currently embargoes the government.",
    });
  }

  for (const tariff of context.tariffs) {
    if (
      tariff.countryId === context.countryId &&
      tariff.scopeType === "origin_country" &&
      tariff.targetOriginCountryId === targetCountryId
    ) {
      const value = -Math.min(20, tariff.rate / 2);
      factors.push({
        key: "targeted-tariff",
        value,
        reason: `A targeted ${round(tariff.rate)}% tariff contributes ${round(value)}.`,
      });
    }
  }

  for (const resolution of context.activeResolutions) {
    if (
      resolution.type === "sanctions" &&
      resolution.sanctionsTargetCountryId === targetCountryId
    ) {
      factors.push({
        key: "org-sanctions",
        value: -32,
        reason: "An active organization sanctions them.",
      });
    }
    if (resolution.type === "aid_package" && resolution.aidRecipientCountryId === targetCountryId) {
      factors.push({
        key: "org-aid",
        value: 18,
        reason: "An active organization aid package supports them.",
      });
    }
    if (
      resolution.type === "joint_statement" &&
      resolution.jointStatementSubjectCountryId === targetCountryId
    ) {
      const endorse = resolution.jointStatementStance === "endorse";
      factors.push({
        key: "joint-statement",
        value: endorse ? 14 : -18,
        reason: `An active organization statement ${endorse ? "endorses" : "condemns"} them.`,
      });
    }
  }

  const tradeDependence = bilateralTradeDependence(
    context.tradeSnapshot,
    context.countryId,
    targetCountryId
  );
  if (tradeDependence > 0.01) {
    const value = tradeDependence * 14;
    factors.push({
      key: "trade-dependence",
      value,
      reason: `Bilateral trade dependence contributes ${round(value)}.`,
    });
  }

  return {
    targetCountryId,
    score: round(
      clamp(
        factors.reduce((sum, factor) => sum + factor.value, 0),
        -100,
        100
      )
    ),
    tradeDependence: round(tradeDependence, 4),
    factors,
  };
}

function opinionReasons(opinion: CountryOpinion, limit = 3): string[] {
  return [...opinion.factors]
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, limit)
    .map((factor) => factor.reason);
}

function candidate(
  type: ForeignPolicyActionType,
  score: number,
  reasons: string[],
  detail?: Pick<
    ForeignPolicyChoice,
    | "targetCountryId"
    | "organizationId"
    | "conflictId"
    | "conflictSide"
    | "pendingItemId"
    | "pendingKind"
  >
): ForeignPolicyChoice {
  return { type, score: round(score), reasons, ...detail };
}

function organizationThatCanTable(
  context: ForeignPolicyContext,
  organizationIds: string[],
  type: Parameters<typeof canTableResolutionType>[1]
): string | undefined {
  return organizationIds.find((organizationId) => {
    const category = context.organizationCategories.get(organizationId);
    return category ? canTableResolutionType(category, type) : false;
  });
}

function voteCandidates(
  context: ForeignPolicyContext,
  opinions: Map<CountryId, CountryOpinion>
): ForeignPolicyChoice[] {
  const choices: ForeignPolicyChoice[] = [];
  const sourceOrganizations = memberOrganizations(context.memberships, context.countryId);

  for (const proposal of context.pendingMemberships) {
    if (!sourceOrganizations.has(proposal.organizationId)) continue;
    if (proposal.proposingCountryId === context.countryId) continue;
    if (alreadyVoted(proposal.votes, context.countryId)) continue;
    const opinion = opinions.get(proposal.proposingCountryId);
    if (!opinion) continue;
    const yes = opinion.score >= 0;
    choices.push(
      candidate(
        yes ? "vote_org_yes" : "vote_org_no",
        48 + Math.abs(opinion.score) * 0.35,
        [
          `${proposal.organizationId} membership for ${COUNTRY_CONFIGS[proposal.proposingCountryId].name} is pending.`,
          ...opinionReasons(opinion),
        ],
        {
          targetCountryId: proposal.proposingCountryId,
          organizationId: proposal.organizationId,
          pendingItemId: proposal._id.toString(),
          pendingKind: "membership",
        }
      )
    );
  }

  for (const item of context.pendingLegislation) {
    if (!sourceOrganizations.has(item.organizationId)) continue;
    if (alreadyVoted(item.votes, context.countryId)) continue;
    if (item.type === "free_trade_agreement" && !item.parties.includes(context.countryId)) {
      continue;
    }
    let subject: CountryId | undefined;
    let support = 0;
    if (item.type === "free_trade_agreement") {
      const parties = item.parties.filter((party) => party !== context.countryId);
      if (parties.length > 0) {
        support =
          parties.reduce((sum, party) => sum + (opinions.get(party)?.score ?? 0), 0) /
          parties.length;
        subject = parties[0];
      }
    } else if (item.type === "sanctions") {
      subject = item.sanctionsTargetCountryId;
      support = -(subject ? (opinions.get(subject)?.score ?? 0) : 0);
    } else if (item.type === "aid_package") {
      subject = item.aidRecipientCountryId;
      support = subject ? (opinions.get(subject)?.score ?? 0) : 0;
    } else if (item.type === "joint_statement") {
      subject = item.jointStatementSubjectCountryId;
      const base = subject ? (opinions.get(subject)?.score ?? 0) : 0;
      support = item.jointStatementStance === "condemn" ? -base : base;
    } else if (item.type === "join_conflict") {
      const conflict = context.conflicts.find(
        (candidate) => candidate._id === item.joinConflictTheaterId
      );
      const side = item.joinConflictSide;
      if (conflict && side) {
        const allies = side === "A" ? conflict.sideA.countries : conflict.sideB.countries;
        const enemies = side === "A" ? conflict.sideB.countries : conflict.sideA.countries;
        const averageOpinion = (countries: CountryId[]) => {
          const scores = countries
            .filter((countryId) => countryId !== context.countryId)
            .map((countryId) => opinions.get(countryId)?.score)
            .filter((score): score is number => score !== undefined);
          return scores.length > 0
            ? scores.reduce((sum, score) => sum + score, 0) / scores.length
            : 0;
        };
        const collectiveDefense = hostSideOf(conflict) === side;
        support = collectiveDefense
          ? 100
          : -15 +
            averageOpinion(allies) * 0.4 -
            averageOpinion(enemies) * 0.25 +
            context.head.personality.ambition * 0.15 -
            context.head.personality.stubbornness * 0.1;
      } else {
        support = context.head.personality.ambition - context.head.personality.stubbornness * 0.25;
      }
    } else {
      support = context.head.personality.loyalty - 35;
    }
    const yes = support >= 0;
    choices.push(
      candidate(
        yes ? "vote_org_yes" : "vote_org_no",
        46 + Math.min(35, Math.abs(support) * 0.4),
        [
          `${item.organizationId} has a pending ${item.type.replace(/_/g, " ")} resolution.`,
          ...(subject && opinions.has(subject) ? opinionReasons(opinions.get(subject)!) : []),
        ],
        {
          ...(subject ? { targetCountryId: subject } : {}),
          organizationId: item.organizationId,
          pendingItemId: item._id.toString(),
          pendingKind: "legislation",
        }
      )
    );
  }

  for (const election of context.pendingLeadership) {
    if (!sourceOrganizations.has(election.organizationId)) continue;
    if (alreadyVoted(election.votes, context.countryId)) continue;
    const opinion = opinions.get(election.candidateCountryId);
    if (!opinion) continue;
    const yes = opinion.score >= -10;
    choices.push(
      candidate(
        yes ? "vote_org_yes" : "vote_org_no",
        42 + Math.abs(opinion.score) * 0.25,
        [
          `${election.candidateCharacterName} of ${COUNTRY_CONFIGS[election.candidateCountryId].name} seeks ${election.organizationId} leadership.`,
          ...opinionReasons(opinion),
        ],
        {
          targetCountryId: election.candidateCountryId,
          organizationId: election.organizationId,
          pendingItemId: election._id.toString(),
          pendingKind: "leadership",
        }
      )
    );
  }

  return choices;
}

function bilateralCandidates(
  context: ForeignPolicyContext,
  opinions: CountryOpinion[]
): ForeignPolicyChoice[] {
  const choices: ForeignPolicyChoice[] = [];
  const sourceOrganizations = memberOrganizations(context.memberships, context.countryId);
  const debtBrake = clamp(context.debtToGdpRatio / 150, 0, 1);
  const ambition = clamp(context.head.personality.ambition / 100, 0, 1);
  const stubbornness = clamp(context.head.personality.stubbornness / 100, 0, 1);
  const tradeLean = clamp(
    ((context.head.policies.domainPositions?.trade ?? context.head.policies.economic) + 100) / 200,
    0,
    1
  );

  for (const opinion of opinions) {
    const target = opinion.targetCountryId;
    const targetOrganizations = memberOrganizations(context.memberships, target);
    const sharedOrganizations = Array.from(sourceOrganizations).filter((orgId) =>
      targetOrganizations.has(orgId)
    );
    const ftaOrganization = organizationThatCanTable(
      context,
      sharedOrganizations,
      "free_trade_agreement"
    );
    const aidOrganization = organizationThatCanTable(context, sharedOrganizations, "aid_package");
    const sanctionsOrganization = organizationThatCanTable(
      context,
      sharedOrganizations,
      "sanctions"
    );
    const statementOrganization = organizationThatCanTable(
      context,
      sharedOrganizations,
      "joint_statement"
    );
    const pendingTargetedTariff = context.pendingTariffTargets.has(target);
    const reasons = opinionReasons(opinion);
    const resolutions = [...context.activeResolutions, ...context.pendingLegislation];
    const hasFta = resolutions.some(
      (item) =>
        item.type === "free_trade_agreement" &&
        item.parties.includes(context.countryId) &&
        item.parties.includes(target)
    );
    const hasAid = resolutions.some(
      (item) => item.type === "aid_package" && item.aidRecipientCountryId === target
    );
    const hasSanctions = resolutions.some(
      (item) => item.type === "sanctions" && item.sanctionsTargetCountryId === target
    );
    const hasEndorsement = resolutions.some(
      (item) =>
        item.type === "joint_statement" &&
        item.jointStatementSubjectCountryId === target &&
        item.jointStatementStance === "endorse"
    );
    const hasCondemnation = resolutions.some(
      (item) =>
        item.type === "joint_statement" &&
        item.jointStatementSubjectCountryId === target &&
        item.jointStatementStance === "condemn"
    );
    const outgoingEmbargo = context.embargoes.find(
      (embargo) =>
        embargo.sourceCountry === context.countryId &&
        embargo.targetCountry === target &&
        activeEmbargo(embargo, context.currentTurn)
    );
    const targetedTariff = context.tariffs.find(
      (tariff) =>
        tariff.countryId === context.countryId &&
        tariff.scopeType === "origin_country" &&
        tariff.targetOriginCountryId === target &&
        tariff.rate > 0
    );

    if (opinion.score >= 20 && sharedOrganizations.length > 0) {
      if (!hasFta && ftaOrganization) {
        choices.push(
          candidate(
            "propose_fta",
            15 + opinion.score * 0.45 + tradeLean * 14 + opinion.tradeDependence * 12,
            [`A shared organization can host a free trade agreement.`, ...reasons],
            { targetCountryId: target, organizationId: ftaOrganization }
          )
        );
      }
      if (!hasEndorsement && statementOrganization) {
        choices.push(
          candidate(
            "endorse_country",
            12 + opinion.score * 0.4 + ambition * 8,
            [`Relations are favorable enough for public support.`, ...reasons],
            { targetCountryId: target, organizationId: statementOrganization }
          )
        );
      }
      if (!hasAid && aidOrganization) {
        choices.push(
          candidate(
            "propose_aid",
            8 + opinion.score * 0.4 + ambition * 10 - debtBrake * 22,
            [
              `Friendly relations support aid, while debt applies a ${round(debtBrake * 22)} point brake.`,
              ...reasons,
            ],
            { targetCountryId: target, organizationId: aidOrganization }
          )
        );
      }
    }

    const hostile = Math.max(0, -opinion.score);
    if (hostile > 0) {
      if (!targetedTariff && !pendingTargetedTariff) {
        choices.push(
          candidate(
            "raise_tariff",
            10 + hostile * 0.48 + stubbornness * 10 - opinion.tradeDependence * 22,
            [
              `Hostility supports a targeted tariff, but trade dependence applies a ${round(opinion.tradeDependence * 22)} point brake.`,
              ...reasons,
            ],
            { targetCountryId: target }
          )
        );
      }
      if (!outgoingEmbargo) {
        choices.push(
          candidate(
            "impose_embargo",
            5 + hostile * 0.55 + stubbornness * 12 - opinion.tradeDependence * 30,
            [
              `Hostility supports an embargo, but trade dependence applies a ${round(opinion.tradeDependence * 30)} point brake.`,
              ...reasons,
            ],
            { targetCountryId: target }
          )
        );
      }
      if (!hasSanctions && sanctionsOrganization) {
        choices.push(
          candidate(
            "propose_sanctions",
            8 + hostile * 0.55 + ambition * 8,
            [`A shared organization can coordinate sanctions.`, ...reasons],
            { targetCountryId: target, organizationId: sanctionsOrganization }
          )
        );
      }
      if (!hasCondemnation && statementOrganization) {
        choices.push(
          candidate(
            "condemn_country",
            12 + hostile * 0.45 + ambition * 10,
            [`Relations are hostile enough for a condemnation.`, ...reasons],
            { targetCountryId: target, organizationId: statementOrganization }
          )
        );
      }
    }

    if (outgoingEmbargo && opinion.score > -15) {
      choices.push(
        candidate(
          "lift_embargo",
          28 + opinion.score * 0.35 + tradeLean * 8,
          [`Relations no longer justify the active embargo.`, ...reasons],
          { targetCountryId: target }
        )
      );
    }

    if (targetedTariff && !pendingTargetedTariff && opinion.score > 10) {
      choices.push(
        candidate(
          "lower_tariff",
          24 + opinion.score * 0.35 + tradeLean * 10,
          [`Friendly relations no longer justify the targeted tariff.`, ...reasons],
          { targetCountryId: target }
        )
      );
    }
  }

  return choices;
}

function warCandidates(
  context: ForeignPolicyContext,
  opinions: Map<CountryId, CountryOpinion>
): ForeignPolicyChoice[] {
  const choices: ForeignPolicyChoice[] = [];
  const sourceOrganizations = memberOrganizations(context.memberships, context.countryId);
  const sourceAlignment = context.alignments.find(
    (alignment) => alignment.entityId === context.countryId
  );
  const ambition = clamp(context.head.personality.ambition / 100, 0, 1);
  const debtBrake = clamp(context.debtToGdpRatio / 150, 0, 1);
  const defenseLean = clamp(
    ((context.head.policies.domainPositions?.defense ?? 0) + 100) / 200,
    0,
    1
  );

  for (const conflict of context.conflicts) {
    const ownSide = conflict.sideA.countries.includes(context.countryId)
      ? conflict.sideA
      : conflict.sideB.countries.includes(context.countryId)
        ? conflict.sideB
        : null;
    if (ownSide) {
      const enemySide = ownSide === conflict.sideA ? conflict.sideB : conflict.sideA;
      const enemyCountry = enemySide.countries.find((countryId) => COUNTRY_CONFIGS[countryId]);
      const deployed = context.militaryUnits.filter(
        (unit) => unit.theaterId === conflict._id && unit.personnel > 0
      );
      const deployedReadiness =
        deployed.length > 0
          ? deployed.reduce((sum, unit) => sum + unit.readiness, 0) / deployed.length
          : 0;
      const pendingOffensive = context.pendingBattleDeclarations.some(
        (declaration) => declaration.theaterId === conflict._id
      );
      const pendingPeace = context.pendingPeaceOffers.some(
        (offer) =>
          offer.conflictId === conflict._id &&
          offer.fromCountry === context.countryId &&
          offer.toCountry === enemyCountry &&
          offer.expiresTurn > context.currentTurn
      );
      if (
        context.offensiveInitiationEnabled &&
        deployed.length > 0 &&
        deployedReadiness >= 40 &&
        context.approvalRating >= 40 &&
        !pendingOffensive
      ) {
        choices.push(
          candidate(
            "conduct_war",
            BELLIGERENT_WAR_ACTION_BASE +
              ambition * 8 +
              defenseLean * 10 +
              (deployedReadiness - 40) * 0.2,
            [
              `${deployed.length} deployed units average ${round(deployedReadiness)} readiness in ${conflict.name}.`,
              `Government approval is ${round(context.approvalRating)}.`,
            ],
            { conflictId: conflict._id }
          )
        );
      }
      if (
        enemyCountry &&
        !pendingPeace &&
        (context.approvalRating < 35 || deployedReadiness < 35 || context.debtToGdpRatio > 140)
      ) {
        choices.push(
          candidate(
            "seek_peace",
            BELLIGERENT_WAR_ACTION_BASE +
              Math.max(0, 35 - context.approvalRating) * 0.4 +
              Math.max(0, 35 - deployedReadiness) * 0.3 +
              Math.max(0, context.debtToGdpRatio - 140) * 0.1,
            [
              `War pressure in ${conflict.name} exceeds the government's tolerance.`,
              `Approval ${round(context.approvalRating)}, deployed readiness ${round(deployedReadiness)}, debt ${round(context.debtToGdpRatio)}% of GDP.`,
            ],
            { targetCountryId: enemyCountry, conflictId: conflict._id }
          )
        );
      }
      continue;
    }
    const sideScore = (countries: CountryId[]): number =>
      countries.reduce((sum, countryId) => sum + (opinions.get(countryId)?.score ?? 0), 0) /
      Math.max(1, countries.length);
    const a = sideScore(conflict.sideA.countries);
    const b = sideScore(conflict.sideB.countries);
    const preferredSide = a >= b ? "A" : "B";
    const preferred = preferredSide === "A" ? conflict.sideA : conflict.sideB;
    const preferredScore = Math.max(a, b);
    const representative = preferred.countries.find((countryId) => COUNTRY_CONFIGS[countryId]);
    if (!representative) continue;
    const representativeOrganizations = memberOrganizations(context.memberships, representative);
    const sharedOrganizations = Array.from(sourceOrganizations).filter((orgId) =>
      representativeOrganizations.has(orgId)
    );
    const materialSupportOrganization =
      sharedOrganizations.find(
        (orgId) => context.organizationCategories.get(orgId) === "economic"
      ) ?? sharedOrganizations[0];
    const securityOrganization = sharedOrganizations.find(
      (orgId) => orgId === "NATO" || orgId === "WARSAW_PACT"
    );
    const poleSupport = sourceAlignment
      ? Object.entries(sourceAlignment.shares).reduce((best, [pole, share]) => {
          const leader = ALIGNMENT_POLES[pole as AlignmentPoleId]?.leaderCountryId;
          return preferred.countries.includes(leader as CountryId)
            ? Math.max(best, share ?? 0)
            : best;
        }, 0)
      : 0;
    const base = preferredScore * 0.35 + poleSupport * 0.25 + ambition * 10 + defenseLean * 12;
    const hasSupportPackage = [...context.activeResolutions, ...context.pendingLegislation].some(
      (item) => item.type === "aid_package" && item.aidRecipientCountryId === representative
    );
    if (materialSupportOrganization && !hasSupportPackage) {
      choices.push(
        candidate(
          "support_war",
          12 + base - debtBrake * 15,
          [
            `${preferred.label} is the more compatible side in ${conflict.name}.`,
            `Superpower influence contributes ${round(poleSupport * 0.25)}.`,
            `Debt applies a ${round(debtBrake * 15)} point support brake.`,
          ],
          {
            targetCountryId: representative,
            organizationId: materialSupportOrganization,
            conflictId: conflict._id,
          }
        )
      );
    }
    const hasJoinProposal = context.pendingLegislation.some(
      (item) =>
        item.type === "join_conflict" &&
        item.joinConflictTheaterId === conflict._id &&
        item.joinConflictSide === preferredSide
    );
    const warEntryReady =
      context.availableMilitaryUnits > 0 &&
      context.averageMilitaryReadiness >= 55 &&
      context.approvalRating >= 45 &&
      context.debtToGdpRatio <= 120;
    if (securityOrganization && !hasJoinProposal && warEntryReady) {
      choices.push(
        candidate(
          "join_war",
          -8 +
            base +
            (context.averageMilitaryReadiness - 55) * 0.25 +
            (context.approvalRating - 45) * 0.2,
          [
            `${preferred.label} is the more compatible side in ${conflict.name}.`,
            "War entry remains guarded by an alliance vote and domestic ratification.",
            `${context.availableMilitaryUnits} ready reserve units average ${round(context.averageMilitaryReadiness)} readiness with ${round(context.approvalRating)} government approval.`,
          ],
          {
            targetCountryId: representative,
            organizationId: securityOrganization,
            conflictId: conflict._id,
            conflictSide: preferredSide,
          }
        )
      );
    }
  }
  return choices;
}

function rankChoices(context: ForeignPolicyContext): ForeignPolicyChoice[] {
  const opinions = FOREIGN_POLICY_COUNTRIES.filter(
    (countryId) => countryId !== context.countryId
  ).map((countryId) => buildOpinion(context, countryId));
  const opinionMap = new Map(opinions.map((opinion) => [opinion.targetCountryId, opinion]));
  return [
    ...voteCandidates(context, opinionMap),
    ...bilateralCandidates(context, opinions),
    ...warCandidates(context, opinionMap),
  ]
    .filter(
      (choice) =>
        context.mode !== "active" || foreignPolicyActionAllowed(choice.type, context.stage)
    )
    .filter((choice) => !choiceOnCooldown(context, choice))
    .sort((a, b) => b.score - a.score || a.type.localeCompare(b.type));
}

function cooldownFamily(type: ForeignPolicyActionType): string | null {
  if (type === "vote_org_yes" || type === "vote_org_no") return null;
  if (type === "raise_tariff" || type === "lower_tariff") return "tariff";
  if (type === "impose_embargo" || type === "lift_embargo") return "embargo";
  if (type === "propose_aid" || type === "support_war") return "aid";
  if (type === "endorse_country" || type === "condemn_country") return "statement";
  return type;
}

function cooldownTurns(family: string): number {
  if (family === "tariff" || family === "embargo") return TRADE_ESCALATION_COOLDOWN_TURNS;
  if (family === "conduct_war") return 6;
  return STANDARD_COOLDOWN_TURNS;
}

function choiceOnCooldown(context: ForeignPolicyContext, choice: ForeignPolicyChoice): boolean {
  const family = cooldownFamily(choice.type);
  if (!family) return false;
  const cooldown = cooldownTurns(family);
  return context.recentDecisions.some((decision) => {
    const previous = decision.selected;
    if (!previous || decision.mode !== context.mode || decision.turn >= context.currentTurn) {
      return false;
    }
    if (
      context.currentTurn - decision.turn < 1 ||
      context.currentTurn - decision.turn >= cooldown
    ) {
      return false;
    }
    return (
      cooldownFamily(previous.type) === family &&
      previous.targetCountryId === choice.targetCountryId &&
      previous.organizationId === choice.organizationId &&
      previous.conflictId === choice.conflictId
    );
  });
}

async function loadContext(
  db: Db,
  countryId: CountryId,
  currentTurn: number
): Promise<ForeignPolicyContext | null> {
  const government = await db
    .collection<GovernmentFormation>("governmentFormations")
    .findOne({ _id: countryId });
  if (!government || government.status !== "formed") return null;
  const headNppId = government.presidentNppId ?? government.pmNppId ?? null;
  if (!headNppId) return null;
  const head = await db.collection<NPP>("npps").findOne({ _id: headNppId });
  if (!head) return null;

  const [
    gameState,
    alignments,
    spheres,
    memberships,
    conflicts,
    embargoes,
    tariffs,
    pendingTariffBills,
    activeResolutions,
    pendingMemberships,
    pendingLegislation,
    pendingLeadership,
    tradeSnapshot,
    budget,
    recentDecisions,
    militaryUnits,
    governmentApproval,
    pendingBattleDeclarations,
    pendingPeaceOffers,
  ] = await Promise.all([
    db
      .collection<{
        _id: string;
        nppForeignPolicyMode?: ForeignPolicyMode;
        nppForeignPolicyStage?: NppForeignPolicyStage;
        nppOffensiveInitiationEnabled?: boolean;
      }>("gameState")
      .findOne({ _id: "current" }),
    db.collection<CountryAlignment>("countryAlignments").find({}).toArray(),
    db.collection<PersistedSphereMembership>("sphereMemberships").find({}).toArray(),
    db.collection<OrganizationMembership>("organizationMemberships").find({}).toArray(),
    db
      .collection<ConflictDoc>("conflicts")
      .find({ status: { $in: ["active", "escalating", "winding_down"] } })
      .toArray(),
    db.collection<TradeEmbargo>("tradeEmbargoes").find({}).toArray(),
    db.collection<Tariff>("tariffs").find({}).toArray(),
    db
      .collection<Bill>("bills")
      .find({
        ...buildActiveNationalBillFilter(countryId, NATIONAL_TERMINAL_STATUSES as BillStatus[]),
        "provisions.type": "tariff",
        "provisions.scopeType": "origin_country",
      })
      .toArray(),
    db
      .collection<OrganizationLegislation>("organizationLegislation")
      .find({ status: "active" })
      .toArray(),
    db
      .collection<OrganizationMembershipProposal>("organizationMembershipProposals")
      .find({ status: "pending" })
      .toArray(),
    db
      .collection<OrganizationLegislation>("organizationLegislation")
      .find({ status: "pending" })
      .toArray(),
    db
      .collection<OrganizationLeadershipElection>("organizationLeadershipElections")
      .find({ status: "pending" })
      .toArray(),
    db.collection<TradeFlowSnapshot>("tradeFlowSnapshots").findOne({}, { sort: { turn: -1 } }),
    db
      .collection<{ countryId: CountryId; debtToGdpRatio?: number }>("federalBudget")
      .findOne({ countryId }),
    db
      .collection<PersistedForeignPolicyDecision>(DECISION_COLLECTION)
      .find({
        countryId,
        turn: { $gte: Math.max(0, currentTurn - TRADE_ESCALATION_COOLDOWN_TURNS) },
      })
      .sort({ turn: -1 })
      .limit(20)
      .toArray(),
    db.collection<MilitaryUnit>("militaryUnits").find({ countryId }).toArray(),
    db.collection<GovernmentApproval>("governmentApprovals").findOne({ _id: countryId }),
    db
      .collection<BattleDeclarationDoc>("battleDeclarations")
      .find({ declarerCountry: countryId, status: "pending" })
      .toArray(),
    db
      .collection<PeaceOfferDoc>("peaceOffers")
      .find({ fromCountry: countryId, status: "pending", expiresTurn: { $gt: currentTurn } })
      .toArray(),
  ]);

  const organizationCategories = new Map<string, OrganizationCategory>();
  const organizationIds = Array.from(
    new Set(memberships.map((membership) => membership.organizationId))
  );
  const organizationDefs = await Promise.all(
    organizationIds.map((organizationId) => loadOrganizationDefWithPowers(db, organizationId))
  );
  organizationDefs.forEach((definition, index) => {
    if (definition) organizationCategories.set(organizationIds[index], definition.category);
  });
  const pendingTariffTargets = new Set<CountryId>();
  for (const bill of pendingTariffBills) {
    for (const provision of bill.provisions ?? []) {
      if (
        provision.type === "tariff" &&
        provision.scopeType === "origin_country" &&
        provision.targetOriginCountryId
      ) {
        pendingTariffTargets.add(provision.targetOriginCountryId);
      }
    }
  }

  const readyReserveUnits = militaryUnits.filter(
    (unit) =>
      unit.theaterId === "reserve" &&
      unit.personnel > 0 &&
      unit.readiness >= 50 &&
      (unit.readyAtTurn == null || unit.readyAtTurn <= currentTurn)
  );
  const averageMilitaryReadiness =
    readyReserveUnits.length > 0
      ? readyReserveUnits.reduce((sum, unit) => sum + unit.readiness, 0) / readyReserveUnits.length
      : 0;

  return {
    countryId,
    currentTurn,
    mode: foreignPolicyModeFrom(gameState?.nppForeignPolicyMode),
    stage: foreignPolicyStageFrom(gameState?.nppForeignPolicyStage),
    head,
    alignments,
    spheres,
    memberships,
    organizationCategories,
    conflicts,
    embargoes,
    tariffs,
    pendingTariffTargets,
    activeResolutions,
    pendingMemberships,
    pendingLegislation,
    pendingLeadership,
    tradeSnapshot,
    debtToGdpRatio: budget?.debtToGdpRatio ?? 0,
    recentDecisions,
    availableMilitaryUnits: readyReserveUnits.length,
    averageMilitaryReadiness,
    approvalRating: governmentApproval?.approvalRating ?? 0,
    militaryUnits,
    pendingBattleDeclarations,
    pendingPeaceOffers,
    offensiveInitiationEnabled: nppOffensiveFlagFrom(gameState?.nppOffensiveInitiationEnabled),
  };
}

/**
 * Plan one autonomous foreign-policy decision for a country.
 *
 * The module owns context loading, bilateral opinion, scoring, safety rails,
 * deterministic ranking, and audit persistence. Its interface deliberately
 * exposes none of those storage details. Shadow mode is the default and never
 * calls a gameplay command. Active mode claims the audit row before delegating
 * one choice to the existing domain commands.
 */
export async function processAutonomousForeignPolicy(
  db: Db,
  countryId: CountryId,
  currentTurn: number,
  now: Date
): Promise<ForeignPolicyResult> {
  if (!(await isNppAutonomyActive(db, countryId))) {
    return {
      ran: false,
      mode: "off",
      acted: false,
      decisionRecorded: false,
      choice: null,
      skipReason: "inactive",
    };
  }

  const context = await loadContext(db, countryId, currentTurn);
  if (!context) {
    return {
      ran: false,
      mode: "shadow",
      acted: false,
      decisionRecorded: false,
      choice: null,
      skipReason: "no-government",
    };
  }
  if (context.mode === "off") {
    return {
      ran: false,
      mode: "off",
      acted: false,
      decisionRecorded: false,
      choice: null,
      skipReason: "off",
    };
  }

  const ranked = rankChoices(context);
  const topChoice = ranked[0];
  const choice = topChoice && topChoice.score >= MINIMUM_ACTION_SCORE ? topChoice : null;
  const decision: PersistedForeignPolicyDecision = {
    _id: new ObjectId(),
    countryId,
    turn: currentTurn,
    mode: context.mode,
    stage: context.stage,
    headNppId: context.head._id,
    headNppName: context.head.name,
    selected: choice,
    alternatives: ranked.slice(0, MAX_ALTERNATIVES),
    acted: false,
    executionStatus: context.mode === "shadow" ? "planned" : choice ? "claimed" : "no_action",
    executionNote:
      context.mode === "shadow"
        ? "Shadow mode records intent without changing world state."
        : choice
          ? "Active decision claimed before command execution."
          : "No permitted choice cleared the action threshold.",
    createdAt: now,
  };
  const decisions = db.collection<PersistedForeignPolicyDecision>(DECISION_COLLECTION);
  const write = await decisions.updateOne(
    { countryId, turn: currentTurn },
    { $setOnInsert: decision },
    { upsert: true }
  );
  const decisionRecorded = write.upsertedCount > 0;

  let acted = false;
  if (context.mode === "active" && choice && decisionRecorded) {
    const execution = await executeForeignPolicyChoice(
      db,
      countryId,
      context.head,
      choice,
      currentTurn,
      now
    );
    acted = execution.acted;
    await decisions.updateOne(
      { _id: decision._id, countryId, turn: currentTurn },
      {
        $set: {
          acted,
          executionStatus: acted ? "executed" : "rejected",
          executionNote: execution.note,
        },
      }
    );
  }

  return {
    ran: true,
    mode: context.mode,
    acted,
    decisionRecorded,
    choice,
    ...(choice ? {} : { skipReason: "no-choice" as const }),
  };
}
