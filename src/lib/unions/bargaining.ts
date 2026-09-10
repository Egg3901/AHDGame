import { ObjectId } from "mongodb";
import type {
  BargainingCampaign,
  BargainingMandate,
  BargainingOffer,
  BargainingParty,
  CollectiveAgreement,
  CorporateSector,
  Union,
} from "@/lib/db/types";
import { WAGE_LEVEL_MAX, WAGE_LEVEL_MIN } from "@/lib/labour/laborCost";
import {
  isValidContributionRate,
  PENSION_CONTRIBUTION_RATE_MAX,
  PENSION_CONTRIBUTION_RATE_MIN,
} from "@/lib/pensions/rules";
import { realWageIndex } from "@/lib/labour/unionization";
import {
  strikeCallCost,
  STRIKE_CALL_MIN_UNIONIZATION,
  UNION_STRIKE_CALL_COOLDOWN_TURNS,
} from "@/lib/unions/unionEconomy";

export const BARGAINING_DEADLINE_TURNS = 8;
export const AGREEMENT_DURATION_MIN_TURNS = 24;
export const AGREEMENT_DURATION_MAX_TURNS = 192;
export const BARGAINING_MAX_OFFERS = 12;
export const BARGAINING_MIN_COVERAGE = 20;
export const BARGAINING_MIN_SUPPORT = 25;
export const BARGAINING_STRIKE_RUNWAY_SCORE_CAP = 6;
export const BARGAINING_MEDIATION_DELAY_TURNS = 2;
export const BARGAINING_MEDIATION_WINDOW_TURNS = 4;
export const BARGAINING_MEDIATION_MIN_LAW_SUPPORT = 30;
export const BARGAINING_ESCALATION_SUPPORT = {
  overtime_ban: 35,
  selective_strike: 50,
  industry_strike: 65,
} as const;
export const OVERTIME_BAN_OUTPUT_FACTOR = 0.96;
/**
 * Treasury cost per covered local for every turn an overtime ban is held.
 * Without it the cheapest rung of the ladder is free and permanent, which
 * makes an indefinite ban strictly better than bargaining.
 */
export const OVERTIME_BAN_UPKEEP_PER_LOCAL = 40;
/**
 * Treasury cost per turn of holding `level` over `localCount` locals. Only the
 * overtime ban is a standing charge: strike calls are paid once, when they are
 * called (`strikeCallCost`). One definition so the turn pass that spends the
 * money and the panel that warns about it can never disagree.
 */
export function escalationUpkeepPerTurn(
  level: BargainingCampaign["escalationLevel"],
  localCount: number
): number {
  if (level !== "overtime_ban") return 0;
  return Math.max(0, Math.floor(localCount)) * OVERTIME_BAN_UPKEEP_PER_LOCAL;
}

/**
 * Turns a dispute can run before it lapses. The employer has no unilateral
 * exit from a dispute, so without a clock a rejected campaign sits on the
 * employer's output forever and permanently blocks the pair from reopening.
 */
export const BARGAINING_DISPUTE_MAX_TURNS = 16;
/** Cooling-off period before the same pair can open another campaign. */
export const BARGAINING_REOPEN_COOLDOWN_TURNS = 8;

export type BargainingEscalationPlanLocal = Pick<
  CorporateSector,
  "_id" | "unionization" | "strikeStartedAtTurn" | "strikeCooldownUntilTurn"
>;

export interface BargainingEscalationPlan<T extends BargainingEscalationPlanLocal> {
  nextLevel: Exclude<BargainingCampaign["escalationLevel"], "none"> | null;
  supportRequired: number | null;
  /** Every local affected at the resulting action level. */
  affectedLocals: T[];
  /** Locals newly placed into strike state, which determine the treasury cost. */
  newStrikeLocals: T[];
  cashCost: number;
  /** Upkeep the treasury pays every turn the resulting level is held. */
  upkeepPerTurn: number;
  /**
   * Upkeep the CURRENT level is already costing per turn. Scoped to locals that
   * still resolve, exactly as `labourRelationsTurn` charges it, so the runway
   * shown to a leader matches what the turn will actually take. Counting raw
   * `sectorIds` instead would overstate the cost for a campaign whose locals
   * have since been sold or destroyed.
   */
  heldUpkeepPerTurn: number;
  /** Turn the union's strike-call cooldown clears, null when it is not holding. */
  strikeCooldownUntilTurn: number | null;
  /** Why this escalation would be refused right now, null when it would go through. */
  blockedReason: string | null;
  blockedCode: "no_target" | "strike_cooldown" | "insufficient_funds" | null;
}

/** Union-level state the plan needs to know whether the escalation is allowed. */
export interface BargainingEscalationUnion {
  lastCalledStrikeTurn?: number | null;
  treasury?: number;
}

export function nextBargainingEscalationLevel(
  level: BargainingCampaign["escalationLevel"]
): BargainingEscalationPlan<BargainingEscalationPlanLocal>["nextLevel"] {
  if (level === "none") return "overtime_ban";
  if (level === "overtime_ban") return "selective_strike";
  if (level === "selective_strike") return "industry_strike";
  return null;
}

/**
 * Shared authoritative preview and execution plan for one escalation step.
 * Pass `union` and the plan also answers whether the escalation would be
 * refused, so the preview a leader reads and the gate that runs when they
 * click cannot disagree. Without it the union-level strike cooldown was
 * enforced only at the gate, and the button offered an action that was already
 * impossible.
 */
export function buildBargainingEscalationPlan<T extends BargainingEscalationPlanLocal>(
  campaign: Pick<BargainingCampaign, "escalationLevel" | "sectorIds">,
  locals: readonly T[],
  currentTurn: number,
  union?: BargainingEscalationUnion
): BargainingEscalationPlan<T> {
  const nextLevel = nextBargainingEscalationLevel(campaign.escalationLevel);
  if (!nextLevel) {
    return {
      nextLevel: null,
      supportRequired: null,
      affectedLocals: [],
      newStrikeLocals: [],
      cashCost: 0,
      upkeepPerTurn: 0,
      heldUpkeepPerTurn: escalationUpkeepPerTurn(campaign.escalationLevel, 0),
      strikeCooldownUntilTurn: null,
      blockedReason: null,
      blockedCode: null,
    };
  }

  const scopedIds = new Set(campaign.sectorIds.map((id) => id.toString()));
  const scoped = locals
    .filter((local) => scopedIds.has(local._id.toString()))
    .sort(
      (a, b) =>
        (b.unionization ?? 0) - (a.unionization ?? 0) ||
        a._id.toString().localeCompare(b._id.toString())
    );
  const alreadyStriking = scoped.filter((local) => local.strikeStartedAtTurn != null);
  const eligible = scoped.filter(
    (local) =>
      (local.unionization ?? 0) >= STRIKE_CALL_MIN_UNIONIZATION &&
      local.strikeStartedAtTurn == null &&
      (local.strikeCooldownUntilTurn == null || local.strikeCooldownUntilTurn <= currentTurn)
  );
  const newStrikeLocals =
    nextLevel === "selective_strike"
      ? eligible.slice(0, Math.max(1, Math.ceil(eligible.length / 2)))
      : nextLevel === "industry_strike"
        ? eligible
        : [];
  const affectedLocals =
    nextLevel === "overtime_ban"
      ? scoped
      : [...alreadyStriking, ...newStrikeLocals].sort((a, b) =>
          a._id.toString().localeCompare(b._id.toString())
        );

  // Same three refusals the escalation command applies, in the same order.
  const cashCost = strikeCallCost(newStrikeLocals.length);
  const strikeEscalation = nextLevel === "selective_strike" || nextLevel === "industry_strike";
  const strikeCooldownUntilTurn =
    strikeEscalation && newStrikeLocals.length > 0 && union?.lastCalledStrikeTurn != null
      ? union.lastCalledStrikeTurn + UNION_STRIKE_CALL_COOLDOWN_TURNS
      : null;
  let blockedCode: BargainingEscalationPlan<T>["blockedCode"] = null;
  let blockedReason: string | null = null;
  if (strikeEscalation && newStrikeLocals.length === 0 && alreadyStriking.length === 0) {
    blockedCode = "no_target";
    blockedReason = "No organized local can escalate this dispute.";
  } else if (strikeCooldownUntilTurn != null && currentTurn < strikeCooldownUntilTurn) {
    blockedCode = "strike_cooldown";
    blockedReason = `This union can call another strike on turn ${strikeCooldownUntilTurn}.`;
  } else if (union?.treasury != null && union.treasury < cashCost) {
    blockedCode = "insufficient_funds";
    blockedReason = "The strike fund cannot finance this escalation.";
  }

  return {
    nextLevel,
    supportRequired: BARGAINING_ESCALATION_SUPPORT[nextLevel],
    affectedLocals,
    newStrikeLocals,
    cashCost,
    upkeepPerTurn: escalationUpkeepPerTurn(nextLevel, scoped.length),
    heldUpkeepPerTurn: escalationUpkeepPerTurn(campaign.escalationLevel, scoped.length),
    strikeCooldownUntilTurn,
    blockedReason,
    blockedCode,
  };
}

/** Normalize national unemployment into labor scarcity: 2% = 100, 15% = 0. */
export function laborTightnessFromUnemployment(unemploymentRate: number): number {
  if (!Number.isFinite(unemploymentRate)) return 50;
  return roundScore(((15 - unemploymentRate) / 13) * 100);
}

/** Normalize the existing collective-bargaining law axis from -50..50 to 0..100. */
export function lawSupportFromBias(unionLawBias: number | undefined): number {
  if (typeof unionLawBias !== "number" || !Number.isFinite(unionLawBias)) return 50;
  return roundScore(unionLawBias + 50);
}

export interface BargainingTerms {
  wageLevel: number;
  agreementDurationTurns: number;
  noStrikeTurns: number;
  /** A8: employer pension contribution, as a share of the covered wage bill. */
  pensionContributionRate?: number;
}

export type BargainingValidation = { ok: true } | { ok: false; error: string };
export type BargainingFailure = { ok: false; error: string };

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function roundScore(value: number): number {
  return Math.round(clampScore(value) * 10) / 10;
}

/** Validate an offer without silently changing terms either party submitted. */
export function validateBargainingTerms(terms: BargainingTerms): BargainingValidation {
  if (
    !Number.isFinite(terms.wageLevel) ||
    terms.wageLevel < WAGE_LEVEL_MIN ||
    terms.wageLevel > WAGE_LEVEL_MAX
  ) {
    return {
      ok: false,
      error: `Wage level must be between ${WAGE_LEVEL_MIN} and ${WAGE_LEVEL_MAX}.`,
    };
  }
  if (
    !Number.isInteger(terms.agreementDurationTurns) ||
    terms.agreementDurationTurns < AGREEMENT_DURATION_MIN_TURNS ||
    terms.agreementDurationTurns > AGREEMENT_DURATION_MAX_TURNS
  ) {
    return {
      ok: false,
      error: `Agreement duration must be ${AGREEMENT_DURATION_MIN_TURNS}-${AGREEMENT_DURATION_MAX_TURNS} turns.`,
    };
  }
  if (
    !Number.isInteger(terms.noStrikeTurns) ||
    terms.noStrikeTurns < 0 ||
    terms.noStrikeTurns > terms.agreementDurationTurns
  ) {
    return {
      ok: false,
      error: "No-strike term must be a whole number of turns within the agreement duration.",
    };
  }
  // A8: an omitted rate is zero, not invalid. Every offer made before pension
  // bargaining existed is still a well-formed offer.
  if (
    terms.pensionContributionRate !== undefined &&
    !isValidContributionRate(terms.pensionContributionRate)
  ) {
    return {
      ok: false,
      error: `Pension contribution must be between ${Math.round(PENSION_CONTRIBUTION_RATE_MIN * 100)}% and ${Math.round(PENSION_CONTRIBUTION_RATE_MAX * 100)}% of the wage bill.`,
    };
  }
  return { ok: true };
}

export interface BargainingLocalSnapshot {
  workers: number;
  unionization: number;
  wageLevel: number;
  /** Persisted worker expectations from the live strike model. */
  workerExpectationIndex?: number;
  /**
   * The local's state cost-of-living index. Required for the grievance term to
   * mean anything: `workerExpectationIndex` is trended against the COL-adjusted
   * real wage every turn, so comparing it to a COL-blind wage reads grievance
   * as zero in exactly the expensive states where workers are most squeezed.
   */
  costOfLivingIndex?: number;
}

/**
 * Derive the campaign mandate from shop-floor conditions and normalized macro
 * inputs. This is a snapshot, not a live meter, so both parties know what power
 * the campaign opened with and turn replays remain deterministic.
 */
export function buildBargainingMandate(args: {
  locals: readonly BargainingLocalSnapshot[];
  laborTightness: number;
  lawSupport: number;
  treasury: number;
  strikeCost: number;
}): BargainingMandate {
  const totalWorkers = args.locals.reduce((sum, local) => sum + Math.max(0, local.workers), 0);
  const denominator = totalWorkers > 0 ? totalWorkers : Math.max(1, args.locals.length);
  const weight = (local: BargainingLocalSnapshot) =>
    totalWorkers > 0 ? Math.max(0, local.workers) : 1;

  const coverage =
    args.locals.reduce((sum, local) => sum + clampScore(local.unionization) * weight(local), 0) /
    denominator;
  // Grievance is a live shop-floor condition, not a function of the package the
  // player types into the form. Otherwise an inflated opening claim creates its
  // own mandate and unlocks industrial action. The strike model's persisted
  // expectation is the authoritative worker-side reference point.
  const grievance =
    args.locals.reduce((sum, local) => {
      const realWage = realWageIndex(
        Math.max(WAGE_LEVEL_MIN, local.wageLevel),
        local.costOfLivingIndex
      );
      const expectation = local.workerExpectationIndex ?? realWage;
      const relativeGap = Math.max(0, expectation - realWage) / Math.max(WAGE_LEVEL_MIN, realWage);
      return sum + clampScore(relativeGap * 400) * weight(local);
    }, 0) / denominator;
  const laborTightness = clampScore(args.laborTightness);
  const lawSupport = clampScore(args.lawSupport);
  const strikeFundRunway =
    args.strikeCost > 0
      ? Math.min(BARGAINING_STRIKE_RUNWAY_SCORE_CAP, Math.max(0, args.treasury) / args.strikeCost)
      : 0;
  const fundScore = (strikeFundRunway / BARGAINING_STRIKE_RUNWAY_SCORE_CAP) * 100;

  return {
    coverage: roundScore(coverage),
    grievance: roundScore(grievance),
    laborTightness: roundScore(laborTightness),
    lawSupport: roundScore(lawSupport),
    strikeFundRunway: Math.round(strikeFundRunway * 10) / 10,
    support: roundScore(coverage * 0.6 + grievance * 0.3 + lawSupport * 0.1),
    leverage: roundScore(
      coverage * 0.35 +
        grievance * 0.25 +
        laborTightness * 0.15 +
        fundScore * 0.15 +
        lawSupport * 0.1
    ),
    organizedLocalCount: args.locals.filter(
      (local) => local.unionization >= STRIKE_CALL_MIN_UNIONIZATION
    ).length,
    totalLocalCount: args.locals.length,
  };
}

export function validateBargainingMandate(mandate: BargainingMandate): BargainingValidation {
  if (mandate.totalLocalCount === 0) {
    return { ok: false, error: "This employer has no locals in the union's industry." };
  }
  if (mandate.organizedLocalCount === 0 || mandate.coverage < BARGAINING_MIN_COVERAGE) {
    return { ok: false, error: "The union needs more organized workers at this employer." };
  }
  if (mandate.support < BARGAINING_MIN_SUPPORT) {
    return { ok: false, error: "The proposed claim does not have a strong enough member mandate." };
  }
  return { ok: true };
}

function makeOffer(
  revision: number,
  proposedBy: BargainingParty,
  terms: BargainingTerms,
  currentTurn: number,
  now: Date
): BargainingOffer {
  return { revision, proposedBy, ...terms, proposedAtTurn: currentTurn, proposedAt: now };
}

export function openBargainingCampaign(args: {
  union: Pick<Union, "_id" | "countryId" | "sectorType">;
  employerCorporationId: ObjectId;
  sectors: readonly Pick<CorporateSector, "_id">[];
  mandate: BargainingMandate;
  terms: BargainingTerms;
  currentTurn: number;
  now: Date;
  campaignId?: ObjectId;
}): BargainingCampaign | BargainingFailure {
  const termsValidation = validateBargainingTerms(args.terms);
  if (!termsValidation.ok) return termsValidation;
  const mandateValidation = validateBargainingMandate(args.mandate);
  if (!mandateValidation.ok) return mandateValidation;

  const firstOffer = makeOffer(1, "union", args.terms, args.currentTurn, args.now);
  return {
    _id: args.campaignId ?? new ObjectId(),
    unionId: args.union._id,
    countryId: args.union.countryId,
    sectorType: args.union.sectorType,
    employerCorporationId: args.employerCorporationId,
    sectorIds: args.sectors.map((sector) => sector._id),
    status: "negotiating",
    escalationLevel: "none",
    mandate: args.mandate,
    currentOffer: firstOffer,
    offers: [firstOffer],
    startedAtTurn: args.currentTurn,
    deadlineTurn: args.currentTurn + BARGAINING_DEADLINE_TURNS,
    lastActionTurn: args.currentTurn,
    createdAt: args.now,
    updatedAt: args.now,
  };
}

export function counterBargainingOffer(args: {
  campaign: BargainingCampaign;
  proposedBy: BargainingParty;
  terms: BargainingTerms;
  currentTurn: number;
  now: Date;
}): BargainingCampaign | BargainingFailure {
  // A dispute must stay answerable. Industrial action is pressure to move the
  // package, so if neither side can table a new one during a dispute the whole
  // escalation ladder has nothing to act on and the campaign can only end by
  // capitulation to a frozen offer.
  if (args.campaign.status !== "negotiating" && args.campaign.status !== "dispute") {
    return { ok: false, error: "Only an open campaign can receive an offer." };
  }
  if (args.campaign.currentOffer.proposedBy === args.proposedBy) {
    return { ok: false, error: "The other party must answer the current offer." };
  }
  if (args.campaign.offers.length >= BARGAINING_MAX_OFFERS) {
    return { ok: false, error: "This campaign has reached its bargaining-round limit." };
  }
  const validation = validateBargainingTerms(args.terms);
  if (!validation.ok) return validation;

  const offer = makeOffer(
    args.campaign.currentOffer.revision + 1,
    args.proposedBy,
    args.terms,
    args.currentTurn,
    args.now
  );
  return {
    ...args.campaign,
    currentOffer: offer,
    offers: [...args.campaign.offers, offer],
    lastActionTurn: args.currentTurn,
    updatedAt: args.now,
  };
}

export function moveCampaignToDispute(
  campaign: BargainingCampaign,
  currentTurn: number,
  now: Date
): BargainingCampaign | BargainingFailure {
  if (campaign.status !== "negotiating") {
    return { ok: false, error: "Only a negotiating campaign can enter dispute." };
  }
  return {
    ...campaign,
    status: "dispute",
    disputeStartedAtTurn: currentTurn,
    lastActionTurn: currentTurn,
    updatedAt: now,
  };
}

export function escalateBargainingCampaign(
  campaign: BargainingCampaign,
  currentTurn: number,
  now: Date
): BargainingCampaign | BargainingFailure {
  if (campaign.status !== "dispute") {
    return { ok: false, error: "Only a bargaining dispute can be escalated." };
  }
  if (campaign.lastActionTurn >= currentTurn) {
    return { ok: false, error: "This campaign has already acted this turn." };
  }
  const nextLevel = nextBargainingEscalationLevel(campaign.escalationLevel);
  if (!nextLevel) return { ok: false, error: "This dispute is already fully escalated." };
  if (campaign.mandate.support < BARGAINING_ESCALATION_SUPPORT[nextLevel]) {
    return {
      ok: false,
      error: `${nextLevel.replaceAll("_", " ")} requires ${BARGAINING_ESCALATION_SUPPORT[nextLevel]} member support.`,
    };
  }
  return {
    ...campaign,
    escalationLevel: nextLevel,
    escalationStartedAtTurn: currentTurn,
    lastActionTurn: currentTurn,
    updatedAt: now,
  };
}

function latestOfferByParty(campaign: BargainingCampaign, party: BargainingParty) {
  return [...campaign.offers].reverse().find((offer) => offer.proposedBy === party);
}

export interface BargainingMediationAvailability {
  available: boolean;
  availableTurn: number;
  reason: string | null;
}

/** One source of truth for server validation and both player surfaces. */
export interface BargainingMediationOptions {
  /**
   * Government conciliation opened from a national crisis, rather than by a
   * party to the dispute. Waives the cooling-off delay only.
   *
   * The delay exists so a party cannot table an offer and instantly demand a
   * mediator; it is not a statement that a dispute is unmediatable while young.
   * A government intervening in a nationwide strike is exactly the case the
   * delay was not written for, and applying it there made the crisis's
   * mediation option inert (#127). Every other gate still applies: the dispute
   * must be real, unmediated, legally permitted, and carry an offer from both
   * sides.
   */
  governmentIntervention?: boolean;
}

export function getBargainingMediationAvailability(
  campaign: BargainingCampaign,
  currentTurn: number,
  options: BargainingMediationOptions = {}
): BargainingMediationAvailability {
  const availableTurn =
    (campaign.disputeStartedAtTurn ?? campaign.deadlineTurn) + BARGAINING_MEDIATION_DELAY_TURNS;
  if (campaign.status !== "dispute") {
    return { available: false, availableTurn, reason: "Mediation requires an active dispute." };
  }
  if (campaign.mediation) {
    return {
      available: false,
      availableTurn,
      reason: "This campaign has already used its mediation process.",
    };
  }
  if (campaign.mandate.lawSupport < BARGAINING_MEDIATION_MIN_LAW_SUPPORT) {
    return {
      available: false,
      availableTurn,
      reason: "Collective-bargaining law does not provide mediation here.",
    };
  }
  if (!latestOfferByParty(campaign, "union") || !latestOfferByParty(campaign, "employer")) {
    return {
      available: false,
      availableTurn,
      reason:
        "Mediation requires a wage package from both parties. A direct rejection cannot be mediated.",
    };
  }
  if (currentTurn < availableTurn && !options.governmentIntervention) {
    return {
      available: false,
      availableTurn,
      reason: `Mediation becomes available on turn ${availableTurn}.`,
    };
  }
  return { available: true, availableTurn, reason: null };
}

export function proposeBargainingMediation(args: {
  campaign: BargainingCampaign;
  requestedBy: BargainingParty;
  currentTurn: number;
  now: Date;
}): BargainingCampaign | BargainingFailure {
  const { campaign } = args;
  const availability = getBargainingMediationAvailability(campaign, args.currentTurn);
  if (!availability.available) return { ok: false, error: availability.reason! };
  const unionOffer = latestOfferByParty(campaign, "union");
  const employerOffer = latestOfferByParty(campaign, "employer");
  // Availability checked these exact records above.
  if (!unionOffer || !employerOffer) return { ok: false, error: availability.reason! };

  const unionWeight = 0.35 + (campaign.mandate.leverage / 100) * 0.3;
  const wageLevel =
    Math.round(
      (employerOffer.wageLevel + (unionOffer.wageLevel - employerOffer.wageLevel) * unionWeight) *
        100
    ) / 100;
  const agreementDurationTurns = Math.round(
    (unionOffer.agreementDurationTurns + employerOffer.agreementDurationTurns) / 2
  );
  const noStrikeTurns = Math.min(
    agreementDurationTurns,
    Math.round((unionOffer.noStrikeTurns + employerOffer.noStrikeTurns) / 2)
  );
  // A8: the pension rate is leverage-weighted like the wage, so mediation
  // splits the pension question the same way it splits the pay question rather
  // than quietly dropping a term one side asked for.
  const unionRate = unionOffer.pensionContributionRate ?? 0;
  const employerRate = employerOffer.pensionContributionRate ?? 0;
  const pensionContributionRate =
    Math.round((employerRate + (unionRate - employerRate) * unionWeight) * 10_000) / 10_000;

  const terms = {
    wageLevel,
    agreementDurationTurns,
    noStrikeTurns,
    ...(pensionContributionRate > 0 ? { pensionContributionRate } : {}),
  };
  const validation = validateBargainingTerms(terms);
  if (!validation.ok) return validation;

  return {
    ...campaign,
    mediation: {
      requestedBy: args.requestedBy,
      ...terms,
      unionAccepted: args.requestedBy === "union",
      employerAccepted: args.requestedBy === "employer",
      status: "pending",
      proposedAtTurn: args.currentTurn,
      expiresAtTurn: args.currentTurn + BARGAINING_MEDIATION_WINDOW_TURNS,
      proposedAt: args.now,
      updatedAt: args.now,
    },
    lastActionTurn: args.currentTurn,
    updatedAt: args.now,
  };
}

export function respondToBargainingMediation(args: {
  campaign: BargainingCampaign;
  party: BargainingParty;
  accept: boolean;
  currentTurn: number;
  now: Date;
}): BargainingCampaign | BargainingFailure {
  const mediation = args.campaign.mediation;
  if (args.campaign.status !== "dispute" || !mediation || mediation.status !== "pending") {
    return { ok: false, error: "There is no pending mediation package to answer." };
  }
  if (args.currentTurn >= mediation.expiresAtTurn) {
    return { ok: false, error: "The mediation package has expired." };
  }
  const alreadyAccepted =
    args.party === "union" ? mediation.unionAccepted : mediation.employerAccepted;
  if (alreadyAccepted) {
    return { ok: false, error: "This party has already accepted the mediation package." };
  }
  return {
    ...args.campaign,
    mediation: {
      ...mediation,
      unionAccepted: args.accept && args.party === "union" ? true : mediation.unionAccepted,
      employerAccepted:
        args.accept && args.party === "employer" ? true : mediation.employerAccepted,
      status: args.accept ? "pending" : "rejected",
      updatedAt: args.now,
    },
    lastActionTurn: args.currentTurn,
    updatedAt: args.now,
  };
}

function agreementFromTerms(args: {
  campaign: BargainingCampaign;
  terms: BargainingTerms;
  currentTurn: number;
  now: Date;
  agreementId?: ObjectId;
}) {
  const agreementId = args.agreementId ?? new ObjectId();
  const agreement: CollectiveAgreement = {
    _id: agreementId,
    campaignId: args.campaign._id,
    unionId: args.campaign.unionId,
    countryId: args.campaign.countryId,
    sectorType: args.campaign.sectorType,
    employerCorporationId: args.campaign.employerCorporationId,
    sectorIds: [...args.campaign.sectorIds],
    wageLevel: args.terms.wageLevel,
    ...(args.terms.pensionContributionRate
      ? { pensionContributionRate: args.terms.pensionContributionRate }
      : {}),
    startsAtTurn: args.currentTurn,
    expiresAtTurn: args.currentTurn + args.terms.agreementDurationTurns,
    noStrikeUntilTurn: args.currentTurn + args.terms.noStrikeTurns,
    status: "active" as const,
    createdAt: args.now,
    updatedAt: args.now,
  };
  return { agreementId, agreement };
}

export function settleBargainingCampaign(args: {
  campaign: BargainingCampaign;
  acceptedBy: BargainingParty;
  currentTurn: number;
  now: Date;
  agreementId?: ObjectId;
}):
  | { ok: true; campaign: BargainingCampaign; agreement: CollectiveAgreement }
  | { ok: false; error: string } {
  if (args.campaign.status !== "negotiating" && args.campaign.status !== "dispute") {
    return { ok: false, error: "This campaign can no longer be settled." };
  }
  if (args.campaign.currentOffer.proposedBy === args.acceptedBy) {
    return { ok: false, error: "The party that made an offer cannot accept its own offer." };
  }
  const offer = args.campaign.currentOffer;
  const { agreementId, agreement } = agreementFromTerms({
    campaign: args.campaign,
    terms: offer,
    currentTurn: args.currentTurn,
    now: args.now,
    agreementId: args.agreementId,
  });
  return {
    ok: true,
    agreement,
    campaign: {
      ...args.campaign,
      status: "settled",
      settledAgreementId: agreementId,
      endedAtTurn: args.currentTurn,
      lastActionTurn: args.currentTurn,
      updatedAt: args.now,
    },
  };
}

export function settleMediatedBargainingCampaign(args: {
  campaign: BargainingCampaign;
  currentTurn: number;
  now: Date;
  agreementId?: ObjectId;
}):
  | { ok: true; campaign: BargainingCampaign; agreement: CollectiveAgreement }
  | { ok: false; error: string } {
  const mediation = args.campaign.mediation;
  if (
    args.campaign.status !== "dispute" ||
    !mediation ||
    mediation.status !== "pending" ||
    !mediation.unionAccepted ||
    !mediation.employerAccepted
  ) {
    return { ok: false, error: "Both parties must accept the pending mediation package." };
  }
  const { agreementId, agreement } = agreementFromTerms({
    campaign: args.campaign,
    terms: mediation,
    currentTurn: args.currentTurn,
    now: args.now,
    agreementId: args.agreementId,
  });
  return {
    ok: true,
    agreement,
    campaign: {
      ...args.campaign,
      status: "settled",
      settledAgreementId: agreementId,
      endedAtTurn: args.currentTurn,
      lastActionTurn: args.currentTurn,
      updatedAt: args.now,
    },
  };
}

/** Turn an unresolved dispute lapses on. */
export function disputeLapseTurn(
  campaign: Pick<BargainingCampaign, "disputeStartedAtTurn" | "deadlineTurn">
): number {
  return (campaign.disputeStartedAtTurn ?? campaign.deadlineTurn) + BARGAINING_DISPUTE_MAX_TURNS;
}

/**
 * The one definition of "this agreement is in force right now", in the two
 * shapes callers need: a predicate for rows already in memory, and a Mongo
 * filter for the ones that have to select in the database.
 *
 * There were six copies of this rule before, five of them written out inline.
 * They all AGREED, so this is not a bug fix; it is removing the opportunity for
 * the seventh one to disagree. A wage floor or a no-strike term applied on a
 * turn boundary one site reads differently from another is the kind of defect
 * that shows up as an employer being fined for a strike the agreement permitted.
 *
 * Note the asymmetry, which is deliberate and easy to get wrong when copying:
 * the start is INCLUSIVE and the expiry is EXCLUSIVE, so an agreement running
 * to turn 100 is not in force on turn 100.
 */
export function activeCollectiveAgreementFilter(currentTurn: number): {
  status: "active";
  startsAtTurn: { $lte: number };
  expiresAtTurn: { $gt: number };
} {
  return {
    status: "active",
    startsAtTurn: { $lte: currentTurn },
    expiresAtTurn: { $gt: currentTurn },
  };
}

export function isCollectiveAgreementActive(
  agreement: Pick<CollectiveAgreement, "status" | "startsAtTurn" | "expiresAtTurn">,
  currentTurn: number
): boolean {
  return (
    agreement.status === "active" &&
    agreement.startsAtTurn <= currentTurn &&
    currentTurn < agreement.expiresAtTurn
  );
}
