/**
 * Product ventures: a funded, named product a CEO develops over about three
 * real days. A hit gives every matching sector a temporary revenue lift, a
 * flop is sunk cost only. One engine serves media titles and manufactured
 * lines; the line catalog decides which sectors a product lifts.
 */
export type VentureDomain = "media" | "manufacturing";

export type VentureStage = "development" | "released" | "flopped" | "cancelled" | "expired";

export interface VentureEventChoice {
  id: string;
  label: string;
  /** What the choice costs or risks, in plain words, shown beside the button. */
  detail: string;
  /** Points added to the final quality score (can be negative). */
  qualityDelta: number;
  /** One-time extra cost as a fraction of the product's investment target. */
  chargeFraction: number;
  /** Turns added to (positive) or removed from (negative) the development clock. */
  delayTurns: number;
}

export interface VentureEventDef {
  id: string;
  domain: VentureDomain;
  title: string;
  body: string;
  /** Restricts the event to these lines. Omitted means any line in the domain. */
  lineIds?: readonly string[];
  choices: readonly [VentureEventChoice, VentureEventChoice, ...VentureEventChoice[]];
  /** Applied when the CEO has not answered by the deadline. */
  defaultChoiceId: string;
}

export interface VentureEventRecord {
  eventId: string;
  triggerTurn: number;
  offeredTurn?: number;
  deadlineTurn?: number;
  choiceId?: string;
  /** True when the default choice was applied because nobody answered. */
  auto?: boolean;
  resolvedTurn?: number;
}

export interface ProductVenture {
  _id: string;
  corporationId: string;
  /** Present only while in development: one venture per corporation and domain. */
  activeKey?: string;
  domain: VentureDomain;
  lineId: string;
  name: string;
  stage: VentureStage;
  startedTurn: number;
  /** Planned release turn. Event choices can move it. */
  endTurn: number;
  lastProcessedTurn: number;
  /** Bumped by every write so the turn and the CEO cannot overwrite each other. */
  rev?: number;
  /** Funding the CEO has set per turn, in anchor currency. */
  fundingPerTurnAnchor: number;
  /** Cumulative investment that reaches quality 100 x (1 - e^-1.2) in the quality curve. */
  targetAnchor: number;
  /** Matching sectors' revenue per turn when development started, in anchor currency. */
  baselineRevenueAnchor: number;
  /** Money that went into the product itself and counts toward quality. */
  investedAnchor: number;
  /** All money paid, including one-time event costs. */
  spentAnchor: number;
  /** Event costs not yet paid. Collected with the next debits. */
  pendingChargeAnchor: number;
  qualityShift: number;
  events: VentureEventRecord[];
  releasedTurn?: number;
  outcome?: "hit" | "flop";
  finalQuality?: number;
  hitProbability?: number;
  /** Revenue lift as a fraction (0.10 to 0.20) while the boost runs. */
  boostFraction?: number;
  boostEndsTurn?: number;
  /** Estimated extra revenue earned so far from the lift, in anchor currency. */
  upliftToDateAnchor?: number;
  lastUpliftAnchor?: number;
}

/** Written on the corporation in the same update as the cash debit. */
export interface VentureDebitReceipt {
  turn: number;
  amountAnchor: number;
  /** Part of the debit that went into the product itself. */
  investmentAnchor: number;
  /** Part of the debit that paid event costs. */
  chargeAnchor: number;
}
