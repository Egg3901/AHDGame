/**
 * Pure product venture rules. Nothing here touches the database: the turn
 * processor feeds in settled cash and the engine returns the next state.
 */
import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import type {
  ProductVenture,
  VentureDomain,
  VentureEventChoice,
  VentureEventDef,
  VentureEventRecord,
} from "./types";
import { VENTURE_EVENTS } from "./events";

/** About three real days at the game's turn cadence. */
export const VENTURE_DEVELOPMENT_TURNS = 3 * TURNS_PER_DAY;
export const VENTURE_BOOST_TURNS = 3 * TURNS_PER_DAY;
/** Time a CEO has to answer an event before the default choice applies. */
export const VENTURE_EVENT_RESPONSE_TURNS = TURNS_PER_DAY;
/** Investment target as turns of the matching sectors' revenue. */
export const VENTURE_TARGET_TURNS_OF_REVENUE = 1.5;
export const VENTURE_MIN_TARGET_ANCHOR = 1_000;
/** Per-turn funding tiers as multiples of target / development turns. */
export const VENTURE_FUNDING_TIERS = [
  { id: "lean", label: "Lean", multiple: 0.5 },
  { id: "standard", label: "Standard", multiple: 1 },
  { id: "heavy", label: "Heavy", multiple: 1.5 },
  { id: "all_in", label: "All in", multiple: 2 },
] as const;
export const VENTURE_MAX_FUNDING_MULTIPLE = 2;
export const VENTURE_MIN_FUNDING_MULTIPLE = 0.25;
/** Several hits cannot lift one sector by more than this. */
export const VENTURE_MAX_STACKED_BOOST = 0.25;
export const VENTURE_MIN_BOOST = 0.1;
export const VENTURE_MAX_BOOST = 0.2;
const QUALITY_CURVE_RATE = 1.2;
const HIT_FLOOR = 0.05;
const HIT_CEILING = 0.65;
const HIT_QUALITY_WEIGHT = 0.6;
const HIT_QUALITY_EXPONENT = 1.3;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function finite(value: number | undefined | null, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Deterministic value in [0, 1) from a string seed (cyrb53). */
export function seededUnit(seed: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h2 >>> 0) * 0x100000 + (h1 >>> 21)) / 0x10000000000000;
}

export function ventureTargetAnchor(baselineRevenueAnchor: number): number {
  return Math.max(
    VENTURE_MIN_TARGET_ANCHOR,
    finite(baselineRevenueAnchor) * VENTURE_TARGET_TURNS_OF_REVENUE
  );
}

/** Funding that exactly reaches the target at the end of development. */
export function referenceFundingPerTurn(targetAnchor: number): number {
  return targetAnchor / VENTURE_DEVELOPMENT_TURNS;
}

export function clampFundingPerTurn(targetAnchor: number, requestedAnchor: number): number {
  const reference = referenceFundingPerTurn(targetAnchor);
  return clamp(
    finite(requestedAnchor),
    reference * VENTURE_MIN_FUNDING_MULTIPLE,
    reference * VENTURE_MAX_FUNDING_MULTIPLE
  );
}

/** Quality from cumulative investment against the line target, 0 to 100. */
export function qualityFromInvestment(investedAnchor: number, targetAnchor: number): number {
  if (!(targetAnchor > 0)) return 0;
  const ratio = Math.max(0, finite(investedAnchor)) / targetAnchor;
  return 100 * (1 - Math.exp(-QUALITY_CURVE_RATE * ratio));
}

/** Corporation quality (0 to 100) nudges a launch by at most 5 points either way. */
export function brandQualityBonus(averageQuality: number | undefined | null): number {
  if (typeof averageQuality !== "number" || !Number.isFinite(averageQuality)) return 0;
  return clamp(((averageQuality - 50) / 50) * 5, -5, 5);
}

export function hitProbability(quality: number): number {
  const q = clamp(finite(quality), 0, 100) / 100;
  return clamp(
    HIT_FLOOR + HIT_QUALITY_WEIGHT * Math.pow(q, HIT_QUALITY_EXPONENT),
    HIT_FLOOR,
    HIT_CEILING
  );
}

/** A hit lifts revenue 10 to 20 percent, scaled by quality. */
export function boostFractionForQuality(quality: number): number {
  const scale = clamp((finite(quality) - 30) / 70, 0, 1);
  return VENTURE_MIN_BOOST + (VENTURE_MAX_BOOST - VENTURE_MIN_BOOST) * scale;
}

export function finalQuality(
  venture: Pick<ProductVenture, "investedAnchor" | "targetAnchor" | "qualityShift">,
  brandBonus: number
): number {
  return clamp(
    qualityFromInvestment(venture.investedAnchor, venture.targetAnchor) +
      venture.qualityShift +
      brandBonus,
    0,
    100
  );
}

/** Same seed always gives the same answer, so a replayed turn cannot reroll. */
export function rollOutcome(ventureId: string): number {
  return seededUnit(`${ventureId}:outcome`);
}

export function eventPool(domain: VentureDomain, lineId: string): VentureEventDef[] {
  return VENTURE_EVENTS.filter(
    (event) => event.domain === domain && (!event.lineIds || event.lineIds.includes(lineId))
  );
}

export function getVentureEvent(eventId: string): VentureEventDef | undefined {
  return VENTURE_EVENTS.find((event) => event.id === eventId);
}

/**
 * One or two events, chosen and timed from the venture id alone. The first
 * falls in the first half of development, the second in the middle stretch,
 * leaving every deadline inside the development window.
 */
export function scheduleEvents(input: {
  ventureId: string;
  domain: VentureDomain;
  lineId: string;
  startedTurn: number;
}): VentureEventRecord[] {
  const pool = eventPool(input.domain, input.lineId)
    .map((event) => ({ event, order: seededUnit(`${input.ventureId}:pick:${event.id}`) }))
    .sort((a, b) => a.order - b.order);
  const count = seededUnit(`${input.ventureId}:count`) < 0.5 ? 2 : 1;
  const windows: Array<[number, number]> = [
    [0.15, 0.4],
    [0.45, 0.65],
  ];
  return pool.slice(0, count).map(({ event }, index) => {
    const [lo, hi] = windows[index]!;
    const fraction = lo + (hi - lo) * seededUnit(`${input.ventureId}:time:${index}`);
    return {
      eventId: event.id,
      triggerTurn: input.startedTurn + Math.floor(VENTURE_DEVELOPMENT_TURNS * fraction),
    };
  });
}

export function eventChoice(
  event: VentureEventDef,
  choiceId: string
): VentureEventChoice | undefined {
  return event.choices.find((choice) => choice.id === choiceId);
}

/** Applies a choice to the venture. Returns the next venture and never mutates the input. */
export function applyEventChoice(
  venture: ProductVenture,
  eventId: string,
  choiceId: string,
  turn: number,
  auto: boolean
): ProductVenture | null {
  const def = getVentureEvent(eventId);
  const choice = def ? eventChoice(def, choiceId) : undefined;
  const index = venture.events.findIndex((record) => record.eventId === eventId);
  if (!def || !choice || index < 0) return null;
  const record = venture.events[index]!;
  if (record.choiceId || record.offeredTurn === undefined) return null;
  const events = venture.events.map((entry, i) =>
    i === index ? { ...entry, choiceId, auto, resolvedTurn: turn } : entry
  );
  const earliestEnd = Math.max(turn + 1, venture.startedTurn + TURNS_PER_DAY);
  return {
    ...venture,
    events,
    qualityShift: venture.qualityShift + choice.qualityDelta,
    pendingChargeAnchor: venture.pendingChargeAnchor + choice.chargeFraction * venture.targetAnchor,
    endTurn: Math.max(earliestEnd, venture.endTurn + choice.delayTurns),
  };
}

export interface VentureTurnInput {
  turn: number;
  /** Funding actually debited this turn (already includes any event charge paid). */
  investmentPaidAnchor: number;
  chargePaidAnchor: number;
  /** Corporation quality score for the brand bonus. */
  averageQuality?: number | null;
  /**
   * Current per-turn revenue of the sectors this product would lift. At
   * completion the product is judged against the larger of its original
   * target and one priced on this revenue, so expanding the lifted sectors
   * after a cheap start cannot buy a lift on a much larger business.
   */
  liftedRevenueAnchor?: number | null;
}

export interface VentureTurnResult {
  venture: ProductVenture;
  /** Events newly put in front of the CEO this turn. */
  offered: string[];
  /** Events settled by default this turn. */
  defaulted: string[];
  completed: boolean;
}

/**
 * Advances a venture in development by one turn. A turn at or before
 * lastProcessedTurn is a no-op, which keeps replays idempotent.
 */
export function advanceDevelopment(
  venture: ProductVenture,
  input: VentureTurnInput
): VentureTurnResult | null {
  if (venture.stage !== "development" || input.turn <= venture.lastProcessedTurn) return null;
  const turn = input.turn;
  let next: ProductVenture = {
    ...venture,
    lastProcessedTurn: turn,
    investedAnchor: venture.investedAnchor + Math.max(0, input.investmentPaidAnchor),
    spentAnchor:
      venture.spentAnchor +
      Math.max(0, input.investmentPaidAnchor) +
      Math.max(0, input.chargePaidAnchor),
    pendingChargeAnchor: Math.max(
      0,
      venture.pendingChargeAnchor - Math.max(0, input.chargePaidAnchor)
    ),
  };
  const offered: string[] = [];
  const defaulted: string[] = [];

  next = {
    ...next,
    events: next.events.map((record) => {
      if (record.offeredTurn === undefined && turn >= record.triggerTurn) {
        offered.push(record.eventId);
        return {
          ...record,
          offeredTurn: turn,
          deadlineTurn: Math.min(turn + VENTURE_EVENT_RESPONSE_TURNS, next.endTurn),
        };
      }
      return record;
    }),
  };

  const resolveDefaults = (final: boolean) => {
    for (const record of next.events) {
      if (record.offeredTurn === undefined || record.choiceId) continue;
      if (!final && (record.deadlineTurn ?? Infinity) > turn) continue;
      const def = getVentureEvent(record.eventId);
      if (!def) continue;
      const applied = applyEventChoice(next, record.eventId, def.defaultChoiceId, turn, true);
      if (applied) {
        next = applied;
        defaulted.push(record.eventId);
      }
    }
  };
  resolveDefaults(false);

  const completed = turn >= next.endTurn;
  if (completed) {
    // Anything the CEO never saw still counts: fire and settle it by default.
    next = {
      ...next,
      events: next.events.map((record) =>
        record.offeredTurn === undefined
          ? { ...record, offeredTurn: turn, deadlineTurn: turn }
          : record
      ),
    };
    resolveDefaults(true);
    const repriced = ventureTargetAnchor(finite(input.liftedRevenueAnchor ?? 0));
    if (repriced > next.targetAnchor) next = { ...next, targetAnchor: repriced };
    const quality = finalQuality(next, brandQualityBonus(input.averageQuality));
    const probability = hitProbability(quality);
    const hit = rollOutcome(next._id) < probability;
    next = {
      ...next,
      activeKey: undefined,
      stage: hit ? "released" : "flopped",
      releasedTurn: turn,
      outcome: hit ? "hit" : "flop",
      finalQuality: round1(quality),
      hitProbability: round3(probability),
      ...(hit
        ? {
            boostFraction: round3(boostFractionForQuality(quality)),
            boostEndsTurn: turn + VENTURE_BOOST_TURNS,
            upliftToDateAnchor: 0,
            lastUpliftAnchor: 0,
          }
        : {}),
    };
  }
  return { venture: next, offered, defaulted, completed };
}

/** Records one turn of the lift. Expires the venture once the window has passed. */
export function advanceBoost(
  venture: ProductVenture,
  input: { turn: number; upliftAnchor: number }
): ProductVenture | null {
  if (venture.stage !== "released" || input.turn <= venture.lastProcessedTurn) return null;
  const ended = input.turn > (venture.boostEndsTurn ?? 0);
  const uplift = ended ? 0 : Math.max(0, finite(input.upliftAnchor));
  return {
    ...venture,
    lastProcessedTurn: input.turn,
    stage: ended ? "expired" : "released",
    upliftToDateAnchor: (venture.upliftToDateAnchor ?? 0) + uplift,
    lastUpliftAnchor: uplift,
  };
}

/** Extra revenue a boost produced, given the revenue the sector reported while lifted. */
export function upliftFromRevenue(
  revenueAnchor: number,
  boostFraction: number,
  priorTotalBoost: number
): number {
  const revenue = Math.max(0, finite(revenueAnchor));
  return (revenue * Math.max(0, boostFraction)) / (1 + Math.max(0, priorTotalBoost));
}

export function stackedBoostMultiplier(boosts: readonly number[]): number {
  const total = boosts.reduce((sum, boost) => sum + Math.max(0, finite(boost)), 0);
  return 1 + Math.min(VENTURE_MAX_STACKED_BOOST, total);
}

export interface VentureOddsView {
  projectedQuality: number;
  hitLow: number;
  hitHigh: number;
  boostLow: number;
  boostHigh: number;
  remainingTurns: number;
}

/** Honest odds band at current funding: spread covers events still to come. */
export function ventureOdds(
  venture: ProductVenture,
  turn: number,
  averageQuality?: number | null
): VentureOddsView {
  const remaining = Math.max(0, venture.endTurn - Math.max(turn, venture.lastProcessedTurn));
  const futureInvestment = venture.fundingPerTurnAnchor * remaining;
  const projectedInvestment = venture.investedAnchor + futureInvestment;
  const base =
    qualityFromInvestment(projectedInvestment, venture.targetAnchor) +
    venture.qualityShift +
    brandQualityBonus(averageQuality);
  const unresolved = venture.events.filter((record) => !record.choiceId).length;
  const spread = remaining > 0 ? 3 + 4 * unresolved : 0;
  const low = clamp(base - spread, 0, 100);
  const high = clamp(base + spread, 0, 100);
  return {
    projectedQuality: round1(clamp(base, 0, 100)),
    hitLow: round3(hitProbability(low)),
    hitHigh: round3(hitProbability(high)),
    boostLow: round3(boostFractionForQuality(low)),
    boostHigh: round3(boostFractionForQuality(high)),
    remainingTurns: remaining,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function newVenture(input: {
  id: string;
  corporationId: string;
  domain: VentureDomain;
  lineId: string;
  name: string;
  turn: number;
  baselineRevenueAnchor: number;
  fundingPerTurnAnchor?: number;
}): ProductVenture {
  const targetAnchor = ventureTargetAnchor(input.baselineRevenueAnchor);
  return {
    _id: input.id,
    corporationId: input.corporationId,
    activeKey: `${input.corporationId}:${input.domain}`,
    domain: input.domain,
    lineId: input.lineId,
    name: input.name,
    stage: "development",
    startedTurn: input.turn,
    endTurn: input.turn + VENTURE_DEVELOPMENT_TURNS,
    lastProcessedTurn: input.turn,
    rev: 0,
    fundingPerTurnAnchor: clampFundingPerTurn(
      targetAnchor,
      input.fundingPerTurnAnchor ?? referenceFundingPerTurn(targetAnchor)
    ),
    targetAnchor,
    baselineRevenueAnchor: Math.max(0, finite(input.baselineRevenueAnchor)),
    investedAnchor: 0,
    spentAnchor: 0,
    pendingChargeAnchor: 0,
    qualityShift: 0,
    events: scheduleEvents({
      ventureId: input.id,
      domain: input.domain,
      lineId: input.lineId,
      startedTurn: input.turn,
    }),
  };
}
