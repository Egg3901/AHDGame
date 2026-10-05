import { ObjectId, type Db } from "mongodb";
import { ALIGNMENT_POLES, type AlignmentPoleId } from "@/lib/constants/alignmentEras";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { type OrganizationCategory } from "@/lib/constants/orgCategory";
import { NATIONAL_TERMINAL_STATUSES } from "@/lib/congress/billProposalLimits";
import type { Bill, BillStatus, NPP, NppForeignPolicyStage } from "@/lib/db/types";
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
import {
  DECISION_COLLECTION,
  MINIMUM_ACTION_SCORE,
  MAX_ALTERNATIVES,
  STANDARD_COOLDOWN_TURNS,
  TRADE_ESCALATION_COOLDOWN_TURNS,
  FOREIGN_POLICY_COUNTRIES,
  clamp,
  round,
  memberOrganizations,
  alignmentSimilarity,
  bilateralTradeDependence,
  conflictRelationship,
  activeEmbargo,
  type ForeignPolicyMode,
  type ForeignPolicyActionType,
  type ForeignPolicyChoice,
  type ForeignPolicyResult,
  type OpinionFactor,
  type CountryOpinion,
  type ForeignPolicyContext,
  type PersistedForeignPolicyDecision,
} from "./foreignPolicyShared";

export type {
  ForeignPolicyMode,
  ForeignPolicyActionType,
  ForeignPolicyChoice,
  ForeignPolicyResult,
} from "./foreignPolicyShared";
import { voteCandidates, bilateralCandidates, warCandidates } from "./foreignPolicyCandidates";
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
  const head = await db.collection<NPP>("npps").findOne(
    { _id: headNppId },
    {
      projection: {
        name: 1,
        personality: 1,
        "policies.economic": 1,
        "policies.domainPositions.trade": 1,
        "policies.domainPositions.defense": 1,
      },
    }
  );
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
  const poleLeaders = new Map<AlignmentPoleId, CountryId>();
  for (const pole of Object.values(ALIGNMENT_POLES)) {
    if (pole.leaderCountryId) poleLeaders.set(pole.id, pole.leaderCountryId);
  }
  const organizationIds = Array.from(
    new Set(memberships.map((membership) => membership.organizationId))
  );
  const organizationDefs = await Promise.all(
    organizationIds.map((organizationId) => loadOrganizationDefWithPowers(db, organizationId))
  );
  organizationDefs.forEach((definition, index) => {
    if (!definition) return;
    organizationCategories.set(organizationIds[index], definition.category);
    const founder = definition.foundingMembers[0];
    if (definition.alignment && founder && founder in COUNTRY_CONFIGS) {
      poleLeaders.set(definition.alignment.poleId, founder as CountryId);
    }
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
    poleLeaders,
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
      ballotsCast: 0,
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
      ballotsCast: 0,
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
      ballotsCast: 0,
      skipReason: "off",
    };
  }

  // BALLOTS ARE NOT THE COUNTRY'S ONE ACTION, and separating them here is the
  // whole of ticket #1257.
  //
  // A country plans once every six turns and executes a single top-ranked
  // choice. Casting a ballot used to compete for that slot against embargoes,
  // tariffs and war conduct, so a 24-turn ballot gave each member four contested
  // chances to vote and it lost most of them — the more so after #1233 raised
  // war conduct above the routine band precisely to stop votes crowding IT out.
  // Under unanimity one member losing all four is a permanent veto, which is how
  // China closed 5-of-7 and North Korea 2-of-7 in the Warsaw Pact with not one
  // "no" cast against either.
  //
  // A foreign ministry can vote in its bloc AND raise a tariff in the same week;
  // the two were never really rivals. So every eligible ballot is cast, and the
  // ranked action is chosen from what is left.
  const ranked = rankChoices(context);
  const isBallot = (c: ForeignPolicyChoice) =>
    c.type === "vote_org_yes" || c.type === "vote_org_no";
  const ballots = ranked.filter(isBallot);
  const strategic = ranked.filter((c) => !isBallot(c));
  const topChoice = strategic[0];
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
    // Alternatives are the strategic field only: a ballot is not a road not
    // taken any more, it is cast, and `ballots` below is where it is recorded.
    alternatives: strategic.slice(0, MAX_ALTERNATIVES),
    ballots,
    acted: false,
    executionStatus: context.mode === "shadow" ? "planned" : choice ? "claimed" : "no_action",
    // The audit row is the only account of why a country did what it did, and a
    // flat "no action" on a turn that cast four ballots is how #1257 stayed
    // invisible for as long as it did. Say which of the two happened.
    executionNote:
      context.mode === "shadow"
        ? "Shadow mode records intent without changing world state."
        : choice
          ? "Active decision claimed before command execution."
          : ballots.length > 0
            ? `No choice cleared the action threshold; ${ballots.length} ballot(s) to cast.`
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
  let ballotsCast = 0;
  if (context.mode === "active" && decisionRecorded) {
    // Ballots first, and every one of them. `decisionRecorded` still gates the
    // write so a restarted worker replaying the turn cannot vote twice; the
    // per-item `alreadyVoted` filter in `voteCandidates` is the second guard.
    for (const ballot of ballots) {
      const cast = await executeForeignPolicyChoice(
        db,
        countryId,
        context.head,
        ballot,
        currentTurn,
        now
      );
      if (cast.acted) ballotsCast++;
    }
  }
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
  if (ballotsCast > 0) {
    await decisions.updateOne(
      { _id: decision._id, countryId, turn: currentTurn },
      { $set: { ballotsCast } }
    );
  }

  return {
    ran: true,
    mode: context.mode,
    acted,
    decisionRecorded,
    choice,
    ballotsCast,
    ...(choice ? {} : { skipReason: "no-choice" as const }),
  };
}
