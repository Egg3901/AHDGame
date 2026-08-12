import type {
  BargainingCampaign,
  BargainingEscalationLevel,
  BargainingOffer,
  BargainingParty,
} from "@/lib/db/types";
import { WAGE_LEVEL_MAX, WAGE_LEVEL_MIN } from "@/lib/labour/laborCost";
import { type BargainingTerms, validateBargainingTerms } from "@/lib/unions/bargaining";

const DEFAULT_PROFIT_MARGIN = 10;
const PROFIT_MARGIN_AT_FULL_CAPACITY = 20;
const BASE_SETTLEMENT_SHARE = 0.25;
const LEVERAGE_SETTLEMENT_SHARE = 0.45;
const CAPACITY_SETTLEMENT_SHARE = 0.2;
const MIN_COUNTER_RATE = 0.35;
const URGENT_COUNTER_BONUS = 0.3;
/**
 * How much of the remaining gap industrial action can move, on top of leverage
 * and capacity. Without this the escalation ladder has no effect on an
 * autonomous counterparty at all: an NPP employer would sit through an
 * indefinite industry strike with exactly the settlement wage it started with,
 * which makes every rung of the ladder decorative in an NPP-run world.
 */
const ACTION_SETTLEMENT_SHARE = 0.3;
/** Per-level pressure an ongoing action applies, 0-1 before duration weighting. */
const ESCALATION_PRESSURE: Record<BargainingEscalationLevel, number> = {
  none: 0,
  overtime_ban: 0.3,
  selective_strike: 0.65,
  industry_strike: 1,
};
/** Turns of sustained action at which pressure reaches its full weight. */
const ACTION_PRESSURE_RAMP_TURNS = 4;

export type NppBargainingNoActionReason =
  | "campaign-ended"
  | "deadline-reached"
  | "already-acted"
  | "awaiting-other-party"
  | "invalid-offer"
  | "no-valid-concession";

export type NppBargainingDecision =
  | { action: "accept" }
  | { action: "counter"; terms: BargainingTerms }
  | { action: "none"; reason: NppBargainingNoActionReason };

export interface NppBargainingPolicyInput {
  campaign: Pick<
    BargainingCampaign,
    | "status"
    | "currentOffer"
    | "offers"
    | "mandate"
    | "deadlineTurn"
    | "lastActionTurn"
    | "escalationLevel"
    | "escalationStartedAtTurn"
  >;
  party: BargainingParty;
  currentTurn: number;
  /** Current worker-weighted wage level across the employer's covered locals. */
  employerWageLevel: number;
  /** Current worker-weighted sector margin, in percentage points. */
  employerProfitMargin?: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function roundWage(value: number): number {
  return Math.round(clamp(value, WAGE_LEVEL_MIN, WAGE_LEVEL_MAX) * 100) / 100;
}

function firstUnionOffer(offers: readonly BargainingOffer[]): BargainingOffer | undefined {
  return offers.find((offer) => offer.proposedBy === "union");
}

function latestOfferByParty(
  offers: readonly BargainingOffer[],
  party: BargainingParty
): BargainingOffer | undefined {
  return [...offers].reverse().find((offer) => offer.proposedBy === party);
}

/**
 * How hard the industrial action currently running is squeezing the employer,
 * 0-1. Level sets the ceiling; sustained duration decides how much of it is
 * actually felt, so a strike called this turn is not yet worth what a strike
 * held for a month is.
 */
export function industrialActionPressure(args: {
  escalationLevel: BargainingEscalationLevel;
  escalationStartedAtTurn?: number;
  currentTurn: number;
}): number {
  const level = ESCALATION_PRESSURE[args.escalationLevel] ?? 0;
  if (level === 0) return 0;
  const turnsHeld =
    args.escalationStartedAtTurn != null
      ? Math.max(0, args.currentTurn - args.escalationStartedAtTurn)
      : 0;
  const ramp = clamp((turnsHeld + 1) / ACTION_PRESSURE_RAMP_TURNS, 0, 1);
  return clamp(level * ramp, 0, 1);
}

/**
 * Resolve the wage at which both NPP parties should settle. The union's opening
 * claim defines the ceiling, while live employer pay defines the floor. Union
 * leverage and employer capacity decide how much of that gap workers capture.
 */
export function calculateNppSettlementWage(input: {
  openingUnionWage: number;
  employerWageLevel: number;
  unionLeverage: number;
  employerProfitMargin?: number;
  /** 0-1, from `industrialActionPressure`. */
  actionPressure?: number;
}): number {
  const floor = roundWage(input.employerWageLevel);
  const claim = roundWage(Math.max(floor, input.openingUnionWage));
  const leverage = clamp(input.unionLeverage, 0, 100) / 100;
  const margin = Number.isFinite(input.employerProfitMargin)
    ? (input.employerProfitMargin as number)
    : DEFAULT_PROFIT_MARGIN;
  const capacity =
    clamp(margin, 0, PROFIT_MARGIN_AT_FULL_CAPACITY) / PROFIT_MARGIN_AT_FULL_CAPACITY;
  const pressure = clamp(input.actionPressure ?? 0, 0, 1);
  const settlementShare = clamp(
    BASE_SETTLEMENT_SHARE +
      leverage * LEVERAGE_SETTLEMENT_SHARE +
      capacity * CAPACITY_SETTLEMENT_SHARE +
      pressure * ACTION_SETTLEMENT_SHARE,
    0,
    1
  );
  return roundWage(floor + (claim - floor) * settlementShare);
}

function counterRate(campaign: NppBargainingPolicyInput["campaign"], currentTurn: number): number {
  const bargainingTurns = Math.max(1, campaign.deadlineTurn - campaign.offers[0].proposedAtTurn);
  const elapsedTurns = Math.max(0, currentTurn - campaign.offers[0].proposedAtTurn);
  const urgency = clamp(elapsedTurns / bargainingTurns, 0, 1);
  return MIN_COUNTER_RATE + urgency * URGENT_COUNTER_BONUS;
}

/**
 * Deterministic NPP bargaining policy. It never writes state and never creates
 * identifiers or timestamps, so the same campaign snapshot produces the same
 * decision during turn replay.
 *
 * Counters only move toward the shared settlement wage. They cannot cross the
 * other side's offer or retreat past the actor's previous position. Non-wage
 * terms are carried from the offer being answered, keeping the package valid
 * while the first NPP implementation negotiates the economically material term.
 */
export function decideNppBargainingAction(input: NppBargainingPolicyInput): NppBargainingDecision {
  const { campaign, currentTurn, party } = input;
  if (campaign.status !== "negotiating" && campaign.status !== "dispute") {
    return { action: "none", reason: "campaign-ended" };
  }
  if (campaign.status === "negotiating" && currentTurn >= campaign.deadlineTurn) {
    return { action: "none", reason: "deadline-reached" };
  }
  if (campaign.lastActionTurn >= currentTurn) {
    return { action: "none", reason: "already-acted" };
  }
  if (campaign.currentOffer.proposedBy === party) {
    return { action: "none", reason: "awaiting-other-party" };
  }

  const currentTerms: BargainingTerms = {
    wageLevel: campaign.currentOffer.wageLevel,
    agreementDurationTurns: campaign.currentOffer.agreementDurationTurns,
    noStrikeTurns: campaign.currentOffer.noStrikeTurns,
  };
  if (!validateBargainingTerms(currentTerms).ok) {
    return { action: "none", reason: "invalid-offer" };
  }

  const opening = firstUnionOffer(campaign.offers);
  if (!opening) return { action: "none", reason: "invalid-offer" };
  const settlementWage = calculateNppSettlementWage({
    openingUnionWage: opening.wageLevel,
    employerWageLevel: input.employerWageLevel,
    unionLeverage: campaign.mandate.leverage,
    employerProfitMargin: input.employerProfitMargin,
    actionPressure: industrialActionPressure({
      escalationLevel: campaign.escalationLevel,
      ...(campaign.escalationStartedAtTurn != null && {
        escalationStartedAtTurn: campaign.escalationStartedAtTurn,
      }),
      currentTurn,
    }),
  });
  const offeredWage = roundWage(campaign.currentOffer.wageLevel);
  const acceptable =
    party === "union" ? offeredWage >= settlementWage : offeredWage <= settlementWage;
  if (acceptable) return { action: "accept" };

  const previousOwnOffer = latestOfferByParty(campaign.offers, party);
  const ownAnchor = roundWage(previousOwnOffer?.wageLevel ?? input.employerWageLevel);
  const rate = counterRate(campaign, currentTurn);
  const rawCounter = ownAnchor + (settlementWage - ownAnchor) * rate;
  const counterWage =
    party === "union"
      ? roundWage(clamp(rawCounter, offeredWage, ownAnchor))
      : roundWage(clamp(rawCounter, ownAnchor, offeredWage));
  const terms: BargainingTerms = { ...currentTerms, wageLevel: counterWage };

  if (counterWage === offeredWage || counterWage === ownAnchor) {
    return { action: "none", reason: "no-valid-concession" };
  }
  if (!validateBargainingTerms(terms).ok) {
    return { action: "none", reason: "no-valid-concession" };
  }
  return { action: "counter", terms };
}
